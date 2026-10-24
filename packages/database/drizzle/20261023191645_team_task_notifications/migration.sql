CREATE TABLE "Notification" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"userId" bigint NOT NULL,
	"type" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"readAt" timestamp(6) with time zone
);
--> statement-breakpoint
CREATE INDEX "Notification_userId_workspaceId_createdAt_idx" ON "Notification" ("userId","workspaceId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "Notification_userId_workspaceId_unread_idx" ON "Notification" ("userId","workspaceId") WHERE "readAt" IS NULL;--> statement-breakpoint
CREATE INDEX "Notification_workspaceId_entityType_entityId_idx" ON "Notification" ("workspaceId","entityType","entityId");--> statement-breakpoint
CREATE INDEX "Notification_createdAt_idx" ON "Notification" ("createdAt");--> statement-breakpoint
CREATE INDEX "Task_remindAt_pending_idx" ON "Task" ("remindAt") WHERE "remindedAt" IS NULL AND "remindAt" IS NOT NULL AND "status" IN ('todo', 'in_progress');--> statement-breakpoint
CREATE INDEX "Task_dueAt_overdue_pending_idx" ON "Task" ("dueAt") WHERE "overdueNotifiedAt" IS NULL AND "dueAt" IS NOT NULL AND "status" IN ('todo', 'in_progress');--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
UPDATE "Task" SET "overdueNotifiedAt" = now() WHERE "dueAt" <= now() AND "overdueNotifiedAt" IS NULL;
--> statement-breakpoint
UPDATE "Task" SET "remindedAt" = now() WHERE "remindAt" <= now() AND "remindedAt" IS NULL;