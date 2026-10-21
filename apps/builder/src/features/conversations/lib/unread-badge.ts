/** The server caps `unreadCount` at 100, so the badge shows the cap as "99+". */
export const UNREAD_BADGE_CAP = 100

export const formatUnreadBadge = (unreadCount: number): string =>
  unreadCount >= UNREAD_BADGE_CAP ? "99+" : String(unreadCount)
