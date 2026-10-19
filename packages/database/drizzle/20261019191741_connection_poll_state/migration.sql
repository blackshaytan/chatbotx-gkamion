CREATE TABLE "ConnectionPollState" (
	"connectionId" bigint PRIMARY KEY,
	"workspaceId" bigint NOT NULL,
	"cursor" jsonb,
	"intervalSeconds" integer NOT NULL,
	"lastPolledAt" timestamp(6) with time zone,
	"lastSucceededAt" timestamp(6) with time zone
);
--> statement-breakpoint
ALTER TABLE "ConnectionPollState" ADD CONSTRAINT "ConnectionPollState_connectionId_Connection_id_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "ConnectionPollState" ADD CONSTRAINT "ConnectionPollState_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;