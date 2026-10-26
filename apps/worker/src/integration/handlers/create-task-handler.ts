import {
  conversationService,
  flowService,
  inboxTeamService,
  publishToWorkspaceParty,
  type TaskAssignee,
  taskService,
} from "@chatbotx.io/business"
import type { ConversationModel } from "@chatbotx.io/database/types"
import {
  type CreateTaskAssignee,
  type CreateTaskStepSchema,
  createTaskUnitMinutes,
} from "@chatbotx.io/flow-config"
import { RealtimeEventType } from "@chatbotx.io/partysocket-config"
import { resolveContactVariablesDeep } from "@chatbotx.io/variables"
import { logger } from "../../lib/logger"
import type { ExecuteStepProps } from "./flow-utils"
import type { ExecuteStepResult } from "./step"
import {
  referencedFieldExists,
  writeReferencedFieldValue,
} from "./tool-handler"

const TASK_TITLE_MAX = 255
const TASK_DESCRIPTION_MAX = 10_000

export const resolveCreateTaskSchedule = (input: {
  now: Date
  dueIn: CreateTaskStepSchema["dueIn"]
  remindBeforeMinutes: CreateTaskStepSchema["remindBeforeMinutes"]
}): { dueAt: Date | null; remindAt: Date | null } => {
  const { now, dueIn, remindBeforeMinutes } = input
  if (dueIn === null) {
    return { dueAt: null, remindAt: null }
  }
  const dueAt = new Date(
    now.getTime() + dueIn.amount * createTaskUnitMinutes[dueIn.unit] * 60_000,
  )
  if (remindBeforeMinutes === null) {
    return { dueAt, remindAt: null }
  }
  const remindAt = new Date(dueAt.getTime() - remindBeforeMinutes * 60_000)
  return { dueAt, remindAt }
}

const resolveTeamAssignee = async (input: {
  workspaceId: string
  teamId: string
}): Promise<
  { ok: true; assignee: TaskAssignee } | { ok: false; errorMessage: string }
> => {
  const memberIds = await inboxTeamService.listUserIdsByTeamId({
    workspaceId: input.workspaceId,
    inboxTeamId: input.teamId,
  })
  if (memberIds.length === 0) {
    return { ok: false, errorMessage: "Team has no members" }
  }
  return { ok: true, assignee: { type: "team", teamId: input.teamId } }
}

const resolveAssignee = async (
  assignee: CreateTaskAssignee,
  conversation: Pick<ConversationModel, "id" | "workspaceId">,
): Promise<
  { ok: true; assignee: TaskAssignee } | { ok: false; errorMessage: string }
> => {
  const workspaceId = conversation.workspaceId
  if (assignee.type === "user") {
    return { ok: true, assignee: { type: "user", userId: assignee.userId } }
  }
  if (assignee.type === "team") {
    return resolveTeamAssignee({ workspaceId, teamId: assignee.teamId })
  }

  const fresh = await conversationService.findByUncached({
    where: { id: conversation.id, workspaceId },
  })
  if (!fresh) {
    return { ok: false, errorMessage: "Conversation has no assignee" }
  }
  if (fresh.assignedUserId) {
    return {
      ok: true,
      assignee: { type: "user", userId: fresh.assignedUserId },
    }
  }
  if (fresh.assignedInboxTeamId) {
    return resolveTeamAssignee({
      workspaceId,
      teamId: fresh.assignedInboxTeamId,
    })
  }
  return { ok: false, errorMessage: "Conversation has no assignee" }
}

export const handleCreateTask = async (
  props: ExecuteStepProps<CreateTaskStepSchema>,
): Promise<ExecuteStepResult> => {
  const { conversation, contactInbox, flowVersion, step } = props
  const workspaceId = conversation.workspaceId

  try {
    const resolved = await resolveContactVariablesDeep(
      conversation.contactId,
      { title: step.title, description: step.description },
      { contactInbox, conversation },
    )
    const title = resolved.title.trim().slice(0, TASK_TITLE_MAX)
    if (!title) {
      return {
        status: "error",
        errorMessage: "Task title is empty after resolving variables",
        result: null,
      }
    }
    const descriptionRaw = resolved.description.slice(0, TASK_DESCRIPTION_MAX)
    const description = descriptionRaw.length > 0 ? descriptionRaw : null

    const assigneeResult = await resolveAssignee(step.assignee, conversation)
    if (!assigneeResult.ok) {
      return {
        status: "error",
        errorMessage: assigneeResult.errorMessage,
        result: null,
      }
    }

    const { dueAt, remindAt } = resolveCreateTaskSchedule({
      now: new Date(),
      dueIn: step.dueIn,
      remindBeforeMinutes: step.remindBeforeMinutes,
    })

    const flow = await flowService.findActiveById({
      id: flowVersion.flowId,
      workspaceId,
    })
    const label = flow?.name ?? "Flow"

    const task = await taskService.create({
      workspaceId,
      actor: { kind: "flow", label },
      title,
      description,
      priority: step.priority,
      dueAt,
      remindAt,
      assignee: assigneeResult.assignee,
      targets: {
        contactId: conversation.contactId,
        conversationId: conversation.id,
      },
    })

    publishToWorkspaceParty(workspaceId, {
      eventType: RealtimeEventType.taskChanged,
      data: { taskId: task.id },
    })

    if (step.outputFieldId !== "") {
      const fieldId = step.outputFieldId
      try {
        if (await referencedFieldExists({ fieldId, workspaceId })) {
          await writeReferencedFieldValue({
            fieldId,
            workspaceId,
            contactId: conversation.contactId,
            value: task.id,
          })
        }
      } catch (err) {
        logger.warn(
          { err, workspaceId, contactId: conversation.contactId, fieldId },
          "[handleCreateTask] failed to save task id; continuing",
        )
      }
    }

    return { status: "success", result: { taskId: task.id } }
  } catch (err) {
    logger.error(
      { err, conversationId: conversation.id, stepId: step.id },
      "[handleCreateTask] failed",
    )
    return {
      status: "error",
      errorMessage:
        err instanceof Error ? err.message : "Failed to create task",
      result: null,
    }
  }
}
