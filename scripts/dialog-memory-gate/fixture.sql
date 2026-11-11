-- T02 dialog-memory mainDB-only v1 gate fixture.
-- Representative subset of the production schema inside a DEDICATED schema
-- (dialog_memory_gate) in a DEDICATED CI database (dialog_memory_gate).
-- This file MUST NOT create the future invalidation triggers; those belong to
-- scripts/dialog-memory-gate/invalidation.sql (does not exist in RED stage).
-- What this fixture DOES provide is the prospective publish CAS contract
-- (publish_summary_candidate) as an explicit SQL helper, plus registry tables.

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

-- Shard registry: ANY row (active or not) disables memory.
CREATE TABLE "MessageShard" (
  "id" text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "shardIndex" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'active', -- active | draining | retired
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ShardTimeRange" (
  "id" text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "messageShardId" text NOT NULL,
  "fromCreatedAt" timestamptz,
  "toCreatedAt" timestamptz
);

-- Monotonic per-conversation source revision (main DB). Bumped in the SAME
-- transaction as the meaningful Message/Attachment change (future triggers).
CREATE TABLE "DialogMemorySource" (
  "conversationId" text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "sourceRevision" numeric NOT NULL DEFAULT 0
);

-- Monotonic per-workspace topology epoch (main DB). Bumped on ANY
-- MessageShard/ShardTimeRange change; never decrements, deleting registry
-- rows does not restore an older epoch.
CREATE TABLE "DialogMemoryTopology" (
  "workspaceId" text PRIMARY KEY,
  "topologyEpoch" integer NOT NULL DEFAULT 0
);

-- Main memory row: one per conversation (v1).
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
-- publishes only if sourceRevision AND memoryVersion AND topologyEpoch all
-- still match the snapshot taken before generation. Coverage and delivery are
-- independent of this guard.
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
  v_revision_ok boolean;
  v_topo_ok boolean;
  v_version_ok boolean;
BEGIN
  SELECT s."workspaceId",
         (s."sourceRevision" = p_expected_source_revision)
    INTO v_workspace_id, v_revision_ok
    FROM "DialogMemorySource" s
   WHERE s."conversationId" = p_conversation_id;
  IF NOT FOUND THEN
    RETURN false; -- unknown conversation: memory is never auto-created
  END IF;

  SELECT (t."topologyEpoch" = p_expected_topology_epoch)
    INTO v_topo_ok
    FROM "DialogMemoryTopology" t
   WHERE t."workspaceId" = v_workspace_id;
  v_topo_ok := COALESCE(v_topo_ok, false);

  SELECT (m."memoryVersion" = p_expected_memory_version)
    INTO v_version_ok
    FROM "DialogMemory" m
   WHERE m."conversationId" = p_conversation_id;
  v_version_ok := COALESCE(v_version_ok, false);

  IF NOT (v_revision_ok AND v_topo_ok AND v_version_ok) THEN
    RETURN false;
  END IF;

  UPDATE "DialogMemory"
     SET "summary" = p_summary,
         "memoryVersion" = "memoryVersion" + 1,
         "topologyEpoch" = p_expected_topology_epoch,
         "updatedAt" = now()
   WHERE "conversationId" = p_conversation_id;
  RETURN true;
END;
$fn$;

COMMIT;
