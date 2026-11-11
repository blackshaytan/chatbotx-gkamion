-- T02 dialog-memory mainDB-only v1 gate fixture.
-- Representative subset of the production schema inside a DEDICATED schema
-- (dialog_memory_gate) in a DEDICATED CI database (dialog_memory_gate).
-- This file MUST NOT create the future invalidation triggers; those belong to
-- scripts/dialog-memory-gate/invalidation.sql (does not exist in RED stage).
-- What this fixture DOES provide is the prospective publish CAS contract
-- (publish_summary_candidate) as an explicit SQL helper, plus registry tables.
--
-- IMPORTANT: id columns here are intentionally TEXT for the RED prototype.
-- Production MessageShard.id is a bigint (bigintAsString()), and the real
-- Message/Attachment storage is a TimescaleDB hypertable with compression,
-- not these declarative range partitions. This fixture proves the
-- invalidation contract, not the final migration.

SET client_min_messages = notice;

BEGIN;

CREATE SCHEMA IF NOT EXISTS dialog_memory_gate;
SET search_path = dialog_memory_gate;

-- Minimal workspace / conversation (no FKs; matches production isolation)
CREATE TABLE "Workspace" (
  "id" text PRIMARY KEY,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Conversation" (
  "id" text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- Representative Message: composite PK (id, "createdAt"), RANGE partitioned by
-- "createdAt". Two current partitions; tests create one more ("Message_2027").
CREATE TABLE "Message" (
  "id" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "conversationId" text NOT NULL,
  "contactInboxId" text NOT NULL,
  "workspaceId" text NOT NULL,
  "text" text,
  "contentAttributes" jsonb,
  "messageType" text NOT NULL,
  "contentType" text NOT NULL,
  "senderType" text NOT NULL,
  "senderId" text,
  "sourceId" text,
  "deletedAt" timestamptz,
  "type" text NOT NULL DEFAULT 'message',
  "parentId" text,
  "attributes" jsonb,
  "sendError" text,
  PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "Message_2026_h1" PARTITION OF "Message"
  FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE "Message_2026_h2" PARTITION OF "Message"
  FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- Attachment with parent identity ("messageId" + "messageCreatedAt"), no FK.
CREATE TABLE "Attachment" (
  "id" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "workspaceId" text NOT NULL,
  "conversationId" text NOT NULL,
  "messageId" text NOT NULL,
  "messageCreatedAt" timestamptz NOT NULL,
  "fileType" text NOT NULL,
  "sourceId" text,
  "mimeType" text NOT NULL DEFAULT 'application/octet-stream',
  "width" integer,
  "height" integer,
  "size" integer NOT NULL DEFAULT 0,
  "thumbnailPath" text,
  "originPath" text NOT NULL,
  "name" text,
  PRIMARY KEY ("id", "createdAt")
);

-- MessageShard registry is GLOBAL: it has no workspaceId/status columns.
-- The real registry lives in packages/database/src/sharding/message/schema/shard.ts.
-- ANY row here (active or not) disables dialog memory for every workspace.
CREATE TABLE "MessageShard" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "host" text NOT NULL,
  "database" text NOT NULL,
  "user" text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT false,
  "isMain" boolean NOT NULL DEFAULT false,
  "shardKey" integer,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- ShardTimeRange references the global MessageShard by shardId; startTime/endTime.
-- Real definition: packages/database/src/sharding/message/schema/time-range.ts.
CREATE TABLE "ShardTimeRange" (
  "id" text PRIMARY KEY,
  "shardId" text NOT NULL REFERENCES "MessageShard"("id") ON DELETE CASCADE,
  "startTime" timestamptz NOT NULL,
  "endTime" timestamptz
);

-- Monotonic per-conversation source revision (main DB). Bumped in the SAME
-- transaction as the meaningful Message/Attachment change (future triggers).
CREATE TABLE "DialogMemorySource" (
  "conversationId" text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "sourceRevision" numeric NOT NULL DEFAULT 0
);

-- Global singleton topology epoch. MessageShard / ShardTimeRange mutations
-- invalidate memory for ALL workspaces. Deleting registry rows never rolls
-- the epoch back; in GREEN, TRUNCATE of the registry must also invalidate.
CREATE TABLE "DialogMemoryTopology" (
  "id" text PRIMARY KEY DEFAULT 'global',
  "topologyEpoch" integer NOT NULL DEFAULT 0
);

-- Main memory row: one per conversation (v1). topologyEpoch stores the global
-- epoch snapshot that was current when the summary was accepted.
CREATE TABLE "DialogMemory" (
  "conversationId" text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "summary" text,
  "memoryVersion" integer NOT NULL DEFAULT 1,
  "topologyEpoch" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- Prospective publish CAS contract (fixture-owned, intentionally here so RED
-- can validate candidate handling without the future write path):
-- locks global topology row, then source row, then memory row in the same
-- stable order the GREEN registry trigger will use, performs a single
-- conditional UPDATE checking sourceRevision + memoryVersion + topologyEpoch +
-- NOT EXISTS "MessageShard", and returns true only if exactly one memory row
-- was updated. Coverage and delivery are independent of this guard.
CREATE OR REPLACE FUNCTION publish_summary_candidate(
  p_conversation_id text,
  p_summary text,
  p_expected_source_revision numeric,
  p_expected_memory_version integer,
  p_expected_topology_epoch integer
) RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_workspace_id text;
  v_actual_revision numeric;
  v_actual_topology_epoch integer;
BEGIN
  -- 1) Lock the global topology row first (same lock order the GREEN registry
  --    trigger will use) and read the actual epoch under the lock.
  SELECT t."topologyEpoch"
    INTO v_actual_topology_epoch
    FROM "DialogMemoryTopology" t
   WHERE t."id" = 'global'
     FOR UPDATE;

  IF NOT FOUND
     OR v_actual_topology_epoch IS DISTINCT FROM p_expected_topology_epoch THEN
    RETURN false;
  END IF;

  -- 2) Lock the conversation source row and verify the expected revision.
  SELECT s."workspaceId", s."sourceRevision"
    INTO v_workspace_id, v_actual_revision
    FROM "DialogMemorySource" s
   WHERE s."conversationId" = p_conversation_id
     FOR UPDATE;

  IF NOT FOUND OR v_actual_revision IS DISTINCT FROM p_expected_source_revision THEN
    RETURN false;
  END IF;

  -- 3) Lock the memory row (no-op if missing, but keeps a stable order).
  PERFORM 1
    FROM "DialogMemory" m
   WHERE m."conversationId" = p_conversation_id
     AND m."workspaceId" = v_workspace_id
     FOR UPDATE;

  -- 4) Conditional, workspace-scoped CAS update. The NOT EXISTS guard
  --    reflects the agreed rule: any MessageShard row disables memory.
  --    m."topologyEpoch" is intentionally not checked against the expected
  --    value: once the global topology lock confirms the epoch, an older
  --    memory row is allowed to catch up to the current epoch if the source
  --    revision and memory version still match and the registry is empty.
  UPDATE "DialogMemory" m
     SET "summary" = p_summary,
         "memoryVersion" = "memoryVersion" + 1,
         "topologyEpoch" = v_actual_topology_epoch,
         "updatedAt" = now()
   WHERE m."conversationId" = p_conversation_id
     AND m."workspaceId" = v_workspace_id
     AND m."memoryVersion" = p_expected_memory_version
     AND NOT EXISTS (SELECT 1 FROM "MessageShard");

  RETURN FOUND;
END;
$fn$;

COMMIT;
