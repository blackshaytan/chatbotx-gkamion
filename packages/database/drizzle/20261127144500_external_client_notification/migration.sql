CREATE TABLE "ExternalClientNotification" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"provider" text NOT NULL,
	"eventId" text NOT NULL,
	"contactId" bigint NOT NULL,
	"externalOrderId" text,
	"statusId" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalClientNotification_workspace_provider_event_key" ON "ExternalClientNotification" ("workspaceId","provider","eventId");--> statement-breakpoint
ALTER TABLE "ExternalClientNotification" ADD CONSTRAINT "ExternalClientNotification_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalClientNotification" ADD CONSTRAINT "ExternalClientNotification_contactId_Contact_id_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
