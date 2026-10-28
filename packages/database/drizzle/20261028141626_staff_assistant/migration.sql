CREATE TABLE "ExternalAgentChatState" (
	"threadId" bigint PRIMARY KEY,
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
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "ExternalAgent_workspaceId_key";--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD COLUMN "purpose" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD COLUMN "apiTokenId" bigint;--> statement-breakpoint
ALTER TABLE "InternalMessage" ADD COLUMN "dedupeKey" text;--> statement-breakpoint
CREATE INDEX "ExternalAgentChatState_workspaceId_idx" ON "ExternalAgentChatState" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalAgent_workspaceId_purpose_key" ON "ExternalAgent" ("workspaceId","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "InternalMessage_threadId_dedupeKey_key" ON "InternalMessage" ("threadId","dedupeKey") WHERE "dedupeKey" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ExternalAgentChatState" ADD CONSTRAINT "ExternalAgentChatState_threadId_InternalThread_id_fkey" FOREIGN KEY ("threadId") REFERENCES "InternalThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgentChatState" ADD CONSTRAINT "ExternalAgentChatState_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD CONSTRAINT "ExternalAgent_apiTokenId_WorkspaceApiToken_id_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "WorkspaceApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;