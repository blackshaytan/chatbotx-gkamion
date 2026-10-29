CREATE TYPE "externalOrderEventType" AS ENUM('orderCreated', 'paymentReceived', 'statusChanged');--> statement-breakpoint
CREATE TABLE "ExternalCustomerIdentity" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"provider" text NOT NULL,
	"externalCustomerId" text NOT NULL,
	"contactId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExternalOrderEvent" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"provider" text NOT NULL,
	"eventId" text NOT NULL,
	"externalOrderId" text NOT NULL,
	"eventType" "externalOrderEventType" NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"occurredAt" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExternalOrder" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"provider" text NOT NULL,
	"externalOrderId" text NOT NULL,
	"externalCustomerId" text NOT NULL,
	"contactId" bigint NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"lastEventAt" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalCustomerIdentity_workspace_provider_external_key" ON "ExternalCustomerIdentity" ("workspaceId","provider","externalCustomerId");--> statement-breakpoint
CREATE INDEX "ExternalCustomerIdentity_contactId_idx" ON "ExternalCustomerIdentity" ("contactId");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalOrderEvent_workspace_provider_event_key" ON "ExternalOrderEvent" ("workspaceId","provider","eventId");--> statement-breakpoint
CREATE INDEX "ExternalOrderEvent_workspace_order_occurred_idx" ON "ExternalOrderEvent" ("workspaceId","externalOrderId","occurredAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalOrder_workspace_provider_external_key" ON "ExternalOrder" ("workspaceId","provider","externalOrderId");--> statement-breakpoint
CREATE INDEX "ExternalOrder_contactId_updatedAt_idx" ON "ExternalOrder" ("contactId","updatedAt");--> statement-breakpoint
ALTER TABLE "ExternalCustomerIdentity" ADD CONSTRAINT "ExternalCustomerIdentity_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalCustomerIdentity" ADD CONSTRAINT "ExternalCustomerIdentity_contactId_Contact_id_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalOrderEvent" ADD CONSTRAINT "ExternalOrderEvent_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalOrder" ADD CONSTRAINT "ExternalOrder_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalOrder" ADD CONSTRAINT "ExternalOrder_contactId_Contact_id_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;