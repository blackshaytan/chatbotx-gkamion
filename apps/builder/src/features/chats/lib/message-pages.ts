type ChatMessagePageItem = {
  createdAt: Date
  id: string
}

/**
 * The API delivers each page chronologically. Older pages are fetched after
 * the initial one, so sort and de-duplicate here before rendering the thread.
 */
export const mergeChatMessagePages = <T extends ChatMessagePageItem>(
  pages: T[][],
): T[] => {
  const messagesById = new Map<string, T>()
  for (const page of pages) {
    for (const message of page) {
      messagesById.set(message.id, message)
    }
  }
  return [...messagesById.values()].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id, undefined, { numeric: true }),
  )
}
