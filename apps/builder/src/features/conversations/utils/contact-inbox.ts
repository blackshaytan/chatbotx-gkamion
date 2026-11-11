/** The conversation's contact inbox on `channel`, if the contact is reachable there. */
export const findContactInboxByChannel = <
  TContactInbox extends { channel: string },
>(
  conversation: { contactInboxes: TContactInbox[] } | null | undefined,
  channel: TContactInbox["channel"],
): TContactInbox | undefined =>
  conversation?.contactInboxes.find(
    (contactInbox) => contactInbox.channel === channel,
  )

/**
 * The inbox a reply is actually sent to: the one with the latest message.
 *
 * A contact connected on several channels has ONE DM conversation shared by
 * all of them (`Conversation` carries no inbox/channel column at all, and a
 * `ContactInbox` relation is joined by `contactId`), so `contactInboxes[0]`
 * is only "the active channel" while the caller happens to hold a list sorted
 * by `lastMessageAt`. Anything that reads or writes a conversation must ask
 * here instead: a client who wrote on ZZAP while the dialog was opened on
 * email would otherwise be answered on the wrong channel.
 */
export const resolveActiveContactInbox = <
  TContactInbox extends { lastMessageAt?: Date | string | null },
>(
  contactInboxes: readonly TContactInbox[] | null | undefined,
): TContactInbox | undefined => {
  let active: TContactInbox | undefined
  let activeAt = Number.NEGATIVE_INFINITY
  for (const contactInbox of contactInboxes ?? []) {
    const at = new Date(contactInbox.lastMessageAt ?? 0).getTime()
    // Strict `>` on a strictly-increasing scan keeps the FIRST of two inboxes
    // that share a timestamp — the same element a list already sorted by
    // `lastMessageAt` puts first — and makes a list of never-used inboxes
    // resolve to its first element instead of `undefined`.
    if (active === undefined || at > activeAt) {
      active = contactInbox
      activeAt = at
    }
  }
  return active
}
