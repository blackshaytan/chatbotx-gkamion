import type { DatabaseClient } from "@chatbotx.io/database/client"
import type { InternalMessageAttachment } from "@chatbotx.io/database/partials"
import {
  internalThreadRepository,
  taskRepository,
} from "@chatbotx.io/database/repositories"
import { parseInternalMentions } from "@chatbotx.io/utils"
import { BaseService } from "../base.service"
import { validationException } from "../errors"
import type { TaskActor } from "../task/actor"
import { taskForbiddenException } from "../task/permissions"
import { canDeleteComment, canEditComment } from "./comment-permissions"
import { commentRow } from "./message-rows"
import { type InternalMessageView, toInternalMessageView } from "./view"

class InternalThreadService extends BaseService {
  async listMessages(input: {
    workspaceId: string
    threadId: string
    page: number
    perPage: number
  }): Promise<{ data: InternalMessageView[]; pageCount: number }> {
    const { rows, total } = await internalThreadRepository.listMessages({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      limit: input.perPage,
      offset: (input.page - 1) * input.perPage,
    })
    return {
      data: rows.map(toInternalMessageView),
      pageCount: Math.ceil(total / input.perPage),
    }
  }

  async postComment(input: {
    workspaceId: string
    threadId: string
    text: string
    attachments: InternalMessageAttachment[]
    actor: TaskActor
    tx?: DatabaseClient
  }): Promise<InternalMessageView> {
    const trimmed = input.text.trim()
    if (trimmed.length === 0 && input.attachments.length === 0) {
      throw validationException("text", "Comment text or attachments required")
    }
    const mentions = await this.filterMentions({
      workspaceId: input.workspaceId,
      text: input.text,
    })
    const { tx, ...row } = input
    const [message] = await internalThreadRepository.insertMessages({
      rows: [
        commentRow({
          ...row,
          text: input.text,
          mentions,
          attachments: input.attachments,
        }),
      ],
      tx,
    })
    return toInternalMessageView(message)
  }

  async editComment(input: {
    workspaceId: string
    threadId: string
    id: string
    text: string
    actor: TaskActor
    now?: Date
    tx?: DatabaseClient
  }): Promise<InternalMessageView> {
    const now = input.now ?? new Date()
    const message = await this.requireComment(input)
    if (!canEditComment({ message, actor: input.actor, now })) {
      if (message.authorUserId !== actorUserId(input.actor)) {
        throw taskForbiddenException()
      }
      throw validationException("comment", "Comment cannot be edited")
    }
    const mentions = await this.filterMentions({
      workspaceId: input.workspaceId,
      text: input.text,
    })
    const updated = await internalThreadRepository.updateMessage({
      workspaceId: input.workspaceId,
      id: input.id,
      set: {
        text: input.text,
        mentions,
        editedAt: now,
      },
      tx: input.tx,
    })
    if (!updated) {
      throw validationException("comment", "Comment not found")
    }
    return toInternalMessageView(updated)
  }

  async deleteComment(input: {
    workspaceId: string
    threadId: string
    id: string
    actor: TaskActor
    isOwner: boolean
    now?: Date
    tx?: DatabaseClient
  }): Promise<InternalMessageView> {
    const now = input.now ?? new Date()
    const message = await this.requireComment(input)
    if (
      !canDeleteComment({
        message,
        actor: input.actor,
        isOwner: input.isOwner,
        now,
      })
    ) {
      if (message.authorUserId !== actorUserId(input.actor)) {
        throw taskForbiddenException()
      }
      throw validationException("comment", "Comment cannot be deleted")
    }
    const updated = await internalThreadRepository.updateMessage({
      workspaceId: input.workspaceId,
      id: input.id,
      set: { deletedAt: now },
      tx: input.tx,
    })
    if (!updated) {
      throw validationException("comment", "Comment not found")
    }
    return toInternalMessageView(updated)
  }

  async markRead(input: {
    threadId: string
    userId: string
    at?: Date
    tx?: DatabaseClient
  }): Promise<void> {
    await internalThreadRepository.markRead({
      threadId: input.threadId,
      userId: input.userId,
      at: input.at ?? new Date(),
      tx: input.tx,
    })
  }

  async countUnread(input: {
    workspaceId: string
    userId: string
    threadIds: string[]
    tx?: DatabaseClient
  }): Promise<Map<string, number>> {
    return await internalThreadRepository.countUnreadByThreads(input)
  }

  private async requireComment(input: {
    workspaceId: string
    threadId: string
    id: string
    tx?: DatabaseClient
  }) {
    const message = await internalThreadRepository.findMessage(input)
    if (!message) {
      throw validationException("comment", "Comment not found")
    }
    if (message.kind !== "comment") {
      throw validationException("comment", "System messages cannot be changed")
    }
    if (message.deletedAt) {
      throw validationException("comment", "Comment is deleted")
    }
    return message
  }

  private async filterMentions(input: { workspaceId: string; text: string }) {
    const parsed = parseInternalMentions(input.text)
    const [userIds, teamIds] = await Promise.all([
      taskRepository.listMemberUserIds({
        workspaceId: input.workspaceId,
        userIds: parsed.userIds,
      }),
      taskRepository.listTeamIds({
        workspaceId: input.workspaceId,
        teamIds: parsed.teamIds,
      }),
    ])
    const allowedUsers = new Set(userIds)
    const allowedTeams = new Set(teamIds)
    return {
      userIds: parsed.userIds.filter((id) => allowedUsers.has(id)),
      teamIds: parsed.teamIds.filter((id) => allowedTeams.has(id)),
    }
  }
}

const actorUserId = (actor: TaskActor): string | null =>
  actor.kind === "user" ? actor.userId : null

export const internalThreadService = new InternalThreadService()
