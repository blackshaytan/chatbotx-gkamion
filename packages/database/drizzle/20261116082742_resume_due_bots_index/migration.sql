-- Partial index for pauses that still have a resume deadline. CONCURRENTLY so
-- creating it does not lock writes on Conversation. If this fails midway, the
-- index is left INVALID and IF NOT EXISTS will skip it: DROP INDEX CONCURRENTLY
-- "Conversation_botResumeDue_idx" before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_botResumeDue_idx" ON "Conversation" ("botResumeAt") WHERE "botEnabled" = false AND "botResumeAt" IS NOT NULL;
