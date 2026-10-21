ALTER TABLE "Conversation" ADD COLUMN "inboxActivityAt" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "Conversation" ADD COLUMN "handoverCategory" text;--> statement-breakpoint
ALTER TABLE "Conversation" ADD COLUMN "handedOverAt" timestamp(6) with time zone;--> statement-breakpoint
CREATE INDEX "Conversation_workspaceId_inboxActivityAt_id_idx" ON "Conversation" ("workspaceId","inboxActivityAt" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
UPDATE "Conversation" SET "inboxActivityAt" = "lastActivityAt" WHERE "inboxActivityAt" IS NULL;
