/** One row of the seller's dialog list (`inbox-list` → `briefs[]`). */
export type DromBrief = {
  dialogId: string
  interlocutor: string
  /** Unix seconds of the dialog's last message. */
  lastMessageDate: number
  isUnread: boolean
  /** DROM marks a dialog with an unanswered buyer message even after it was read. */
  highlighted: boolean
}

type RawBrief = {
  dialogId?: unknown
  interlocutor?: unknown
  lastMessageDate?: unknown
  isUnread?: unknown
  html?: unknown
}

const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : ""

export const parseBriefs = (inboxList: unknown): DromBrief[] => {
  const briefs = (inboxList as { briefs?: unknown } | null)?.briefs
  if (!Array.isArray(briefs)) {
    return []
  }
  return briefs
    .filter(
      (brief): brief is RawBrief => typeof brief === "object" && brief !== null,
    )
    .map((brief) => ({
      dialogId: asText(brief.dialogId).trim(),
      interlocutor: asText(brief.interlocutor),
      lastMessageDate: Number(brief.lastMessageDate) || 0,
      isUnread: Boolean(brief.isUnread),
      highlighted: asText(brief.html).includes("dialog-brief_highlighted"),
    }))
    .filter((brief) => brief.dialogId.length > 0)
}
