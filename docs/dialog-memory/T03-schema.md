# T03 — Isolated dialog memory storage schema

This document describes the schema changes committed under T03. It is a
storage-only foundation. Triggers and registration/publication logic belong
to T04; LLM integration belongs to the later T09–T11 stages.

## New tables

### `DialogMemorySource`

- Composite PK `(workspaceId, conversationId)`.
- `sourceRevision` bigint (string in app) NOT NULL DEFAULT '0', CHECK >= 0.
- Composite FK to `Conversation(workspaceId, id)` cascading.
- Requires the additive unique index `Conversation_workspaceId_id_key` on the
  existing `Conversation` table.

### `DialogMemory`

- Composite PK `(workspaceId, conversationId)` and composite FK to
  `Conversation(workspaceId, id)` cascading.
- `summary` jsonb opaque `Record<string, unknown>` nullable, no default.
- `schemaVersion` integer NOT NULL CHECK >= 1.
- `promptVersion`, `model`, `provider` text NOT NULL.
- `memoryVersion` bigint NOT NULL DEFAULT '1' CHECK >= 1.
- `coveredSourceRevision` bigint NOT NULL CHECK >= 0.
- `topologyEpoch` bigint NOT NULL DEFAULT '0' CHECK >= 0.
- `coverageMessageId` bigint nullable and `coverageCreatedAt` timestamp
  nullable with CHECK both NULL or both non-NULL. No FK to `Message`.
- `lastError` text nullable, `lastAttemptAt` timestamp nullable.

### `DialogMemoryTopology`

- Singleton row keyed by `id` text PRIMARY KEY DEFAULT 'global',
  CHECK `id = 'global'`.
- `topologyEpoch` bigint NOT NULL DEFAULT '0' CHECK >= 0.
- `updatedAt` only (no `createdAt`), using shared timestamp column.

## What is deliberately NOT in this commit

- No `db:migrate`, `db:push`, or introspection.
- No triggers, registration/publish logic, or LLM input formatting.
- No stored freshness/state enum; freshness is computed from revisions and
  epoch.
- No FK to `Message` or `Attachment`.
- No partials, enums, or empty files.

## Verification status

`SCHEMA_AND_MIGRATION_GENERATED_NOT_APPLIED`.

The real offline generator (`drizzle-kit` / `drizzle-orm` 1.0.0-beta.22,
Node 24.22.3) ran `sh scripts/make-migration.sh external_agent_dialog_memory`
successfully with an allowlisted environment, no dotenv, and an unused dummy
database URL. It produced these files:

- `packages/database/drizzle/20261111211410_external_agent_dialog_memory/migration.sql`
- `packages/database/drizzle/20261111211410_external_agent_dialog_memory/snapshot.json`

The snapshot is unedited generator output. Its `prevIds` matches the preceding
`20261107111947_inbox_unread_first` snapshot. A structural comparison found only
the three new tables and their columns/constraints plus the additive
Conversation index; no existing schema entities were removed or changed.

The SQL has one clearly marked manual data seed after the generated DDL:
`DialogMemoryTopology(id='global', topologyEpoch=0) ON CONFLICT DO NOTHING`.
It does not reset an existing epoch. Primary-key columns are implicitly
NOT NULL in PostgreSQL even where the generator omits a separate NOT NULL.

No migration was applied. Type checking, database-execution tests, and the
deferred T02 hosted CI are not claimed as passed. The Creator explicitly
authorized proceeding with T03 without waiting for that CI.
