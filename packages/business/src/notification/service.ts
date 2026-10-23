import { type DatabaseClient, db } from "@chatbotx.io/database/client"
import type {
  TaskNotificationType,
  WorkspaceMemberNotificationTypes,
} from "@chatbotx.io/database/partials"
import {
  notificationRepository,
  taskRepository,
  workspaceMemberRepository,
} from "@chatbotx.io/database/repositories"
import { BaseService } from "../base.service"
import { logger } from "../logger"
import type { TaskActor } from "../task/actor"
import { actorLabel, actorUserId } from "../task/actor"
import { emitNotificationsCreated } from "./listeners"
import {
  isTaskNotificationEnabled,
  readTaskNotificationPreferences,
  type TaskNotificationPreferences,
} from "./preferences"
import {
  resolveTaskNotificationRecipients,
  type TaskNotificationActionEvent,
} from "./recipients"

export type { TaskNotificationActionEvent } from "./recipients"

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
    actor: TaskActor
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
      actorUserId: actorUserId(actor),
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
      actorUserId: actorUserId(actor),
      actorLabel: actorLabel(actor),
      excerpt,
      ...(from === null ? {} : { from }),
      ...(to === null ? {} : { to }),
    }

    const rows = [...recipients.entries()]
      .filter(([userId, type]) =>
        isTaskNotificationEnabled(prefsByUser.get(userId) ?? {}, type),
      )
      .map(([userId, type]) => ({
        workspaceId,
        userId,
        type,
        entityType: "task" as const,
        entityId: task.id,
        payload: payloadBase,
      }))

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
  }) {
    return await notificationRepository.listForUser(input)
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
    const merged: WorkspaceMemberNotificationTypes = {
      ...existing,
      ...input.patch,
    }
    await workspaceMemberRepository.updateNotificationTypes({
      workspaceId: input.workspaceId,
      userId: input.userId,
      notificationTypes: merged,
    })
    return readTaskNotificationPreferences(merged)
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

export const notifyTaskSafe = async (
  input: Parameters<NotificationService["notifyTask"]>[0],
): Promise<void> => {
  try {
    await notificationService.notifyTask(input)
  } catch (err) {
    logger.error({ err }, "Failed to send task notifications")
  }
}
