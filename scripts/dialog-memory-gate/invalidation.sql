-- T02 GREEN-stage invalidation prototype for the dialog_memory_gate schema.
-- This is a dedicated test-schema prototype, NOT a production migration.
--
-- Provides:
--   * dialogMemory_message_invalidation     (AFTER ROW on "Message")
--   * dialogMemory_attachment_invalidation    (AFTER ROW on "Attachment")
--   * dialogMemory_topology_invalidation_*    (BEFORE STATEMENT on "MessageShard"/"ShardTimeRange")
--
-- Rules enforced:
--   - Source triggers only touch "DialogMemorySource"; they never take the global
--     topology lock, never auto-create a source/memory row, and never sleep.
--   - Registry triggers only touch "DialogMemoryTopology"; they do not create the
--     singleton if it is missing (fail closed).
--   - Two-owner bumps happen in a deterministic source-row lock order to avoid
--     swap deadlocks.
--   - Attachment parent resolution uses ("workspaceId", "conversationId",
--     "messageId", "messageCreatedAt"), never the attachment's own createdAt.

SET client_min_messages = notice;

BEGIN;

SET search_path = dialog_memory_gate;

-- Bump an existing DialogMemorySource row for exactly one owner.
-- No-op if the row does not exist (unknown conversation stays unknown).
CREATE OR REPLACE FUNCTION bump_source(
  p_workspace_id text,
  p_conversation_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path = dialog_memory_gate
AS $fn$
BEGIN
  UPDATE "DialogMemorySource"
     SET "sourceRevision" = "sourceRevision" + 1
   WHERE "workspaceId" = p_workspace_id
     AND "conversationId" = p_conversation_id;
END;
$fn$;

-- Bump up to two source owners in a deterministic order so cross-owner moves
-- (conversation reassignment, workspace transfer) cannot swap-deadlock.
CREATE OR REPLACE FUNCTION bump_source_pair(
  p_old_workspace_id text, p_old_conversation_id text,
  p_new_workspace_id text, p_new_conversation_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path = dialog_memory_gate
AS $fn$
BEGIN
  IF p_old_workspace_id = p_new_workspace_id
     AND p_old_conversation_id = p_new_conversation_id THEN
    PERFORM bump_source(p_old_workspace_id, p_old_conversation_id);
  ELSIF (p_old_workspace_id, p_old_conversation_id)
        < (p_new_workspace_id, p_new_conversation_id) THEN
    PERFORM bump_source(p_old_workspace_id, p_old_conversation_id);
    PERFORM bump_source(p_new_workspace_id, p_new_conversation_id);
  ELSE
    PERFORM bump_source(p_new_workspace_id, p_new_conversation_id);
    PERFORM bump_source(p_old_workspace_id, p_old_conversation_id);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION dialogmemory_message_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = dialog_memory_gate
AS $fn$
DECLARE
  v_meaningful boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_source(NEW."workspaceId", NEW."conversationId");
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM bump_source(OLD."workspaceId", OLD."conversationId");
    RETURN OLD;
  END IF;

  -- UPDATE: content-neutral "updatedAt" changes alone must not bump.
  v_meaningful := (
       OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
    OR OLD."conversationId" IS DISTINCT FROM NEW."conversationId"
    OR OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId"
    OR OLD."contactInboxId" IS DISTINCT FROM NEW."contactInboxId"
    OR OLD."text" IS DISTINCT FROM NEW."text"
    OR OLD."contentAttributes" IS DISTINCT FROM NEW."contentAttributes"
    OR OLD."messageType" IS DISTINCT FROM NEW."messageType"
    OR OLD."contentType" IS DISTINCT FROM NEW."contentType"
    OR OLD."senderType" IS DISTINCT FROM NEW."senderType"
    OR OLD."senderId" IS DISTINCT FROM NEW."senderId"
    OR OLD."sourceId" IS DISTINCT FROM NEW."sourceId"
    OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."parentId" IS DISTINCT FROM NEW."parentId"
    OR OLD."attributes" IS DISTINCT FROM NEW."attributes"
    OR OLD."sendError" IS DISTINCT FROM NEW."sendError"
  );

  IF v_meaningful THEN
    PERFORM bump_source_pair(
      OLD."workspaceId", OLD."conversationId",
      NEW."workspaceId", NEW."conversationId"
    );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS dialogMemory_message_invalidation ON "Message";
CREATE TRIGGER dialogMemory_message_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON "Message"
  FOR EACH ROW
  EXECUTE FUNCTION dialogmemory_message_invalidation_fn();

CREATE OR REPLACE FUNCTION dialogmemory_attachment_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = dialog_memory_gate
AS $fn$
DECLARE
  v_meaningful boolean := false;
  v_old_ws text;
  v_old_cid text;
  v_new_ws text;
  v_new_cid text;
  v_old_found boolean := false;
  v_new_found boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT m."workspaceId", m."conversationId"
      INTO v_new_ws, v_new_cid
      FROM "Message" m
     WHERE m."id" = NEW."messageId"
       AND m."createdAt" = NEW."messageCreatedAt"
       AND m."workspaceId" = NEW."workspaceId"
       AND m."conversationId" = NEW."conversationId";

    IF FOUND THEN
      PERFORM bump_source(v_new_ws, v_new_cid);
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT m."workspaceId", m."conversationId"
      INTO v_old_ws, v_old_cid
      FROM "Message" m
     WHERE m."id" = OLD."messageId"
       AND m."createdAt" = OLD."messageCreatedAt"
       AND m."workspaceId" = OLD."workspaceId"
       AND m."conversationId" = OLD."conversationId";

    IF FOUND THEN
      PERFORM bump_source(v_old_ws, v_old_cid);
    END IF;

    RETURN OLD;
  END IF;

  -- UPDATE: anything except a content-neutral "updatedAt" change is meaningful,
  -- including a parent-reference move (messageId/messageCreatedAt/workspaceId/conversationId).
  v_meaningful := (
       OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
    OR OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId"
    OR OLD."conversationId" IS DISTINCT FROM NEW."conversationId"
    OR OLD."messageId" IS DISTINCT FROM NEW."messageId"
    OR OLD."messageCreatedAt" IS DISTINCT FROM NEW."messageCreatedAt"
    OR OLD."fileType" IS DISTINCT FROM NEW."fileType"
    OR OLD."sourceId" IS DISTINCT FROM NEW."sourceId"
    OR OLD."mimeType" IS DISTINCT FROM NEW."mimeType"
    OR OLD."width" IS DISTINCT FROM NEW."width"
    OR OLD."height" IS DISTINCT FROM NEW."height"
    OR OLD."size" IS DISTINCT FROM NEW."size"
    OR OLD."thumbnailPath" IS DISTINCT FROM NEW."thumbnailPath"
    OR OLD."originPath" IS DISTINCT FROM NEW."originPath"
    OR OLD."name" IS DISTINCT FROM NEW."name"
  );

  IF v_meaningful THEN
    SELECT m."workspaceId", m."conversationId"
      INTO v_old_ws, v_old_cid
      FROM "Message" m
     WHERE m."id" = OLD."messageId"
       AND m."createdAt" = OLD."messageCreatedAt"
       AND m."workspaceId" = OLD."workspaceId"
       AND m."conversationId" = OLD."conversationId";
    v_old_found := FOUND;

    SELECT m."workspaceId", m."conversationId"
      INTO v_new_ws, v_new_cid
      FROM "Message" m
     WHERE m."id" = NEW."messageId"
       AND m."createdAt" = NEW."messageCreatedAt"
       AND m."workspaceId" = NEW."workspaceId"
       AND m."conversationId" = NEW."conversationId";
    v_new_found := FOUND;

    IF v_old_found AND v_new_found THEN
      PERFORM bump_source_pair(v_old_ws, v_old_cid, v_new_ws, v_new_cid);
    ELSIF v_old_found THEN
      PERFORM bump_source(v_old_ws, v_old_cid);
    ELSIF v_new_found THEN
      PERFORM bump_source(v_new_ws, v_new_cid);
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS dialogMemory_attachment_invalidation ON "Attachment";
CREATE TRIGGER dialogMemory_attachment_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON "Attachment"
  FOR EACH ROW
  EXECUTE FUNCTION dialogmemory_attachment_invalidation_fn();

CREATE OR REPLACE FUNCTION dialogmemory_topology_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = dialog_memory_gate
AS $fn$
BEGIN
  -- Monotonic bump of the global singleton.  If the row is missing we do NOT
  -- create it here; publish already fails closed in that case.
  UPDATE "DialogMemoryTopology"
     SET "topologyEpoch" = "topologyEpoch" + 1
   WHERE "id" = 'global';

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS dialogMemory_topology_invalidation_shard ON "MessageShard";
CREATE TRIGGER dialogMemory_topology_invalidation_shard
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "MessageShard"
  FOR EACH STATEMENT
  EXECUTE FUNCTION dialogmemory_topology_invalidation_fn();

DROP TRIGGER IF EXISTS dialogMemory_topology_invalidation_range ON "ShardTimeRange";
CREATE TRIGGER dialogMemory_topology_invalidation_range
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "ShardTimeRange"
  FOR EACH STATEMENT
  EXECUTE FUNCTION dialogmemory_topology_invalidation_fn();

DROP TRIGGER IF EXISTS dialogMemory_message_topology_invalidation ON "Message";
CREATE TRIGGER dialogMemory_message_topology_invalidation
  BEFORE TRUNCATE ON "Message"
  FOR EACH STATEMENT
  EXECUTE FUNCTION dialogmemory_topology_invalidation_fn();

DROP TRIGGER IF EXISTS dialogMemory_attachment_topology_invalidation ON "Attachment";
CREATE TRIGGER dialogMemory_attachment_topology_invalidation
  BEFORE TRUNCATE ON "Attachment"
  FOR EACH STATEMENT
  EXECUTE FUNCTION dialogmemory_topology_invalidation_fn();

COMMIT;
