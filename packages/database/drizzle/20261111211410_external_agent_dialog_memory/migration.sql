CREATE TABLE "DialogMemory" (
	"workspaceId" bigint,
	"conversationId" bigint,
	"summary" jsonb,
	"schemaVersion" integer NOT NULL,
	"promptVersion" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"memoryVersion" bigint DEFAULT 1 NOT NULL,
	"coveredSourceRevision" bigint NOT NULL,
	"topologyEpoch" bigint DEFAULT 0 NOT NULL,
	"coverageMessageId" bigint,
	"coverageCreatedAt" timestamp(6) with time zone,
	"lastError" text,
	"lastAttemptAt" timestamp(6) with time zone,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "DialogMemory_pkey" PRIMARY KEY("workspaceId","conversationId"),
	CONSTRAINT "DialogMemory_schemaVersion_check" CHECK ("schemaVersion" >= 1),
	CONSTRAINT "DialogMemory_memoryVersion_check" CHECK ("memoryVersion" >= 1),
	CONSTRAINT "DialogMemory_coveredSourceRevision_check" CHECK ("coveredSourceRevision" >= 0),
	CONSTRAINT "DialogMemory_topologyEpoch_check" CHECK ("topologyEpoch" >= 0),
	CONSTRAINT "DialogMemory_coveragePair_check" CHECK (("coverageMessageId" IS NULL) = ("coverageCreatedAt" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "DialogMemorySource" (
	"workspaceId" bigint,
	"conversationId" bigint,
	"sourceRevision" bigint DEFAULT 0 NOT NULL,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "DialogMemorySource_pkey" PRIMARY KEY("workspaceId","conversationId"),
	CONSTRAINT "DialogMemorySource_sourceRevision_check" CHECK ("sourceRevision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "DialogMemoryTopology" (
	"id" text PRIMARY KEY DEFAULT 'global',
	"topologyEpoch" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "DialogMemoryTopology_id_check" CHECK ("id" = 'global'),
	CONSTRAINT "DialogMemoryTopology_topologyEpoch_check" CHECK ("topologyEpoch" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "Conversation_workspaceId_id_key" ON "Conversation" ("workspaceId","id");--> statement-breakpoint
ALTER TABLE "DialogMemory" ADD CONSTRAINT "DialogMemory_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "DialogMemory" ADD CONSTRAINT "DialogMemory_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "Conversation"("workspaceId","id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "DialogMemorySource" ADD CONSTRAINT "DialogMemorySource_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "DialogMemorySource" ADD CONSTRAINT "DialogMemorySource_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "Conversation"("workspaceId","id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
-- Manual data seed after generated DDL. Does not reset an existing epoch.
INSERT INTO "DialogMemoryTopology" ("id", "topologyEpoch")
VALUES ('global', 0)
ON CONFLICT ("id") DO NOTHING;
