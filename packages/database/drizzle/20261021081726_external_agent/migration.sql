CREATE TABLE "ExternalAgentConversationState" (
	"conversationId" bigint PRIMARY KEY,
	"workspaceId" bigint NOT NULL,
	"cursorAt" timestamp(6) with time zone,
	"cursorMessageId" bigint,
	"includeHistory" boolean DEFAULT true NOT NULL,
	"runId" text,
	"runStartedAt" timestamp(6) with time zone,
	"lastEventAt" timestamp(6) with time zone,
	"lastEventSeq" integer DEFAULT -1 NOT NULL,
	"lastProgressSentAt" timestamp(6) with time zone,
	"lastProgressText" text,
	"lastClientSendAt" timestamp(6) with time zone,
	"progressFallbackSentAt" timestamp(6) with time zone,
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExternalAgentInbox" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"externalAgentId" bigint NOT NULL,
	"inboxId" bigint NOT NULL,
	"workspaceId" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExternalAgent" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"provider" text DEFAULT 'hermes' NOT NULL,
	"baseUrl" text NOT NULL,
	"apiKey" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"resumeAfterHours" integer,
	"maxRunMinutes" integer DEFAULT 30 NOT NULL,
	"progressMessage" text DEFAULT 'Работаю над вашим запросом, это займёт несколько минут' NOT NULL,
	"lastCheckedAt" timestamp(6) with time zone,
	"lastCheckStatus" text,
	"lastCheckError" text
);
--> statement-breakpoint
CREATE INDEX "ExternalAgentConversationState_workspaceId_idx" ON "ExternalAgentConversationState" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalAgentInbox_agent_inbox_key" ON "ExternalAgentInbox" ("externalAgentId","inboxId");--> statement-breakpoint
CREATE INDEX "ExternalAgentInbox_inboxId_idx" ON "ExternalAgentInbox" ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalAgent_workspaceId_key" ON "ExternalAgent" ("workspaceId");--> statement-breakpoint
ALTER TABLE "ExternalAgentConversationState" ADD CONSTRAINT "ExternalAgentConversationState_wkxwOvo3r4zT_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgentConversationState" ADD CONSTRAINT "ExternalAgentConversationState_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgentInbox" ADD CONSTRAINT "ExternalAgentInbox_externalAgentId_ExternalAgent_id_fkey" FOREIGN KEY ("externalAgentId") REFERENCES "ExternalAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgentInbox" ADD CONSTRAINT "ExternalAgentInbox_inboxId_Inbox_id_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgentInbox" ADD CONSTRAINT "ExternalAgentInbox_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD CONSTRAINT "ExternalAgent_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;