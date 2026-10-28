type GroupableChatMessage = {
  authorUserId: string | null
  createdAt: Date
  id: string
  kind: "comment" | "system"
}

const GROUP_WINDOW_MS = 5 * 60 * 1000

export const groupChatMessages = <T extends GroupableChatMessage>(messages: T[]) =>
  messages.reduce<T[][]>((groups, message) => {
    const previousGroup = groups.at(-1)
    const previous = previousGroup?.at(-1)
    const canJoin =
      previous &&
      message.kind === "comment" &&
      previous.kind === "comment" &&
      message.authorUserId === previous.authorUserId &&
      message.createdAt.getTime() - previous.createdAt.getTime() <=
        GROUP_WINDOW_MS
    if (canJoin && previousGroup) {
      previousGroup.push(message)
    } else {
      groups.push([message])
    }
    return groups
  }, [])
