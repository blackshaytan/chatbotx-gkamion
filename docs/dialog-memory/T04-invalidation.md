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
  global statement is new).
- This design note: `docs/dialog-memory/T04-invalidation.md`.

## What the block does

The block installs PostgreSQL functions and triggers that keep two revision
numbers moving inside the transaction that mutates source data:

- `DialogMemorySource.sourceRevision` per `(workspaceId, conversationId)`.
- `DialogMemoryTopology.topologyEpoch` for the single global row (`id = 'global'`).

Triggers:

| Table | Timing | Scope | Action |
|-------|--------|-------|--------|
| `Message` | AFTER | ROW INSERT/UPDATE/DELETE | Bump source revision of the affected conversation if a meaningful field changed. |
| `Attachment` | AFTER | ROW INSERT/UPDATE/DELETE | Resolve parent `Message` by full 4-column key and bump that conversation’s source revision. |
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

## Design constraints

- No outer `BEGIN`/`COMMIT` or global `SET`: the migration runner owns the
  transaction.
- No auto-creation of `DialogMemorySource` rows: triggers only update existing
  rows (fail closed for unknown conversations).
- No auto-creation of the `DialogMemoryTopology` singleton: if it is missing,
  the topology bump is a no-op and publication already fails closed.
- Deterministic two-owner ordering via numeric `(workspaceId, conversationId)`
  tuple, preventing swap deadlocks during cross-owner moves.
- `updatedAt` is set explicitly to `now()` because Drizzle’s `$onUpdate` is not
  a database trigger.
- All functions are `SECURITY INVOKER`, set `search_path = public`, and refer to
  tables with the explicit `public.` qualifier so that `pg_temp` cannot shadow
  them.
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
3. Any reserved trigger name that already exists is on the expected table and
   bound to the expected `public.dialogmemory_*_fn()` function.

These checks prevent blindly replacing objects that belong to another feature.

## Conversation ownership transfer — v1 tradeoff

The `Conversation` trigger fires **before** the update commits and before any
FK `ON UPDATE CASCADE` rewrites dependent keys. It bumps only the global
`topologyEpoch`, not every impacted `DialogMemorySource.sourceRevision`. This
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
