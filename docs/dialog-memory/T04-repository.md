# T04 B1/B2 — Dialog memory repository

## Files

- `packages/database/src/repositories/external-agent/dialog-memory-types.ts`
  Pure types, DTOs and runtime validators. No database runtime imports.
- `packages/database/src/repositories/external-agent/dialog-memory-context.ts`
  Transaction-only helpers: retry wrapper, topology/ownership/shard/retention guards, locked source/memory loader, DTO builder and token checks.
- `packages/database/src/repositories/external-agent/dialog-memory.ts`
  Public `dialogMemoryRepository` with the B1 `register` method.

## What B1 does

`dialogMemoryRepository.register({ scope, config })` is the only public operation.
It runs inside its own short `read committed` transaction on the single primary
pool and:

1. Validates scope (`workspaceId`, `conversationId`, `expectedContactId`) and config
   (`schemaVersion`, `promptVersion`, `model`, `provider`) without parsing/normalizing
   bigint strings as numbers.
2. Locks `DialogMemoryTopology` (`id = 'global'`) `FOR UPDATE`.
3. Verifies the conversation exists and matches `expectedContactId`.
4. Rejects the scope if any `MessageShard` row exists (main-DB-only v1).
5. Allows plain Postgres; with TimescaleDB allows only known builtin
   `policy_compression` jobs on `Message`/`Attachment`.
6. Locks `DialogMemorySource` then `DialogMemory` `FOR UPDATE`.
7. If both exist, returns the existing memory unchanged.
8. If both are missing, inserts both with `ON CONFLICT DO NOTHING`, re-reads under
   locks, detects partial inserts, and touches the global topology row with
   `clock_timestamp()` without bumping the epoch.

## Result shape

Discriminated union:

- `ok` with `{ token, memory, created }`
- `not_found`
- `unsupported`
- `inconsistent`
- `invalid`
- `unavailable`

All failure reasons are constant strings; no raw SQL, messages or PII are returned.

## What B2 adds

`dialogMemoryRepository.readSnapshot(input)` returns a reverse-chronological
page of the full main-DB conversation history.

1. Validates `scope`, optional `limit` (default 100, 1..200), optional `cursor`
   (`{id, createdAtMicros}`), and optional `expectedToken` using pure validators.
   `expectedToken` is required when `cursor` is provided. The public method
   declares the input as `DialogMemorySnapshotInput`, a typed discriminated
   union; the runtime validator still accepts `unknown` and rejects malformed
   or `null` inputs safely.
2. Runs the same guarded transaction as `register`: lock global topology, verify
   conversation ownership, reject message sharding, check retention policy, then
   lock `DialogMemorySource` and `DialogMemory`.
3. Detects unregistered / inconsistent source-memory pairs.
4. Builds the actual token from the **current** `sourceRevision`,
   `memoryVersion`, and global `topologyEpoch`, and compares it strictly with
   `expectedToken` when present. A mismatch returns `conflict` with no items.
5. Validates that a provided cursor anchor exists in `Message` for the exact
   scope; the `EXISTS` result is checked strictly (`!== true`) so non-boolean
   or missing metadata never starts a data read.
6. Reads history from canonical public `Message`/`Attachment` only, with
   microsecond-precision tuple cursors, no shard pools, no JS date rounding,
   and no filtering by role/channel/kind/deletion status. Every `Message`
   lookup after the issued reference list includes `workspaceId` and
   `conversationId` ownership filters in addition to the primary-key pair.
7. Groups attachments by the full parent reference `(workspaceId,
   conversationId, messageId, messageCreatedAt)` and enforces resource guards:
   the attachment count and logical byte-size preflight require well-formed
   metadata; missing or malformed preflight rows return `unavailable` with
   `HISTORY_PREFLIGHT_INVALID`, while counts above 1000 or logical bytes above
   8 MiB return `unsupported`.

## Result shape

Discriminated union with all failure variants typed:

- `ok` with `{ scope, token, memory, items, hasMore, nextCursor }`
- `not_found`
- `unsupported`
- `inconsistent`
- `unregistered`
- `conflict`
- `invalid`
- `unavailable`

All reasons are constant strings; no raw SQL, messages or PII are returned.

## What is intentionally not in B2

- `publish` / `reset` / package barrel exports (C).
- No stubs or TODO implementations for those methods.

## Verification status

- `git diff --check` clean.
- Full TypeScript build, tests, migration runs and runtime DB checks are deferred
  to C/hosted CI as agreed for this milestone.
