import { type SQL, type SQLWrapper, sql } from "drizzle-orm"

export type ConversationUnreadRankColumns = {
  inboxActivityAt: SQLWrapper
  agentLastReadAt: SQLWrapper
  handedOverAt: SQLWrapper
}

/**
 * Boolean rank of `conversationUnreadWhere`: true when the conversation is
 * unread. The inbox orders by this first so unread rows stay above read ones.
 * Keep the expression identical to that predicate.
 */
export const conversationUnreadRankSql = (
  table: ConversationUnreadRankColumns,
): SQL =>
  sql`((${table.inboxActivityAt} IS NOT NULL AND (${table.agentLastReadAt} IS NULL OR ${table.inboxActivityAt} > ${table.agentLastReadAt})) OR (${table.handedOverAt} IS NOT NULL AND (${table.agentLastReadAt} IS NULL OR ${table.handedOverAt} > ${table.agentLastReadAt})))`

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
