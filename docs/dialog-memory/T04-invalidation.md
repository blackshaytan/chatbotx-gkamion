# T04 — Transactional dialog memory invalidation triggers (NOT APPLIED)

> Status: `IMPLEMENTED_NOT_DB_TESTED_NOT_APPLIED`

This document describes the production-qualified invalidation SQL that was
appended to the T03 DDL migration as an explicit `MANUAL T04 INVALIDATION
BLOCK — NOT APPLIED` section. The SQL is intentionally **not executed** in this
changeset; it will be enabled later, after the architectural reader/publication
API is finalised and the T02 CI stage is green.

## Files

- SQL payload: `packages/database/drizzle/20261111211410_external_agent_dialog_memory/migration.sql`
  (T03 DDL prefix is preserved byte-for-byte; only the block after the seed
  statement is new).
- This design note: `docs/dialog-memory/T04-invalidation.md`.

## What the block does

The block installs PostgreSQL functions and triggers that keep two revision
numbers moving inside the transaction that mutates source data:

- `DialogMemorySource.sourceRevision` per `(workspaceId, conversationId)`.
- `DialogMemoryTopology.topologyEpoch` for the single global row (`id = 'global'`).

Triggers:

| Table | Timing | Scope | Action |
|-------|--------|-------|--------|
| `Message` | AFTER | ROW INSERT/UPDATE/DELETE | Take global `FOR SHARE`, then bump source revision of the affected conversation if a meaningful field changed. |
| `Attachment` | AFTER | ROW INSERT/UPDATE/DELETE | Take global `FOR SHARE`, resolve parent `Message` by full 4-column key and bump that conversation’s source revision; probe existing source rows under RR when the parent is missing. |
| `Message` | BEFORE | STATEMENT TRUNCATE | Bump global topology epoch. |
| `Attachment` | BEFORE | STATEMENT TRUNCATE | Bump global topology epoch. |
| `MessageShard` | BEFORE | STATEMENT INSERT/UPDATE/DELETE/TRUNCATE | Bump global topology epoch. |
| `ShardTimeRange` | BEFORE | STATEMENT INSERT/UPDATE/DELETE/TRUNCATE | Bump global topology epoch. |
| `Conversation` | BEFORE | ROW UPDATE OF `id`, `workspaceId`, `contactId` | If ownership changes, bump global topology epoch **before** any FK cascade reorders AFTER triggers. |

### Meaningful fields

`updatedAt` alone is neutral. For `Message`, changes to any of the following
fields bump the source revision:

`id`, `createdAt`, `conversationId`, `workspaceId`, `contactInboxId`, `text`,
`contentAttributes`, `messageType`, `contentType`, `senderType`, `senderId`,
`sourceId`, `deletedAt`, `type`, `parentId`, `attributes`, `sendError`.

For `Attachment`, all fields except `updatedAt` are meaningful, including a
parent-reference move (`messageId`, `messageCreatedAt`, `workspaceId`,
`conversationId`).

## Source-activation barrier

The first source registration for a conversation races with in-flight history
writes that already updated zero source rows and have not yet committed their
Message. After the registration commits without a revision bump, an old summary
could pass a CAS check. The block closes that race without adding a fourth table.

- `dialogmemory_lock_source_generation_fn()` runs at the start of every
  `Message`/`Attachment` row trigger. It executes:
  ```sql
  PERFORM 1 FROM public."DialogMemoryTopology" WHERE "id" = 'global' FOR SHARE;
  ```
  and raises `SQLSTATE 40001` with a retry message if the singleton is missing.
- The `FOR SHARE` lock is held until transaction end and is compatible with
  other `FOR SHARE` locks, so concurrent writes do not serialise each other.
- A registration transaction must take an **exclusive** lock on the same global
  row, create/activate the `DialogMemorySource` row, and commit Source +
  Memory + `DialogMemoryTopology.updatedAt` atomically.

### Required registration protocol (implemented elsewhere)

The activation side of the barrier is the responsibility of the registration
service, not this SQL block. The expected protocol is:

1. Begin the registration transaction.
2. Lock `public."DialogMemoryTopology"` exclusively (`FOR UPDATE` or an
   unconditional `UPDATE ... SET "updatedAt" = clock_timestamp()`).
3. Create/activate the new `DialogMemorySource` row.
4. **Unconditionally** execute:
   ```sql
   UPDATE public."DialogMemoryTopology"
      SET "updatedAt" = clock_timestamp()
    WHERE "id" = 'global';
   ```
   No `topologyEpoch` bump is performed at this step; the epoch is reserved for
   topology-wide invalidations such as truncation or ownership transfer.
5. Insert/update the `DialogMemory` candidate row in the same transaction.
6. Commit.

This guarantees that any history writer holding `FOR SHARE` cannot commit until
after the registration transaction finishes, and any later writer sees the new
source row.

### Isolation-level behaviour

- **READ COMMITTED** (default application level): a writer blocked on `FOR
  SHARE` will wait for the registration to commit, then the next SQL command
  snapshot sees the new `DialogMemorySource` row and bumps it normally.
- **REPEATABLE READ / SERIALIZABLE**: a writer whose snapshot predates the
  registration will receive `40001` on the `FOR SHARE` locking read because the
  global row was modified after the snapshot. The application must retry the
  whole transaction.
- **Missing singleton**: the lock helper raises `40001` with a retry message
  rather than silently no-oping.

## Attachment parent-not-found edge case under RR

An old RR snapshot may not see a recently inserted parent `Message` even though
its `DialogMemorySource` row already exists. If an `Attachment` write cannot find
its parent, the source revision would not be bumped and the invalidation would
be silently lost.

`dialogmemory_probe_source_snapshot_fn()` handles this:

- Under READ COMMITTED it returns immediately and takes no extra locks.
- Under REPEATABLE READ / SERIALIZABLE it locks any existing
  `DialogMemorySource` rows matching the declared old/new `(workspaceId,
  conversationId)` pairs in deterministic order with `FOR UPDATE`. If a source
  row was created or changed after the writer’s snapshot, PostgreSQL raises
  `40001` and the transaction must retry.

The probe is called:

- On `Attachment INSERT` when the parent is not found, with the new pair.
- On `Attachment DELETE` when the parent is not found, with the old pair.
- On `Attachment UPDATE` when **either** parent is not found, with **both**
  declared pairs before any source bump, preserving deterministic lock ordering.

The full parent-reference check is still required: a fake/foreign parent still
fails the lookup and does not bump another source.

## Deadlock window: registration vs. ownership transfer

The barrier introduces a new, narrow deadlock cycle that did not exist before:

- Registration `R` holds the global topology lock (`FOR UPDATE`) and then
  checks/inserts a `DialogMemorySource` row with a foreign key to `Conversation`.
  The FK check takes `FOR KEY SHARE` on the `Conversation` row.
- Concurrent ownership transfer `W` updates the same `Conversation` row (taking
  `FOR UPDATE`), then its `Message`/`Attachment` trigger waits for the global
  topology `FOR SHARE` held by `R`.

Lock order is inverted (`R`: Global → Conversation; `W`: Conversation →
Global), so PostgreSQL can detect a deadlock (`40P01`) and abort one of the
parties. Registration is idempotent on retry. The bounded retry policy for
`40001`/`40P01` must live in the application/repo; this SQL block does not
implement it.

## Design constraints

- No outer `BEGIN`/`COMMIT` or global `SET`: the migration runner owns the
  transaction.
- No auto-creation of `DialogMemorySource` rows: triggers only update existing
  rows (fail closed for unknown conversations).
- No auto-creation of the `DialogMemoryTopology` singleton: if it is missing,
  the lock helper raises a retryable error.
- Deterministic two-owner ordering via numeric `(workspaceId, conversationId)`
  tuple, preventing swap deadlocks during cross-owner moves.
- `updatedAt` is set explicitly to `now()` because Drizzle’s `$onUpdate` is not
  a database trigger.
- All functions are `SECURITY INVOKER`, `LANGUAGE plpgsql`, explicitly marked
  `VOLATILE`, set `search_path = public`, and refer to tables with the explicit
  `public.` qualifier so that `pg_temp` cannot shadow them.
- Function names use the `dialogmemory_` feature prefix, never generic names
  such as `public.bump_source`.
- Source/global epoch increments are ordinary `UPDATE` statements inside the
  same transaction; they roll back with the transaction. No non-transactional
  sequence is used.

## Owner preconditions

The block starts with a `DO` block that aborts unless:

1. All required production tables exist and the current migration role is a
   member of each table owner role: `Message`, `Attachment`, `Conversation`,
   `MessageShard`, `ShardTimeRange`, `DialogMemorySource`, `DialogMemory`,
   `DialogMemoryTopology`.
2. Any reserved `dialogmemory_*` function that already exists in `public`:
   - matches the expected argument types/signature (checked with
     `to_regprocedure`/`pg_proc`, no hardcoded OID 20), and
   - is owned by the current role or a role it inherits.

   Reserved helper signatures added by this changeset:
   - `public.dialogmemory_lock_source_generation_fn()`
   - `public.dialogmemory_probe_source_snapshot_fn(bigint, bigint, bigint, bigint)`
3. Any reserved trigger name that already exists is on the expected table and
   bound to the expected `public.dialogmemory_*_fn()` function.

These checks prevent blindly replacing objects that belong to another feature.

## Conversation ownership transfer — v1 tradeoff

The `Conversation` trigger fires **before** the update commits and before any
FK `ON UPDATE CASCADE` rewrites dependent keys. It bumps only the global
`topologyEpoch`, not each impacted `DialogMemorySource.sourceRevision`. This
is conservative: any memory cached under the old `(workspaceId, conversationId)`
identity becomes stale, but it avoids the complexity of chasing cascaded
message/attachment rows during the same statement. A future revision may add
fine-grained source bumps once the cascade order is guaranteed.

## Verification status

- `scripts/dialog-memory-gate/invalidation.sql` (the prototype source) passed
  PostgreSQL 14/16 tests separately.
- This production block has **not** been run against a real database.
- Only static checks were performed: SQL quote matching, field-list review,
  and `git diff --check`.
- The T03 DDL prefix was preserved byte-for-byte from commit `4d611907c`;
  the Drizzle snapshot was not modified.
