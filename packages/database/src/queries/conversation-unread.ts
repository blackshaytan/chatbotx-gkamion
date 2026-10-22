import { sql } from "drizzle-orm"

/**
 * Relational-query form of the canonical raw-SQL unread predicate in
 * `packages/database/src/queries/contact-filter/index.ts` (`case "unread"`).
 * Keep both representations in sync when the unread definition changes.
 *
 * Based on `inboxActivityAt`, which only client messages and manager replies
 * advance — bot sends never make a conversation unread. A conversation the
 * external agent handed to a manager (`handedOverAt`) is also unread until the
 * agent reads it.
 */
export const conversationUnreadWhere = {
  OR: [
    {
      agentLastReadAt: { isNull: true },
      inboxActivityAt: { isNotNull: true },
    },
    { inboxActivityAt: { gt: sql`"agentLastReadAt"` } },
    {
      handedOverAt: { isNotNull: true },
      OR: [
        { agentLastReadAt: { isNull: true } },
        { handedOverAt: { gt: sql`"agentLastReadAt"` } },
      ],
    },
  ],
} satisfies Record<string, unknown>
