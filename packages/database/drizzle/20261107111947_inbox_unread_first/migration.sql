-- Inbox list order: unread first, then inboxActivityAt. CONCURRENTLY so creating
-- the index does not lock writes on Conversation. If this fails midway, the
-- index is left INVALID and IF NOT EXISTS will skip it: DROP INDEX CONCURRENTLY
-- "Conversation_workspaceId_inboxUnread_inboxActivityAt_id_idx" before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_workspaceId_inboxUnread_inboxActivityAt_id_idx" ON "Conversation" ("workspaceId",(("inboxActivityAt" IS NOT NULL AND ("agentLastReadAt" IS NULL OR "inboxActivityAt" > "agentLastReadAt")) OR ("handedOverAt" IS NOT NULL AND ("agentLastReadAt" IS NULL OR "handedOverAt" > "agentLastReadAt"))) DESC,"inboxActivityAt" DESC NULLS LAST,"id" DESC NULLS LAST);