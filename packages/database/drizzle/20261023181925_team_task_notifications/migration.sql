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
CREATE INDEX "Notification_userId_workspaceId_readAt_createdAt_idx" ON "Notification" ("userId","workspaceId","readAt","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_workspaceId_entityType_entityId_idx" ON "Notification" ("workspaceId","entityType","entityId");--> statement-breakpoint
CREATE INDEX "Notification_createdAt_idx" ON "Notification" ("createdAt");--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;