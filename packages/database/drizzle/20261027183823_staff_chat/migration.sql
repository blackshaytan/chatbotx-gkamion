ALTER TYPE "internalThreadType" ADD VALUE 'direct';--> statement-breakpoint
ALTER TYPE "internalThreadType" ADD VALUE 'agent';--> statement-breakpoint
ALTER TABLE "InternalThread" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "InternalThread" ADD COLUMN "directKey" text;--> statement-breakpoint
ALTER TABLE "InternalThread" ADD COLUMN "lastMessageAt" timestamp(6) with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "InternalThread_workspaceId_directKey_key" ON "InternalThread" ("workspaceId","directKey");--> statement-breakpoint
CREATE INDEX "InternalThread_workspaceId_type_lastMessageAt_idx" ON "InternalThread" ("workspaceId","type","lastMessageAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "Notification_chat_unread_key" ON "Notification" ("workspaceId","userId","entityId") WHERE "entityType" = 'chat' AND "readAt" IS NULL;