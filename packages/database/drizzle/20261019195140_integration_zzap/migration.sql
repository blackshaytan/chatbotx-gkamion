CREATE TABLE "IntegrationZzap" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"auth" jsonb NOT NULL,
	"codeObject" text NOT NULL,
	"name" text NOT NULL,
	"workspaceId" bigint NOT NULL,
	"inboxId" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "IntegrationZzap_workspaceId_idx" ON "IntegrationZzap" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationZzap_inboxId_key" ON "IntegrationZzap" ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationZzap_codeObject_key" ON "IntegrationZzap" ("codeObject");--> statement-breakpoint
ALTER TABLE "IntegrationZzap" ADD CONSTRAINT "IntegrationZzap_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "IntegrationZzap" ADD CONSTRAINT "IntegrationZzap_inboxId_Inbox_id_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;