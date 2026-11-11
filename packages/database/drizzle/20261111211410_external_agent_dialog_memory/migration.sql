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

--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════
-- MANUAL T04 INVALIDATION BLOCK — NOT APPLIED
-- ═══════════════════════════════════════════════════════════════════════════════
-- This block is appended to the T03 DDL migration as a single transactional
-- payload, but it is intentionally NOT applied in this changeset. It will be
-- enabled by a later manual step after the architectural reader/publication
-- API is finalised and CI (T02) is green.
--
-- Scope:
--   * Message/Attachment AFTER ROW triggers take a shared lock on the global
--     DialogMemoryTopology row before any source bump, serialising source
--     activation with in-flight history writes.
--   * Message/Attachment AFTER ROW triggers bump DialogMemorySource.sourceRevision
--     for the affected (workspaceId, conversationId) when meaningful fields change.
--   * MessageShard/ShardTimeRange BEFORE STATEMENT triggers bump the global
--     DialogMemoryTopology.topologyEpoch (and updatedAt) on DML/TRUNCATE.
--   * Message/Attachment BEFORE TRUNCATE STATEMENT triggers bump the same global epoch.
--   * Conversation BEFORE UPDATE OF id/workspaceId/contactId bumps the global epoch
--     when ownership changes, invalidating old cache candidates before any FK cascade.
--
-- Design constraints kept from the prototype (scripts/dialog-memory-gate/invalidation.sql):
--   - No outer BEGIN/COMMIT or global SET: the migration runner controls the transaction.
--   - No auto-creation of DialogMemorySource rows; triggers update existing rows only.
--   - No auto-creation of the DialogMemoryTopology singleton; fail closed if missing.
--   - Deterministic two-owner ordering via numeric (workspaceId, conversationId) tuple.
--   - Attachment parent lookup uses the full 4-column key (workspaceId, conversationId,
--     messageId, messageCreatedAt); a fake/foreign parent does not invalidate another source.
--   - updatedAt is bumped explicitly because Drizzle $onUpdate is not a DB trigger.
--   - All function/table references are public-qualified and each function sets
--     search_path = public with SECURITY INVOKER explicitly.
--   - All writer functions are marked VOLATILE so READ COMMITTED writers use a fresh
--     SQL-command snapshot after the shared global barrier is released.
--
-- Source-activation barrier:
--   * dialogmemory_lock_source_generation_fn() acquires FOR SHARE on the global
--     DialogMemoryTopology row at the start of every Message/Attachment write.
--     The lock is held until transaction end and is compatible with other SHAREs.
--   * A source-registration transaction must take an exclusive lock on the same
--     global row (FOR UPDATE or unconditional UPDATE), create/activate the new
--     DialogMemorySource row, and commit Source + Memory + global.updatedAt together.
--   * Under READ COMMITTED the writer sees the freshly-committed Source row in the
--     next command snapshot and bumps it normally.
--   * Under REPEATABLE READ / SERIALIZABLE a writer whose snapshot predates the
--     source activation receives 40001 on the locking read and must retry.
--   * If the global singleton is missing the lock helper raises 40001 with a
--     retry-the-transaction message; it never silently no-ops.
--
-- Attachment parent-not-found edge case (RR):
--   * An old RR snapshot may not see a recently-inserted parent Message even though
--     its DialogMemorySource already exists. When Attachment INSERT/UPDATE/DELETE
--     cannot resolve the parent, dialogmemory_probe_source_snapshot_fn() locks any
--     existing source pair under RR; a source row changed after the snapshot
--     forces 40001. Under RC the probe is a no-op and takes no extra locks.
--
-- Owner preconditions are checked first: required tables must exist and be owned
-- by the current migration role (or a role it inherits), reserved functions must
-- either not exist or match the expected signature and owner, and reserved trigger
-- names must either not exist or be attached to the expected table/function.
--
-- WARNING: SQL runtime tests have NOT been executed against a real database for
-- this production-qualified block. Static checks (quote matching, field lists,
-- git diff --check) are the only verification performed so far.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_current_role regrole := current_user::regrole;
  v_class regclass;
  v_proc regprocedure;
  v_expected_name text;
BEGIN
  -- 1. Required production tables must exist and be owned by the migration role
  --    (or by a role the current role can inherit).
  FOREACH v_class IN ARRAY ARRAY[
    to_regclass('public."Message"'),
    to_regclass('public."Attachment"'),
    to_regclass('public."Conversation"'),
    to_regclass('public."MessageShard"'),
    to_regclass('public."ShardTimeRange"'),
    to_regclass('public."DialogMemorySource"'),
    to_regclass('public."DialogMemory"'),
    to_regclass('public."DialogMemoryTopology"')
  ] LOOP
    IF v_class IS NULL THEN
      RAISE EXCEPTION 'T04 precondition failed: a required public table does not exist';
    END IF;
    IF NOT pg_has_role(v_current_role, (SELECT relowner FROM pg_class WHERE oid = v_class), 'MEMBER') THEN
      RAISE EXCEPTION 'T04 precondition failed: current role % is not owner/member of owner for %', v_current_role, v_class;
    END IF;
  END LOOP;

  -- 2. Reserved feature functions: if they already exist they must match the
  --    expected signature (checked via to_regprocedure/pg_proc, no hardcoded OID 20)
  --    and be owned by the current role or an inheritable owner role.
  v_expected_name := 'dialogmemory_bump_source';
  v_proc := to_regprocedure('public.dialogmemory_bump_source(bigint, bigint)');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_bump_source_pair';
  v_proc := to_regprocedure('public.dialogmemory_bump_source_pair(bigint, bigint, bigint, bigint)');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_lock_source_generation_fn';
  v_proc := to_regprocedure('public.dialogmemory_lock_source_generation_fn()');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_probe_source_snapshot_fn';
  v_proc := to_regprocedure('public.dialogmemory_probe_source_snapshot_fn(bigint, bigint, bigint, bigint)');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_message_invalidation_fn';
  v_proc := to_regprocedure('public.dialogmemory_message_invalidation_fn()');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_attachment_invalidation_fn';
  v_proc := to_regprocedure('public.dialogmemory_attachment_invalidation_fn()');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_topology_invalidation_fn';
  v_proc := to_regprocedure('public.dialogmemory_topology_invalidation_fn()');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  v_expected_name := 'dialogmemory_conversation_invalidation_fn';
  v_proc := to_regprocedure('public.dialogmemory_conversation_invalidation_fn()');
  IF v_proc IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_expected_name
    ) THEN
      RAISE EXCEPTION 'T04 precondition failed: public.% exists with an unexpected signature', v_expected_name;
    END IF;
  ELSIF NOT pg_has_role(v_current_role, (SELECT proowner FROM pg_proc WHERE oid = v_proc), 'MEMBER') THEN
    RAISE EXCEPTION 'T04 precondition failed: existing public.% is owned by a role not accessible to %', v_expected_name, v_current_role;
  END IF;

  -- 3. Reserved trigger names: if they already exist they must be on the expected
  --    table and bound to the expected public function. We never drop a foreign
  --    trigger owned by another feature.
  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'Message'
     AND t.tgname = 'dialogmemory_message_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."Message"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_message_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_message_invalidation exists on an unexpected table/function';
  END IF;

  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'Attachment'
     AND t.tgname = 'dialogmemory_attachment_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."Attachment"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_attachment_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_attachment_invalidation exists on an unexpected table/function';
  END IF;

  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'Message'
     AND t.tgname = 'dialogmemory_message_topology_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."Message"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_topology_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_message_topology_invalidation exists on an unexpected table/function';
  END IF;

  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'Attachment'
     AND t.tgname = 'dialogmemory_attachment_topology_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."Attachment"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_topology_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_attachment_topology_invalidation exists on an unexpected table/function';
  END IF;

  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'MessageShard'
     AND t.tgname = 'dialogmemory_shard_topology_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."MessageShard"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_topology_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_shard_topology_invalidation exists on an unexpected table/function';
  END IF;

  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ShardTimeRange'
     AND t.tgname = 'dialogmemory_range_topology_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."ShardTimeRange"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_topology_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_range_topology_invalidation exists on an unexpected table/function';
  END IF;

  PERFORM 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'Conversation'
     AND t.tgname = 'dialogmemory_conversation_invalidation'
     AND (t.tgrelid IS DISTINCT FROM to_regclass('public."Conversation"')
          OR t.tgfoid::regprocedure IS DISTINCT FROM to_regprocedure('public.dialogmemory_conversation_invalidation_fn()'));
  IF FOUND THEN
    RAISE EXCEPTION 'T04 precondition failed: trigger dialogmemory_conversation_invalidation exists on an unexpected table/function';
  END IF;
END $$;
--> statement-breakpoint

-- Shared lock on the global topology row. Every Message/Attachment write must
-- hold this lock for the lifetime of its transaction so that source activation
-- (a FOR UPDATE / NO KEY UPDATE on the same row) cannot interleave with an
-- uncommitted history write.
CREATE OR REPLACE FUNCTION public.dialogmemory_lock_source_generation_fn()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  PERFORM 1
    FROM public."DialogMemoryTopology"
   WHERE "id" = 'global'
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DialogMemoryTopology global singleton is missing; retry the transaction'
      USING ERRCODE = '40001';
  END IF;
END;
$fn$;
--> statement-breakpoint

-- Bump an existing DialogMemorySource row for exactly one owner.
-- No-op if the row does not exist (unknown conversation stays unknown).
CREATE OR REPLACE FUNCTION public.dialogmemory_bump_source(
  p_workspace_id bigint,
  p_conversation_id bigint
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public."DialogMemorySource"
     SET "sourceRevision" = "sourceRevision" + 1,
         "updatedAt" = now()
   WHERE "workspaceId" = p_workspace_id
     AND "conversationId" = p_conversation_id;
END;
$fn$;
--> statement-breakpoint

-- Bump up to two source owners in a deterministic order so cross-owner moves
-- (conversation reassignment, workspace transfer) cannot swap-deadlock.
CREATE OR REPLACE FUNCTION public.dialogmemory_bump_source_pair(
  p_old_workspace_id bigint,
  p_old_conversation_id bigint,
  p_new_workspace_id bigint,
  p_new_conversation_id bigint
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  IF p_old_workspace_id = p_new_workspace_id
     AND p_old_conversation_id = p_new_conversation_id THEN
    PERFORM public.dialogmemory_bump_source(p_old_workspace_id, p_old_conversation_id);
  ELSIF (p_old_workspace_id, p_old_conversation_id)
        < (p_new_workspace_id, p_new_conversation_id) THEN
    PERFORM public.dialogmemory_bump_source(p_old_workspace_id, p_old_conversation_id);
    PERFORM public.dialogmemory_bump_source(p_new_workspace_id, p_new_conversation_id);
  ELSE
    PERFORM public.dialogmemory_bump_source(p_new_workspace_id, p_new_conversation_id);
    PERFORM public.dialogmemory_bump_source(p_old_workspace_id, p_old_conversation_id);
  END IF;
END;
$fn$;
--> statement-breakpoint

-- RR/SERIALIZABLE probe for Attachment writes whose parent Message is missing.
-- A repeatable-read snapshot taken before the parent row committed can fail to
-- see the parent, but the DialogMemorySource row created at registration time
-- will be visible to FOR UPDATE. Locking it forces 40001 if it changed after the
-- snapshot, preventing a silent lost invalidation. Under READ COMMITTED this
-- helper returns immediately and takes no extra locks.
CREATE OR REPLACE FUNCTION public.dialogmemory_probe_source_snapshot_fn(
  p_old_workspace_id bigint,
  p_old_conversation_id bigint,
  p_new_workspace_id bigint,
  p_new_conversation_id bigint
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RETURN;
  END IF;

  PERFORM 1
    FROM public."DialogMemorySource"
   WHERE ("workspaceId", "conversationId") = (p_old_workspace_id, p_old_conversation_id)
      OR ("workspaceId", "conversationId") = (p_new_workspace_id, p_new_conversation_id)
   ORDER BY "workspaceId", "conversationId"
   FOR UPDATE;
END;
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.dialogmemory_message_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_meaningful boolean := false;
BEGIN
  PERFORM public.dialogmemory_lock_source_generation_fn();

  IF TG_OP = 'INSERT' THEN
    PERFORM public.dialogmemory_bump_source(NEW."workspaceId", NEW."conversationId");
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.dialogmemory_bump_source(OLD."workspaceId", OLD."conversationId");
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
    PERFORM public.dialogmemory_bump_source_pair(
      OLD."workspaceId", OLD."conversationId",
      NEW."workspaceId", NEW."conversationId"
    );
  END IF;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.dialogmemory_attachment_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_meaningful boolean := false;
  v_old_ws bigint;
  v_old_cid bigint;
  v_new_ws bigint;
  v_new_cid bigint;
  v_old_found boolean := false;
  v_new_found boolean := false;
BEGIN
  PERFORM public.dialogmemory_lock_source_generation_fn();

  IF TG_OP = 'INSERT' THEN
    SELECT m."workspaceId", m."conversationId"
      INTO v_new_ws, v_new_cid
      FROM public."Message" m
     WHERE m."id" = NEW."messageId"
       AND m."createdAt" = NEW."messageCreatedAt"
       AND m."workspaceId" = NEW."workspaceId"
       AND m."conversationId" = NEW."conversationId";

    IF FOUND THEN
      PERFORM public.dialogmemory_bump_source(v_new_ws, v_new_cid);
    ELSE
      -- Parent missing under RR may mean the row was created after our snapshot.
      -- Probe the declared source pair; a post-snapshot source forces retry.
      PERFORM public.dialogmemory_probe_source_snapshot_fn(
        NULL, NULL,
        NEW."workspaceId", NEW."conversationId"
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT m."workspaceId", m."conversationId"
      INTO v_old_ws, v_old_cid
      FROM public."Message" m
     WHERE m."id" = OLD."messageId"
       AND m."createdAt" = OLD."messageCreatedAt"
       AND m."workspaceId" = OLD."workspaceId"
       AND m."conversationId" = OLD."conversationId";

    IF FOUND THEN
      PERFORM public.dialogmemory_bump_source(v_old_ws, v_old_cid);
    ELSE
      PERFORM public.dialogmemory_probe_source_snapshot_fn(
        OLD."workspaceId", OLD."conversationId",
        NULL, NULL
      );
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
      FROM public."Message" m
     WHERE m."id" = OLD."messageId"
       AND m."createdAt" = OLD."messageCreatedAt"
       AND m."workspaceId" = OLD."workspaceId"
       AND m."conversationId" = OLD."conversationId";
    v_old_found := FOUND;

    SELECT m."workspaceId", m."conversationId"
      INTO v_new_ws, v_new_cid
      FROM public."Message" m
     WHERE m."id" = NEW."messageId"
       AND m."createdAt" = NEW."messageCreatedAt"
       AND m."workspaceId" = NEW."workspaceId"
       AND m."conversationId" = NEW."conversationId";
    v_new_found := FOUND;

    -- If a parent is missing we may be looking at an old RR snapshot. Lock any
    -- existing source pair first so the lock order stays deterministic.
    IF NOT v_old_found OR NOT v_new_found THEN
      PERFORM public.dialogmemory_probe_source_snapshot_fn(
        OLD."workspaceId", OLD."conversationId",
        NEW."workspaceId", NEW."conversationId"
      );
    END IF;

    IF v_old_found AND v_new_found THEN
      PERFORM public.dialogmemory_bump_source_pair(v_old_ws, v_old_cid, v_new_ws, v_new_cid);
    ELSIF v_old_found THEN
      PERFORM public.dialogmemory_bump_source(v_old_ws, v_old_cid);
    ELSIF v_new_found THEN
      PERFORM public.dialogmemory_bump_source(v_new_ws, v_new_cid);
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

-- Monotonic bump of the global singleton. If the row is missing we do NOT
-- create it here; publication already fails closed in that case.
CREATE OR REPLACE FUNCTION public.dialogmemory_topology_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public."DialogMemoryTopology"
     SET "topologyEpoch" = "topologyEpoch" + 1,
         "updatedAt" = now()
   WHERE "id" = 'global';

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

-- Conversation ownership transfer (id/workspaceId/contactId) invalidates every
-- cached memory candidate before FK cascades can reorder AFTER triggers.
-- This is intentionally conservative: we bump only the global topology epoch,
-- not each sourceRevision, accepting a v1 tradeoff of wider cache invalidation.
CREATE OR REPLACE FUNCTION public.dialogmemory_conversation_invalidation_fn()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  IF (OLD."id", OLD."workspaceId", OLD."contactId")
     IS DISTINCT FROM
     (NEW."id", NEW."workspaceId", NEW."contactId") THEN
    UPDATE public."DialogMemoryTopology"
       SET "topologyEpoch" = "topologyEpoch" + 1,
           "updatedAt" = now()
     WHERE "id" = 'global';
  END IF;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_message_invalidation ON public."Message";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_message_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public."Message"
  FOR EACH ROW
  EXECUTE FUNCTION public.dialogmemory_message_invalidation_fn();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_attachment_invalidation ON public."Attachment";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_attachment_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public."Attachment"
  FOR EACH ROW
  EXECUTE FUNCTION public.dialogmemory_attachment_invalidation_fn();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_message_topology_invalidation ON public."Message";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_message_topology_invalidation
  BEFORE TRUNCATE ON public."Message"
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.dialogmemory_topology_invalidation_fn();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_attachment_topology_invalidation ON public."Attachment";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_attachment_topology_invalidation
  BEFORE TRUNCATE ON public."Attachment"
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.dialogmemory_topology_invalidation_fn();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_shard_topology_invalidation ON public."MessageShard";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_shard_topology_invalidation
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."MessageShard"
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.dialogmemory_topology_invalidation_fn();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_range_topology_invalidation ON public."ShardTimeRange";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_range_topology_invalidation
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public."ShardTimeRange"
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.dialogmemory_topology_invalidation_fn();
--> statement-breakpoint

DROP TRIGGER IF EXISTS dialogmemory_conversation_invalidation ON public."Conversation";
--> statement-breakpoint
CREATE TRIGGER dialogmemory_conversation_invalidation
  BEFORE UPDATE OF "id", "workspaceId", "contactId" ON public."Conversation"
  FOR EACH ROW
  EXECUTE FUNCTION public.dialogmemory_conversation_invalidation_fn();
