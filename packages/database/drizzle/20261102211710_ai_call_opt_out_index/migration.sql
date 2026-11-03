-- Partial opt-out index. Its own migration because CONCURRENTLY cannot run in the transaction that adds the columns.
-- If this fails midway, check pg_index.indisvalid and DROP INDEX CONCURRENTLY "Contact_workspace_ai_call_opt_out_idx" first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_workspace_ai_call_opt_out_idx" ON "Contact" ("workspaceId","aiCallOptOutAt") WHERE "aiCallOptOutAt" is not null;
