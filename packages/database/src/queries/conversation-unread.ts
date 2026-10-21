import { sql } from "drizzle-orm"

/**
 * Relational-query form of the canonical raw-SQL unread predicate in
 * `packages/database/src/queries/contact-filter/index.ts` (`case "unread"`).
 * Keep both representations in sync when the unread definition changes.
 *
 * Based on `inboxActivityAt`, which only client messages and manager replies
 * advance — bot sends never make a conversation unread.
 */
export const conversationUnreadWhere = {
  OR: [
    {
      agentLastReadAt: { isNull: true },
      inboxActivityAt: { isNotNull: true },
    },
    { inboxActivityAt: { gt: sql`"agentLastReadAt"` } },
  ],
} satisfies Record<string, unknown>
