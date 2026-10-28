import type { InternalMessageModel } from "@chatbotx.io/database/types"

const FIRST_TURN_LIMIT = 10
const HISTORY_LIMIT = 10

/** Messages must be ordered by (createdAt, id), oldest first. */
export const selectNewEmployeeMessages = (input: {
  messages: InternalMessageModel[]
  userId: string
  cursorAt: Date | null
  cursorMessageId: string | null
}): InternalMessageModel[] => {
  const isEmployeeMessage = (message: InternalMessageModel) =>
    message.authorUserId === input.userId &&
    message.kind === "comment" &&
    message.deletedAt === null
  if (!input.cursorAt) {
    const lastAssistant = input.messages.findLastIndex(
      (message) => message.kind === "comment" && message.authorUserId === null,
    )
    return input.messages
      .slice(lastAssistant + 1)
      .filter(isEmployeeMessage)
      .slice(-FIRST_TURN_LIMIT)
  }
  const cursorTime = input.cursorAt.getTime()
  return input.messages.filter((message) => {
    if (!isEmployeeMessage(message)) {
      return false
    }
    const time = message.createdAt.getTime()
    if (time !== cursorTime) {
      return time > cursorTime
    }
    return (
      input.cursorMessageId !== null &&
      BigInt(message.id) > BigInt(input.cursorMessageId)
    )
  })
}

export const selectStaffHistory = (
  messages: InternalMessageModel[],
  newMessages: InternalMessageModel[],
): InternalMessageModel[] => {
  const first = newMessages[0]
  const index = first ? messages.indexOf(first) : -1
  if (index <= 0) {
    return []
  }
  return messages
    .slice(0, index)
    .filter(
      (message) => message.kind === "comment" && message.deletedAt === null,
    )
    .slice(-HISTORY_LIMIT)
}
