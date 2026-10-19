CREATE TABLE "IntegrationMax" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"auth" jsonb NOT NULL,
	"botId" text NOT NULL,
	"name" text NOT NULL,
	"workspaceId" bigint NOT NULL,
	"inboxId" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "IntegrationMax_workspaceId_idx" ON "IntegrationMax" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationMax_inboxId_key" ON "IntegrationMax" ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationMax_botId_key" ON "IntegrationMax" ("botId");--> statement-breakpoint
ALTER TABLE "IntegrationMax" ADD CONSTRAINT "IntegrationMax_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "IntegrationMax" ADD CONSTRAINT "IntegrationMax_inboxId_Inbox_id_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;