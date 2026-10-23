import { type DatabaseClient, db } from "@chatbotx.io/database/client"
import {
  OPEN_TASK_STATUSES,
  TASK_LIMITS,
  type TaskDueFilter,
  type TaskPriority,
  type TaskStatus,
  type TaskSystemEvent,
} from "@chatbotx.io/database/partials"
import {
  createMessageRepository,
  getSafeSinceTime,
  inboxTeamMemberRepository,
  internalThreadRepository,
  type TaskAssignmentRow,
  type TaskListFilter,
  type TaskTargetInsert,
  type TaskWithRelations,
  taskRepository,
} from "@chatbotx.io/database/repositories"
import { BaseService } from "../base.service"
import type { ContactAccessScope } from "../contact/service"
import { notFoundException, validationException } from "../errors"
import { systemMessageRow } from "../internal-thread/message-rows"
import { internalThreadService } from "../internal-thread/service"
import type { InternalMessageView } from "../internal-thread/view"
import { actorLabel, actorUserId, type TaskActor } from "./actor"
import {
  assertRemindBeforeDue,
  buildTaskChangeEvents,
  buildTaskUpdateSet,
  encodeAssignee,
} from "./changes"
import { resolveTaskDueWindow } from "./due-window"
import {
  canDeleteTask,
  canModifyTask,
  taskForbiddenException,
} from "./permissions"
import type { TaskAssignee, TaskPatch } from "./types"
import { type TaskView, toTaskView } from "./view"

export type TaskTargetsInput = {
  contactId?: string
  conversationId?: string
  messageId?: string
}

export type CreateTaskInput = {
  workspaceId: string
  actor: TaskActor
  title: string
  description?: string | null
  priority?: TaskPriority
  dueAt?: Date | null
  remindAt?: Date | null
  assignee: TaskAssignee
  watcherUserIds?: string[]
  targets?: TaskTargetsInput
  accessScope?: TaskAccessScope
}

export type TaskAccessScope = ContactAccessScope & { hideTargets?: boolean }

export type ListTasksInput = {
  workspaceId: string
  page: number
  perPage: number
  status?: TaskStatus | "open"
  priority?: TaskPriority
  due?: TaskDueFilter
  assigneeUserId?: string
  assigneeTeamId?: string
  teamMemberUserId?: string
  createdByUserId?: string
  watcherUserId?: string
  contactId?: string
  conversationId?: string
  accessScope?: TaskAccessScope
  now?: Date
}

export type TaskFilterInput = Omit<ListTasksInput, "page" | "perPage">

type Paged<T> = { data: T[]; pageCount: number }

const unique = (ids: string[]): string[] => [...new Set(ids)]

const toStatuses = (
  status: ListTasksInput["status"],
): TaskStatus[] | undefined => {
  if (!status) {
    return
  }
  return status === "open" ? [...OPEN_TASK_STATUSES] : [status]
}

const isOpenStatus = (status: TaskStatus): boolean =>
  (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status)

class TaskService extends BaseService {
  async create(input: CreateTaskInput): Promise<TaskView> {
    const { workspaceId, actor, assignee } = input
    const dueAt = input.dueAt ?? null
    const remindAt = input.remindAt ?? null
    assertRemindBeforeDue(remindAt, dueAt)
    await this.assertAssignable(workspaceId, assignee)

    const watcherUserIds = await this.resolveWatchers({
      workspaceId,
      explicit: input.watcherUserIds ?? [],
      implicit: [
        ...(actor.kind === "user" ? [actor.userId] : []),
        ...(assignee.type === "user" ? [assignee.userId] : []),
      ],
    })
    const targets = await this.resolveTargets(workspaceId, input.targets)
    const event: TaskSystemEvent = {
      type: "created",
      from: null,
      to: null,
      byUserId: actorUserId(actor),
    }

    const taskId = await db.transaction(async (tx) => {
      const thread = await internalThreadRepository.insertThread({
        workspaceId,
        tx,
      })
      const task = await taskRepository.insertTask({
        values: {
          workspaceId,
          threadId: thread.id,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? "normal",
          dueAt,
          remindAt,
          assigneeUserId: assignee.type === "user" ? assignee.userId : null,
          assigneeTeamId: assignee.type === "team" ? assignee.teamId : null,
          createdByUserId: actorUserId(actor),
          createdBySource: actor.kind,
          createdByLabel: actorLabel(actor),
        },
        tx,
      })
      await this.addWatcherRows({
        taskId: task.id,
        threadId: thread.id,
        userIds: watcherUserIds,
        tx,
      })
      await taskRepository.insertTargets({
        rows: targets.map((target) => ({ taskId: task.id, ...target })),
        tx,
      })
      await internalThreadRepository.insertMessages({
        rows: [
          systemMessageRow({
            workspaceId,
            threadId: thread.id,
            event,
            authorLabel: actorLabel(actor),
          }),
        ],
        tx,
      })
      return task.id
    })

    await this.audit("create", `created a task (#${taskId})`)
    return await this.get({
      workspaceId,
      id: taskId,
      accessScope: input.accessScope,
    })
  }

  async get(input: {
    workspaceId: string
    id: string
    accessScope?: TaskAccessScope
  }): Promise<TaskView> {
    const task = await this.findOrFail(input)
    const [view] = await this.toViews(
      input.workspaceId,
      [task],
      input.accessScope,
    )
    return view
  }

  async list(input: ListTasksInput): Promise<Paged<TaskView>> {
    const { workspaceId, page, perPage, accessScope } = input
    const filter = await this.resolveFilter(input)
    if (!filter) {
      return { data: [], pageCount: 0 }
    }

    const { rows, total } = await taskRepository.list({
      filter,
      limit: perPage,
      offset: (page - 1) * perPage,
    })
    return {
      data: await this.toViews(workspaceId, rows, accessScope),
      pageCount: Math.ceil(total / perPage),
    }
  }

  async count(input: TaskFilterInput): Promise<{ total: number }> {
    const filter = await this.resolveFilter(input)
    if (!filter) {
      return { total: 0 }
    }
    const total = await taskRepository.count({ filter })
    return { total }
  }

  async take(input: {
    workspaceId: string
    id: string
    userId: string
    actor: TaskActor
    accessScope?: TaskAccessScope
  }): Promise<TaskView> {
    const { workspaceId, id, userId, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (!task.assigneeTeamId) {
      throw validationException(
        "assigneeTeamId",
        "Task is not assigned to a team",
      )
    }
    const teamMemberIds = await inboxTeamMemberRepository.listUserIdsByTeamId({
      workspaceId,
      inboxTeamId: task.assigneeTeamId,
    })
    if (!teamMemberIds.includes(userId)) {
      throw validationException("userId", "Member is not in the assignee team")
    }
    if (actor.kind === "user" && actor.userId !== userId && !actor.isOwner) {
      throw taskForbiddenException()
    }
    return await this.update({
      workspaceId,
      id,
      actor,
      patch: { assignee: { type: "user", userId } },
      accessScope: input.accessScope,
    })
  }

  async update(input: {
    workspaceId: string
    id: string
    actor: TaskActor
    patch: TaskPatch
    accessScope?: TaskAccessScope
  }): Promise<TaskView> {
    const { workspaceId, id, actor, patch } = input
    const task = await this.findOrFail({ workspaceId, id })
    await this.assertCanModify(workspaceId, task, actor)
    if (patch.assignee) {
      await this.assertAssignable(workspaceId, patch.assignee)
    }
    assertRemindBeforeDue(
      patch.remindAt === undefined ? task.remindAt : patch.remindAt,
      patch.dueAt === undefined ? task.dueAt : patch.dueAt,
    )

    const set = buildTaskUpdateSet(task, patch, new Date())
    const events = buildTaskChangeEvents(task, patch, actorUserId(actor))
    if (Object.keys(set).length > 0) {
      await db.transaction(async (tx) => {
        await taskRepository.update({ workspaceId, id, set, tx })
        if (set.assigneeUserId) {
          await this.addWatcherRows({
            taskId: id,
            threadId: task.threadId,
            userIds: [set.assigneeUserId],
            tx,
          })
        }
        await internalThreadRepository.insertMessages({
          rows: events.map((event) =>
            systemMessageRow({
              workspaceId,
              threadId: task.threadId,
              event,
              authorLabel: actorLabel(actor),
            }),
          ),
          tx,
        })
      })
      await this.audit("update", `updated a task (#${id})`)
    }
    return await this.get({ workspaceId, id, accessScope: input.accessScope })
  }

  async complete(input: {
    workspaceId: string
    id: string
    actor: TaskActor
    accessScope?: TaskAccessScope
  }): Promise<TaskView> {
    return await this.update({ ...input, patch: { status: "done" } })
  }

  async delete(input: {
    workspaceId: string
    id: string
    actor: TaskActor
  }): Promise<void> {
    const { workspaceId, id, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (!canDeleteTask({ actor, task })) {
      throw taskForbiddenException()
    }
    await db.transaction(async (tx) => {
      await taskRepository.deleteWithThread({
        workspaceId,
        id,
        threadId: task.threadId,
        tx,
      })
    })
    await this.audit("delete", `deleted a task (#${id})`)
  }

  async addWatcher(input: {
    workspaceId: string
    id: string
    userId: string
    actor: TaskActor
    accessScope?: TaskAccessScope
  }): Promise<TaskView> {
    const { workspaceId, id, userId, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (actorUserId(actor) !== userId) {
      await this.assertCanModify(workspaceId, task, actor)
    }
    const [member] = await this.resolveWatchers({
      workspaceId,
      explicit: [userId],
      implicit: [],
    })
    await db.transaction(async (tx) => {
      await this.addWatcherRows({
        taskId: id,
        threadId: task.threadId,
        userIds: [member],
        tx,
      })
    })
    return await this.get({ workspaceId, id, accessScope: input.accessScope })
  }

  async removeWatcher(input: {
    workspaceId: string
    id: string
    userId: string
    actor: TaskActor
  }): Promise<void> {
    const { workspaceId, id, userId, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (actorUserId(actor) !== userId) {
      await this.assertCanModify(workspaceId, task, actor)
    }
    await db.transaction(async (tx) => {
      await taskRepository.deleteWatcher({ taskId: id, userId, tx })
      await internalThreadRepository.deleteMember({
        threadId: task.threadId,
        userId,
        tx,
      })
    })
  }

  async listComments(input: {
    workspaceId: string
    id: string
    page: number
    perPage: number
  }): Promise<Paged<InternalMessageView>> {
    const task = await this.findOrFail(input)
    return await internalThreadService.listMessages({
      workspaceId: input.workspaceId,
      threadId: task.threadId,
      page: input.page,
      perPage: input.perPage,
    })
  }

  async addComment(input: {
    workspaceId: string
    id: string
    text: string
    actor: TaskActor
  }): Promise<InternalMessageView> {
    const task = await this.findOrFail(input)
    return await internalThreadService.postComment({
      workspaceId: input.workspaceId,
      threadId: task.threadId,
      text: input.text,
      actor: input.actor,
    })
  }

  /** A removed member's tasks go to the workspace owner (spec section 8). */
  async reassignFromMember(input: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userId, tx = db } = input
    const workspace = await taskRepository.findWorkspace({ workspaceId, tx })
    if (!workspace || workspace.ownerId === userId) {
      return
    }
    const tasks = await taskRepository.listAssignedToUser({
      workspaceId,
      userId,
      tx,
    })
    await this.assignToOwner({
      workspaceId,
      ownerId: workspace.ownerId,
      tasks,
      tx,
    })
    await taskRepository.deleteWatchersForUser({ workspaceId, userId, tx })
    await internalThreadRepository.deleteMembersForUser({
      workspaceId,
      userId,
      tx,
    })
  }

  /** Call before deleting teams: their tasks go to the workspace owner. */
  async reassignFromTeams(input: {
    workspaceId: string
    teamIds: string[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, teamIds, tx = db } = input
    const workspace = await taskRepository.findWorkspace({ workspaceId, tx })
    if (!workspace) {
      return
    }
    const tasks = await taskRepository.listAssignedToTeams({
      workspaceId,
      teamIds,
      tx,
    })
    await this.assignToOwner({
      workspaceId,
      ownerId: workspace.ownerId,
      tasks,
      tx,
    })
  }

  private async assignToOwner(input: {
    workspaceId: string
    ownerId: string
    tasks: TaskAssignmentRow[]
    tx: DatabaseClient
  }): Promise<void> {
    const { workspaceId, ownerId, tasks, tx } = input
    if (tasks.length === 0) {
      return
    }
    await taskRepository.assignToUser({
      workspaceId,
      taskIds: tasks.map((task) => task.id),
      userId: ownerId,
      tx,
    })
    await taskRepository.insertWatchers({
      rows: tasks.map((task) => ({ taskId: task.id, userId: ownerId })),
      tx,
    })
    await internalThreadRepository.insertMembers({
      rows: tasks.map((task) => ({ threadId: task.threadId, userId: ownerId })),
      tx,
    })
    await internalThreadRepository.insertMessages({
      rows: tasks.map((task) =>
        systemMessageRow({
          workspaceId,
          threadId: task.threadId,
          event: {
            type: "assignee",
            from: encodeAssignee(task),
            to: `user:${ownerId}`,
            byUserId: null,
          },
          authorLabel: null,
        }),
      ),
      tx,
    })
  }

  private async findOrFail(input: {
    workspaceId: string
    id: string
  }): Promise<TaskWithRelations> {
    const task = await taskRepository.findById({
      workspaceId: input.workspaceId,
      id: input.id,
    })
    if (!task) {
      throw notFoundException("Task not found")
    }
    return task
  }

  private async resolveFilter(
    input: TaskFilterInput,
  ): Promise<TaskListFilter | null> {
    const { workspaceId, now = new Date() } = input
    let statuses = toStatuses(input.status)
    const filter: TaskListFilter = {
      workspaceId,
      priority: input.priority,
      assigneeUserId: input.assigneeUserId,
      assigneeTeamId: input.assigneeTeamId,
      createdByUserId: input.createdByUserId,
      watcherUserId: input.watcherUserId,
      contactId: input.contactId,
      conversationId: input.conversationId,
    }

    if (input.teamMemberUserId) {
      const teamIds = await taskRepository.listTeamIdsForUser({
        workspaceId,
        userId: input.teamMemberUserId,
      })
      if (teamIds.length === 0) {
        return null
      }
      filter.assigneeTeamIds = teamIds
    }

    if (input.due) {
      const workspace = await taskRepository.findWorkspace({ workspaceId })
      const { openOnly, ...window } = resolveTaskDueWindow({
        due: input.due,
        now,
        timezone: workspace?.timezone ?? "UTC",
      })
      Object.assign(filter, window)
      if (openOnly) {
        statuses = (statuses ?? [...OPEN_TASK_STATUSES]).filter(isOpenStatus)
        if (statuses.length === 0) {
          return null
        }
      }
    }

    return { ...filter, statuses }
  }

  private async toViews(
    workspaceId: string,
    tasks: TaskWithRelations[],
    accessScope?: TaskAccessScope,
  ): Promise<TaskView[]> {
    if (accessScope?.hideTargets) {
      const hidden = {
        contactIds: new Set<string>(),
        conversationIds: new Set<string>(),
      }
      return tasks.map((task) => toTaskView(task, hidden))
    }
    const assignedUserId = accessScope?.restrictToAssignedUserId
    if (!assignedUserId) {
      return tasks.map((task) => toTaskView(task, null))
    }
    const targets = tasks.flatMap((task) => task.targets)
    const visible = await taskRepository.listVisibleTargetIds({
      workspaceId,
      assignedUserId,
      contactIds: unique(
        targets.flatMap((t) => (t.contactId ? [t.contactId] : [])),
      ),
      conversationIds: unique(
        targets.flatMap((t) => (t.conversationId ? [t.conversationId] : [])),
      ),
    })
    const visibility = {
      contactIds: new Set(visible.contactIds),
      conversationIds: new Set(visible.conversationIds),
    }
    return tasks.map((task) => toTaskView(task, visibility))
  }

  private async assertCanModify(
    workspaceId: string,
    task: TaskWithRelations,
    actor: TaskActor,
  ): Promise<void> {
    const assigneeTeamMemberIds =
      actor.kind === "user" && task.assigneeTeamId
        ? await inboxTeamMemberRepository.listUserIdsByTeamId({
            workspaceId,
            inboxTeamId: task.assigneeTeamId,
          })
        : []
    if (!canModifyTask({ actor, task, assigneeTeamMemberIds })) {
      throw taskForbiddenException()
    }
  }

  private async assertAssignable(
    workspaceId: string,
    assignee: TaskAssignee,
  ): Promise<void> {
    if (assignee.type === "user") {
      const [member] = await taskRepository.listMemberUserIds({
        workspaceId,
        userIds: [assignee.userId],
      })
      if (!member) {
        throw validationException(
          "assigneeUserId",
          "Assignee is not a member of this workspace",
        )
      }
      return
    }
    const [team] = await taskRepository.listTeamIds({
      workspaceId,
      teamIds: [assignee.teamId],
    })
    if (!team) {
      throw validationException("assigneeTeamId", "Team not found")
    }
  }

  /**
   * Explicit watchers must be members; implicit ones (the author, the
   * assignee) are dropped silently when they are not — e.g. a support session.
   */
  private async resolveWatchers(input: {
    workspaceId: string
    explicit: string[]
    implicit: string[]
  }): Promise<string[]> {
    const requested = unique([...input.explicit, ...input.implicit])
    if (requested.length > TASK_LIMITS.maxWatchers) {
      throw validationException(
        "watcherUserIds",
        `A task can have at most ${TASK_LIMITS.maxWatchers} watchers`,
      )
    }
    const members = new Set(
      await taskRepository.listMemberUserIds({
        workspaceId: input.workspaceId,
        userIds: requested,
      }),
    )
    const missing = input.explicit.filter((id) => !members.has(id))
    if (missing.length > 0) {
      throw validationException(
        "watcherUserIds",
        `Not members of this workspace: ${missing.join(", ")}`,
      )
    }
    return requested.filter((id) => members.has(id))
  }

  private async resolveTargets(
    workspaceId: string,
    targets?: TaskTargetsInput,
  ): Promise<Omit<TaskTargetInsert, "taskId">[]> {
    if (!targets) {
      return []
    }
    const { contactId, conversationId, messageId } = targets
    if (messageId && !conversationId) {
      throw validationException(
        "messageId",
        "messageId requires conversationId",
      )
    }
    let linkedContactId = contactId
    if (conversationId) {
      const conversation = await taskRepository.findConversation({
        workspaceId,
        conversationId,
      })
      if (!conversation) {
        throw notFoundException("Conversation not found")
      }
      if (contactId && conversation.contactId !== contactId) {
        throw validationException(
          "conversationId",
          "Conversation belongs to another contact",
        )
      }
      if (messageId) {
        const repository = await createMessageRepository()
        const message = await repository.findTriggerMessage({
          id: messageId,
          conversationId,
          workspaceId,
          sinceTime:
            getSafeSinceTime(conversation.createdAt) ?? conversation.createdAt,
          requireCompleteResults: true,
        })
        if (!message) {
          throw notFoundException("Message not found")
        }
      }
      linkedContactId = conversation.contactId
    } else if (contactId) {
      const contact = await taskRepository.findContact({
        workspaceId,
        contactId,
      })
      if (!contact) {
        throw notFoundException("Contact not found")
      }
    }
    return [
      ...(linkedContactId ? [{ contactId: linkedContactId }] : []),
      ...(conversationId ? [{ conversationId }] : []),
      ...(messageId ? [{ messageId }] : []),
    ]
  }

  private async addWatcherRows(input: {
    taskId: string
    threadId: string
    userIds: string[]
    tx: DatabaseClient
  }): Promise<void> {
    const { taskId, threadId, userIds, tx } = input
    await taskRepository.insertWatchers({
      rows: userIds.map((userId) => ({ taskId, userId })),
      tx,
    })
    await internalThreadRepository.insertMembers({
      rows: userIds.map((userId) => ({ threadId, userId })),
      tx,
    })
  }
}

export const taskService = new TaskService()
