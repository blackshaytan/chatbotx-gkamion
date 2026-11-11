# T02 dialog memory gate — mainDB-only v1

RED-stage integration gate for the agreed mainDB-only v1 dialog memory design.

## Agreed design (approved)

- Memory is disabled for a workspace if ANY "MessageShard" registry row exists
  (including inactive/draining/retired/archived rows).
- Topology epoch is updated atomically with MessageShard / ShardTimeRange
  changes, in the same main DB transaction, and is monotonic (deleting
  registry rows never restores an older epoch).
- "sourceRevision" increments in the same main DB transaction as the
  meaningful Message / Attachment change.
- Publish CAS checks sourceRevision + memoryVersion + topologyEpoch.
- Coverage and delivery are independent concerns.

## Harness

- Runner: GitHub Actions only, `.github/workflows/dialog-memory-gate.yml`
  (manual `workflow_dispatch`, `permissions: contents: read`, no builds,
  no deploys).
- Engine: postgres:17 service container, dedicated database
  `dialog_memory_gate`.
- Tests: `python scripts/dialog-memory-gate/test_invalidation.py`
  (stdlib unittest + psycopg; psycopg installed only in the workflow).
- Hard gates inside the script:
  - `DIALOG_MEMORY_TEST_DATABASE_URL` must be set explicitly; `DATABASE_URL`
    is never used and an identical copy is refused.
  - connected `current_database()` must equal `dialog_memory_gate` before
    any write.
  - `DIALOG_MEMORY_TEST_ALLOW_WRITES=1` is required.

## Fixture (scripts/dialog-memory-gate/fixture.sql)

Dedicated schema `dialog_memory_gate` with a representative subset:

- "Message": composite PK ("id", "createdAt"), `PARTITION BY RANGE
  ("createdAt")`; two current partitions "Message_2026_h1" /
  "Message_2026_h2"; tests create "Message_2027" to verify partition
  trigger inheritance (a trigger on the parent applies to future partitions).
- "Attachment": parent identity via ("messageId", "messageCreatedAt"), no FK.
- "Workspace" / "Conversation": minimal.
- "MessageShard" / "ShardTimeRange": minimal shard registry.
- "DialogMemorySource" (per-conversation numeric "sourceRevision"),
  "DialogMemoryTopology" (per-workspace integer "topologyEpoch"),
  "DialogMemory" (summary, "memoryVersion", published "topologyEpoch").
- All ids and refs are text (string ids); "sourceRevision" is numeric
  (Decimal on the python side).
- Fixture-owned helper `publish_summary_candidate(...)` is the prospective
  publish CAS contract used to validate candidate handling. It is NOT the
  real write path and does not protect Message/Attachment rows.

## Future prototype contract (scripts/dialog-memory-gate/invalidation.sql)

FIXED NAMES — the RED suite asserts these effects; the file is loaded by the
harness when it exists (GREEN stage). It must:

- `dialogMemory_message_invalidation` trigger ON "Message": bump
  "DialogMemorySource"."sourceRevision" of the row's conversation on
  INSERT, physical DELETE, and UPDATE of meaningful columns ("text",
  "contentAttributes", "senderType", "messageType", "contentType",
  "deletedAt", identity columns). UPDATEs touching only "updatedAt" are
  content-neutral and must NOT bump.
- `dialogMemory_attachment_invalidation` trigger ON "Attachment": same
  semantics, resolved through parent identity ("conversationId",
  "messageId", "messageCreatedAt"). Rows without a resolvable parent must
  not touch any other conversation's memory.
- `dialogMemory_topology_invalidation` triggers ON "MessageShard" and
  "ShardTimeRange": bump "DialogMemoryTopology"."topologyEpoch" of the
  workspace on ANY insert (including inactive rows) and on meaning changes;
  epoch is monotonic, DELETE must not decrement or revive older epochs.

The test file never creates these triggers; doing so inside tests would turn
RED green by accident.

## Coverage

1. Message INSERT (normal and past partition date), UPDATE text,
   UPDATE contentAttributes, soft DELETE ("deletedAt"), physical DELETE,
   sender/channel provenance change.
2. Attachment insert/update/delete; attachment without a resolvable parent
   leaves foreign memory untouched.
3. Rolled back transaction does not move the committed sourceRevision.
4. updatedAt-only update is content-neutral (no invalidation).
5. Two concurrent UPDATEs serialize sourceRevision with no lost update.
6. Stale summary fails CAS after a Message edit; fresh summary passes.
7. ANY MessageShard insert (incl. inactive) bumps topology epoch and blocks
   publish with an old epoch; registry DELETE never revives old-epoch
   summaries.
8. Topology change between snapshot and publish rejects the candidate.
9. A new partition created in the test inherits the parent trigger.
10. Unknown conversation never auto-creates a memory row.
11. A foreign workspace is never affected.
