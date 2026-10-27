import { type DatabaseClient, db } from "@chatbotx.io/database/client"
import type {
  NotificationPayload,
  TaskNotificationType,
  WorkspaceMemberNotificationTypes,
} from "@chatbotx.io/database/partials"
import type { TaskDueNotificationRow } from "@chatbotx.io/database/repositories"
import {
  notificationRepository,
  taskRepository,
  workspaceMemberRepository,
} from "@chatbotx.io/database/repositories"
import type { NotificationModel } from "@chatbotx.io/database/types"
import { BaseService } from "../base.service"
import { validationException } from "../errors"
import { logger } from "../logger"
import type { TaskActor } from "../task/actor"
import { actorLabel, actorUserId } from "../task/actor"
import { listAssigneeUserIds } from "../task/notifications"
import { emitNotificationsCreated } from "./listeners"
import {
  isTaskNotificationEnabled,
  readTaskNotificationPreferences,
  type TaskNotificationPreferences,
} from "./preferences"
import {
  pickHighestPriorityType,
  resolveTaskNotificationRecipients,
  type TaskNotificationActionEvent,
} from "./recipients"

export type { TaskNotificationActionEvent } from "./recipients"

/** Scheduled reminder/overdue events have no acting member or label. */
type NotificationActor = TaskActor | { kind: "system" }

const notificationActorUserId = (actor: NotificationActor): string | null =>
  actor.kind === "system" ? null : actorUserId(actor)

const notificationActorLabel = (actor: NotificationActor): string | null =>
  actor.kind === "system" ? null : actorLabel(actor)

const isTaskNotificationRow = (
  row: NotificationModel,
): row is NotificationModel & {
  type: TaskNotificationType
  entityType: "task"
  payload: NotificationPayload
} => row.entityType === "task"

class NotificationService extends BaseService {
  async notifyTask(props: {
    workspaceId: string
    task: {
      id: string
      title: string
      assigneeUserId: string | null
      assigneeTeamId: string | null
      createdByUserId: string | null
    }
    actor: NotificationActor
    events: TaskNotificationActionEvent[]
    excerpt?: string | null
    from?: string | null
    to?: string | null
    tx?: DatabaseClient
  }): Promise<void> {
    const {
      workspaceId,
      task,
      actor,
      events,
      excerpt = null,
      from = null,
      to = null,
      tx = db,
    } = props
    if (events.length === 0) {
      return
    }

    const watcherUserIds = await taskRepository.listWatcherUserIds({
      taskId: task.id,
      tx,
    })
    const referencedUserIds = this.collectReferencedUserIds(
      events,
      watcherUserIds,
    )
    const memberUserIds = new Set(
      await taskRepository.listMemberUserIds({
        workspaceId,
        userIds: [...referencedUserIds],
        tx,
      }),
    )
    const recipients = resolveTaskNotificationRecipients({
      actorUserId: notificationActorUserId(actor),
      events,
      watcherUserIds,
      memberUserIds,
    })
    if (recipients.size === 0) {
      return
    }

    const prefsRows =
      await workspaceMemberRepository.listNotificationTypesByUserIds({
        workspaceId,
        userIds: [...recipients.keys()],
        tx,
      })
    const prefsByUser = new Map(
      prefsRows.map((row) => [row.userId, row.notificationTypes]),
    )

    const payloadBase = {
      taskTitle: task.title,
      actorUserId: notificationActorUserId(actor),
      actorLabel: notificationActorLabel(actor),
      excerpt,
      ...(from === null ? {} : { from }),
      ...(to === null ? {} : { to }),
    }

    const rows = [...recipients.entries()]
      .map(([userId, candidateTypes]) => {
        const prefs = prefsByUser.get(userId) ?? {}
        const enabled = candidateTypes.filter((type) =>
          isTaskNotificationEnabled(prefs, type),
        )
        if (enabled.length === 0) {
          return null
        }
        const type = pickHighestPriorityType(enabled)
        return {
          workspaceId,
          userId,
          type,
          entityType: "task" as const,
          entityId: task.id,
          payload: payloadBase,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    if (rows.length === 0) {
      return
    }

    const inserted = await notificationRepository.insertMany({ rows, tx })
    emitNotificationsCreated({
      workspaceId,
      notifications: inserted.map((row) => ({
        id: row.id,
        userId: row.userId,
      })),
    })
  }

  async listForUser(input: {
    workspaceId: string
    userId: string
    limit: number
    unreadOnly?: boolean
  }): Promise<
    Array<
      NotificationModel & {
        type: TaskNotificationType
        entityType: "task"
        payload: NotificationPayload
      }
    >
  > {
    const rows = await notificationRepository.listForUser({
      ...input,
      entityType: "task",
    })
    return rows.filter(isTaskNotificationRow)
  }

  async countUnread(input: { workspaceId: string; userId: string }) {
    const total = await notificationRepository.countUnread(input)
    return { total }
  }

  async markRead(input: {
    workspaceId: string
    userId: string
    ids?: string[]
  }): Promise<void> {
    await notificationRepository.markRead(input)
  }

  async markAllRead(input: {
    workspaceId: string
    userId: string
  }): Promise<void> {
    await notificationRepository.markRead(input)
  }

  async getPreferences(input: { workspaceId: string; userId: string }) {
    const notificationTypes =
      (await workspaceMemberRepository.findNotificationTypes(input)) ?? {}
    return readTaskNotificationPreferences(notificationTypes)
  }

  async updatePreferences(input: {
    workspaceId: string
    userId: string
    patch: Partial<Record<TaskNotificationType, boolean>>
  }): Promise<TaskNotificationPreferences> {
    const existing =
      (await workspaceMemberRepository.findNotificationTypes(input)) ?? {}
    const merged: Partial<WorkspaceMemberNotificationTypes> = {
      ...existing,
      ...input.patch,
    }
    const updated = await workspaceMemberRepository.updateNotificationTypes({
      workspaceId: input.workspaceId,
      userId: input.userId,
      notificationTypes: merged,
    })
    if (updated === 0) {
      throw validationException(
        "notificationPreferences",
        "Notification preferences cannot be updated without workspace membership",
      )
    }
    return readTaskNotificationPreferences(merged)
  }

  async processDueTaskNotifications(input: {
    now: Date
    batchSize: number
    maxBatches: number
    guard: (workspaceId: string, fn: () => Promise<void>) => Promise<void>
  }): Promise<{ reminders: number; overdue: number }> {
    const { now, batchSize, maxBatches, guard } = input
    let reminders = 0
    for (let batch = 0; batch < maxBatches; batch++) {
      const claimed = await taskRepository.claimDueReminders({
        now,
        limit: batchSize,
      })
      if (claimed.length === 0) {
        break
      }
      for (const task of claimed) {
        await guard(task.workspaceId, async () => {
          try {
            await this.notifyTaskReminder(task)
          } catch (err) {
            logger.error(
              { err, taskId: task.id },
              "Failed to send task reminder",
            )
          }
        })
        reminders += 1
      }
      if (claimed.length < batchSize) {
        break
      }
    }

    let overdue = 0
    for (let batch = 0; batch < maxBatches; batch++) {
      const claimed = await taskRepository.claimOverdue({
        now,
        limit: batchSize,
      })
      if (claimed.length === 0) {
        break
      }
      for (const task of claimed) {
        await guard(task.workspaceId, async () => {
          try {
            await this.notifyTaskOverdue(task)
          } catch (err) {
            logger.error(
              { err, taskId: task.id },
              "Failed to send task overdue notice",
            )
          }
        })
        overdue += 1
      }
      if (claimed.length < batchSize) {
        break
      }
    }

    return { reminders, overdue }
  }

  async deleteForTask(input: {
    workspaceId: string
    taskId: string
    tx?: DatabaseClient
  }): Promise<void> {
    await notificationRepository.deleteByEntity({
      workspaceId: input.workspaceId,
      entityType: "task",
      entityId: input.taskId,
      tx: input.tx,
    })
  }

  async purgeOlderThan(input: {
    before: Date
    limit: number
  }): Promise<number> {
    return await notificationRepository.deleteOlderThan(input)
  }

  async notifyTaskReminder(task: TaskDueNotificationRow): Promise<void> {
    const assigneeUserIds = await listAssigneeUserIds({
      workspaceId: task.workspaceId,
      assigneeUserId: task.assigneeUserId,
      assigneeTeamId: task.assigneeTeamId,
    })
    if (assigneeUserIds.length === 0) {
      return
    }
    await this.notifyTask({
      workspaceId: task.workspaceId,
      task,
      actor: { kind: "system" },
      events: [{ kind: "reminder", userIds: assigneeUserIds }],
    })
  }

  async notifyTaskOverdue(task: TaskDueNotificationRow): Promise<void> {
    const assigneeUserIds = await listAssigneeUserIds({
      workspaceId: task.workspaceId,
      assigneeUserId: task.assigneeUserId,
      assigneeTeamId: task.assigneeTeamId,
    })
    const userIds = [
      ...new Set([
        ...assigneeUserIds,
        ...(task.createdByUserId ? [task.createdByUserId] : []),
      ]),
    ]
    if (userIds.length === 0) {
      return
    }
    await this.notifyTask({
      workspaceId: task.workspaceId,
      task,
      actor: { kind: "system" },
      events: [{ kind: "overdue", userIds }],
    })
  }

  private collectReferencedUserIds(
    events: TaskNotificationActionEvent[],
    watcherUserIds: string[],
  ): Set<string> {
    const ids = new Set<string>()
    for (const event of events) {
      if ("userIds" in event) {
        for (const userId of event.userIds) {
          ids.add(userId)
        }
      }
      if (
        event.kind === "commented" ||
        event.kind === "statusChanged" ||
        event.kind === "dueChanged"
      ) {
        for (const userId of watcherUserIds) {
          ids.add(userId)
        }
      }
    }
    return ids
  }
}

export const notificationService = new NotificationService()

export const notifyTaskSafeLazy = async (
  build: () => Promise<Parameters<NotificationService["notifyTask"]>[0] | null>,
): Promise<void> => {
  try {
    const input = await build()
    if (input) {
      await notificationService.notifyTask(input)
    }
  } catch (err) {
    logger.error({ err }, "Failed to send task notifications")
  }
}
