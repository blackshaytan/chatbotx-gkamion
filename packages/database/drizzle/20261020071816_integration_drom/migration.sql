CREATE TABLE "IntegrationDrom" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"auth" jsonb NOT NULL,
	"sellerLogin" text NOT NULL,
	"name" text NOT NULL,
	"workspaceId" bigint NOT NULL,
	"inboxId" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "IntegrationDrom_workspaceId_idx" ON "IntegrationDrom" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationDrom_inboxId_key" ON "IntegrationDrom" ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationDrom_sellerLogin_key" ON "IntegrationDrom" ("sellerLogin");--> statement-breakpoint
ALTER TABLE "IntegrationDrom" ADD CONSTRAINT "IntegrationDrom_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "IntegrationDrom" ADD CONSTRAINT "IntegrationDrom_inboxId_Inbox_id_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;