import { messageService } from "@chatbotx.io/business"
import { decodeCursor, encodeCursor } from "@/lib/pagination/cursor-pagination"
import type {
  FindMessageRequest,
  ListMessagesRequest,
  ListMessagesResponse,
} from "../schema/query"
import type { MessageResourceWithRelations } from "../schema/resource"

export const listMessages = async (
  input: ListMessagesRequest & { hiddenInboxIds?: string[] },
): Promise<ListMessagesResponse> => {
  const cursor = decodeCursor(input.cursor)

  const result = await messageService.listForConversation({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    contactInboxId: input.contactInboxId,
    hiddenInboxIds: input.hiddenInboxIds,
    cursor: cursor
      ? {
          createdAt: cursor.createdAt,
          id: cursor.id,
          shardId: cursor.shardId,
        }
      : undefined,
    limit: input.perPage ?? 20,
  })

  const nextCursor = result.nextCursor
    ? encodeCursor({
        direction: "prev",
        createdAt: result.nextCursor.createdAt,
        id: result.nextCursor.id,
        shardId: result.nextCursor.shardId,
      })
    : null

  return { data: result.data, nextCursor, prevCursor: null }
}

export const findMessage = async (
  input: FindMessageRequest & { hiddenInboxIds?: string[] },
): Promise<MessageResourceWithRelations> => {
  const message = await messageService.findByIdWithUrls({
    workspaceId: input.workspaceId,
    id: input.id,
    createdAt: input.createdAt,
    hiddenInboxIds: input.hiddenInboxIds,
  })

  return message as MessageResourceWithRelations
}
