ALTER TYPE "externalOrderEventType" ADD VALUE 'itemStatusChanged';--> statement-breakpoint
ALTER TABLE "FlowRun" ADD COLUMN "notificationEventId" text;--> statement-breakpoint
ALTER TABLE "FlowRun" ADD COLUMN "result" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "FlowRun_notification_event_flow_key" ON "FlowRun" ("workspaceId","notificationEventId","flowId") WHERE "notificationEventId" IS NOT NULL;