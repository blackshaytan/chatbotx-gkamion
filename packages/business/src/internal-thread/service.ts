import type { DatabaseClient } from "@chatbotx.io/database/client"
import { internalThreadRepository } from "@chatbotx.io/database/repositories"
import { BaseService } from "../base.service"
import type { TaskActor } from "../task/actor"
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
    actor: TaskActor
    tx?: DatabaseClient
  }): Promise<InternalMessageView> {
    const { tx, ...row } = input
    const [message] = await internalThreadRepository.insertMessages({
      rows: [commentRow(row)],
      tx,
    })
    return toInternalMessageView(message)
  }
}

export const internalThreadService = new InternalThreadService()
