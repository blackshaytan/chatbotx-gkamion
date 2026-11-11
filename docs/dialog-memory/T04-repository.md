# T04 B1 — Dialog memory repository

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

## What is intentionally not in B1

- `readSnapshot` / history read (B2).
- `publish` / `reset` / package barrel exports (C).
- No stubs or TODO implementations for those methods.

## Verification status

- `git diff --check` clean.
- Full TypeScript build, tests, migration runs and runtime DB checks are deferred
  to B2/C/hosted CI as agreed for this milestone.
