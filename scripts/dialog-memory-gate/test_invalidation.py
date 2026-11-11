#!/usr/bin/env python3
"""T02 RED-stage integration gate: dialog memory mainDB-only v1 invalidation.

Runs ONLY in GitHub Actions against a dedicated PostgreSQL (service container)
database named ``dialog_memory_gate``. Hard requirements:

  * DIALOG_MEMORY_TEST_DATABASE_URL set explicitly (never DATABASE_URL)
  * connected database name equals ``dialog_memory_gate``
  * DIALOG_MEMORY_TEST_ALLOW_WRITES=1

The future prototype triggers/functions will live in
``scripts/dialog-memory-gate/invalidation.sql``. In the RED stage that file
does not exist on purpose: the harness runs the fixture WITHOUT triggers and
tests must FAIL on the expected missing effects (not on import/syntax errors).
If the file exists, it is applied so the same suite turns GREEN.

Contract names are fixed in docs/dialog-memory/T02-gate.md.
"""

from __future__ import annotations

import os
import pathlib
import sys
import threading
import unittest

REQUIRED_DB = "dialog_memory_gate"
BASE = pathlib.Path(__file__).resolve().parent
FIXTURE = BASE / "fixture.sql"
INVALIDATION = BASE / "invalidation.sql"

try:
    import psycopg
except ImportError:  # pip install happens only inside the workflow
    sys.stderr.write(
        "psycopg is required. In CI: pip install 'psycopg[binary]'\n"
        "Do not run this suite against any non-CI database.\n"
    )
    raise SystemExit(1)

URL = os.environ.get("DIALOG_MEMORY_TEST_DATABASE_URL")
ALLOW = os.environ.get("DIALOG_MEMORY_TEST_ALLOW_WRITES")


def _guard_env() -> None:
    if not URL:
        raise SystemExit(
            "DIALOG_MEMORY_TEST_DATABASE_URL is not set. "
            "Refusing to run (DATABASE_URL is never used for this gate)."
        )
    if os.environ.get("DATABASE_URL") == URL:
        raise SystemExit(
            "DIALOG_MEMORY_TEST_DATABASE_URL must be an explicit dedicated CI "
            "URL, not a copy of DATABASE_URL."
        )
    if ALLOW != "1":
        raise SystemExit(
            "DIALOG_MEMORY_TEST_ALLOW_WRITES=1 is required. Refusing without it."
        )


def _connect(dbname: str | None = None) -> "psycopg.Connection":
    assert URL is not None
    if dbname is None:
        return psycopg.connect(URL, autocommit=True)
    info = psycopg.conninfo.make_conninfo(URL)
    parts = {
        k: v for k, v in psycopg.conninfo.conninfo_to_dict(info).items() if v
    }
    parts["dbname"] = dbname
    return psycopg.connect(**parts, autocommit=True)


class GateBase(unittest.TestCase):
    conn: "psycopg.Connection"

    @classmethod
    def setUpClass(cls) -> None:
        # Create the dedicated database idempotently via the maintenance DB
        # derived from the same URL (postgres:17 service ships empty).
        maintenance = _connect("postgres")
        try:
            with maintenance.cursor() as cur:
                cur.execute(
                    f"SELECT 1 FROM pg_database WHERE datname = '{REQUIRED_DB}'"
                )
                if cur.fetchone() is None:
                    cur.execute(f'CREATE DATABASE "{REQUIRED_DB}"')
        finally:
            maintenance.close()
        cls.conn = _connect()
        with cls.conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            db = cur.fetchone()[0]
        if db != REQUIRED_DB:
            raise SystemExit(
                f"connected database is {db!r}, expected {REQUIRED_DB!r}. "
                "Wrong database identity; refusing to write."
            )
        # Dedicated schema, built from scratch per run.
        with cls.conn.cursor() as cur:
            cur.execute("SET search_path = dialog_memory_gate, public")
            cur.execute("DROP SCHEMA IF EXISTS dialog_memory_gate CASCADE")
            cur.execute(FIXTURE.read_text(encoding="utf-8"))
            if INVALIDATION.exists():  # GREEN stage only; never in RED
                cur.execute(INVALIDATION.read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.conn.close()

    def setUp(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SET search_path = dialog_memory_gate, public")
            for table in (
                '"DialogMemory"',
                '"DialogMemorySource"',
                '"DialogMemoryTopology"',
                '"ShardTimeRange"',
                '"MessageShard"',
                '"Attachment"',
                '"Message"',
                '"Conversation"',
                '"Workspace"',
            ):
                cur.execute(f"TRUNCATE {table} CASCADE")

    # ---- tiny data helpers -------------------------------------------------
    def make_workspace(self, wid: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Workspace" ("id") VALUES (%s)'
                ' ON CONFLICT ("id") DO NOTHING',
                (wid,),
            )
            cur.execute(
                'INSERT INTO "DialogMemoryTopology" ("workspaceId")'
                " VALUES (%s) ON CONFLICT DO NOTHING",
                (wid,),
            )

    def make_conversation(self, wid: str, cid: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Conversation" ("id", "workspaceId") VALUES (%s, %s)',
                (cid, wid),
            )
            cur.execute(
                'INSERT INTO "DialogMemorySource"'
                ' ("conversationId", "workspaceId") VALUES (%s, %s)'
                " ON CONFLICT DO NOTHING",
                (cid, wid),
            )

    def make_memory(self, wid: str, cid: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "DialogMemory"'
                ' ("conversationId", "workspaceId", "summary", "topologyEpoch")'
                " VALUES (%s, %s, 'seed', 0)",
                (cid, wid),
            )

    def insert_message(
        self,
        wid: str,
        cid: str,
        mid: str,
        created: str = "2026-03-01 10:00:00+00",
        text: str = "hello",
        sender: str = "contact",
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Message" ("id", "createdAt", "conversationId",'
                ' "contactInboxId", "workspaceId", "text", "messageType",'
                ' "contentType", "senderType")'
                " VALUES (%s, %s, %s, 'inbox-1', %s, %s, 'incoming', 'text', %s)",
                (mid, created, cid, wid, text, sender),
            )

    def insert_attachment(
        self, wid: str, cid: str, aid: str, mid: str, mcreated: str
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Attachment" ("id", "conversationId", "workspaceId",'
                ' "messageId", "messageCreatedAt", "fileType", "originPath")'
                " VALUES (%s, %s, %s, %s, %s, 'image', %s)",
                (aid, cid, wid, mid, mcreated, f"s3://gate/{aid}"),
            )

    def revision_of(self, cid: str):
        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "sourceRevision" FROM "DialogMemorySource"'
                ' WHERE "conversationId" = %s',
                (cid,),
            )
            row = cur.fetchone()
        return row[0] if row else None

    def epoch_of(self, wid: str) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "topologyEpoch" FROM "DialogMemoryTopology"'
                ' WHERE "workspaceId" = %s',
                (wid,),
            )
            row = cur.fetchone()
        return int(row[0]) if row else 0

    def memory_row(self, cid: str):
        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "summary", "memoryVersion", "topologyEpoch"'
                ' FROM "DialogMemory" WHERE "conversationId" = %s',
                (cid,),
            )
            return cur.fetchone()

    def publish(
        self, cid: str, summary: str, revision, version: int, epoch: int
    ) -> bool:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT publish_summary_candidate(%s, %s, %s, %s, %s)",
                (cid, summary, revision, version, epoch),
            )
            return bool(cur.fetchone()[0])


class MessageInvalidationTests(GateBase):
    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-1")
        self.make_conversation("ws-1", "conv-1")
        self.make_memory("ws-1", "conv-1")

    def test_insert_message_bumps_source_revision(self) -> None:
        before = self.revision_of("conv-1")
        self.insert_message("ws-1", "conv-1", "m-1")
        self.assertNotEqual(self.revision_of("conv-1"), before)

    def test_insert_with_past_partition_date_bumps_revision(self) -> None:
        before = self.revision_of("conv-1")
        self.insert_message(
            "ws-1", "conv-1", "m-old", created="2026-02-10 09:00:00+00"
        )
        self.assertNotEqual(self.revision_of("conv-1"), before)

    def test_update_text_bumps_revision(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-2")
        rev0 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE \"Message\" SET \"text\" = 'edited',"
                ' "updatedAt" = now() WHERE "id" = %s',
                ("m-2",),
            )
        rev1 = self.revision_of("conv-1")
        self.assertIsNotNone(rev0)
        self.assertGreater(rev1, rev0)

    def test_update_content_attributes_bumps_revision(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-3")
        rev0 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE \"Message\" SET \"contentAttributes\" = '{\"k\":1}'::jsonb"
                ' WHERE "id" = %s',
                ("m-3",),
            )
        self.assertGreater(self.revision_of("conv-1"), rev0)

    def test_soft_delete_bumps_revision(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-4")
        rev0 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Message" SET "deletedAt" = now() WHERE "id" = %s',
                ("m-4",),
            )
        self.assertGreater(self.revision_of("conv-1"), rev0)

    def test_physical_delete_bumps_revision(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-5")
        rev0 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "Message" WHERE "id" = %s', ("m-5",))
        self.assertGreater(self.revision_of("conv-1"), rev0)

    def test_sender_provenance_change_bumps_revision(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-6")
        rev0 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE \"Message\" SET \"senderType\" = 'bot',"
                " \"messageType\" = 'outgoing' WHERE \"id\" = %s",
                ("m-6",),
            )
        self.assertGreater(self.revision_of("conv-1"), rev0)

    def test_updated_at_only_is_content_neutral(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-7")
        rev0 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Message" SET "updatedAt" = "updatedAt" +'
                " interval '1 second' WHERE \"id\" = %s",
                ("m-7",),
            )
        self.assertEqual(self.revision_of("conv-1"), rev0)

    def test_rollback_does_not_move_committed_revision(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-8")
        rev0 = self.revision_of("conv-1")
        tx = _connect()
        try:
            with tx.cursor() as cur:
                cur.execute("BEGIN")
                cur.execute("SET search_path = dialog_memory_gate, public")
                cur.execute(
                    "UPDATE \"Message\" SET \"text\" = 'rolled back'"
                    ' WHERE "id" = %s',
                    ("m-8",),
                )
                cur.execute("ROLLBACK")
        finally:
            tx.close()
        self.assertEqual(self.revision_of("conv-1"), rev0)

    def test_concurrent_updates_serialize_without_lost_update(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-9")
        rev0 = self.revision_of("conv-1")
        barrier = threading.Barrier(2)
        errors: list[BaseException] = []

        def bump(value: str) -> None:
            try:
                conn = _connect()
                with conn.cursor() as cur:
                    barrier.wait(timeout=10)
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    cur.execute(
                        'UPDATE "Message" SET "text" = %s WHERE "id" = %s',
                        (value, "m-9"),
                    )
                conn.close()
            except BaseException as exc:  # pragma: no cover - diagnostic
                errors.append(exc)
                raise

        t1 = threading.Thread(target=bump, args=("a",))
        t2 = threading.Thread(target=bump, args=("b",))
        t1.start()
        t2.start()
        t1.join(15)
        t2.join(15)
        self.assertFalse(errors, f"concurrent updates failed: {errors}")
        # Both updates must be reflected: no lost +1.
        self.assertEqual(self.revision_of("conv-1"), rev0 + 2)

    def test_unknown_conversation_never_auto_creates_memory(self) -> None:
        self.insert_message("ws-1", "conv-unknown", "m-10")
        self.assertIsNone(self.memory_row("conv-unknown"))
        self.assertIsNone(self.revision_of("conv-unknown"))

    def test_other_workspace_is_not_touched(self) -> None:
        self.make_workspace("ws-2")
        self.make_conversation("ws-2", "conv-2")
        self.make_memory("ws-2", "conv-2")
        self.insert_message("ws-2", "conv-2", "m-11w2")
        rev_ws2 = self.revision_of("conv-2")
        # Meaningful edit only in ws-1.
        self.insert_message("ws-1", "conv-1", "m-11")
        self.assertEqual(self.revision_of("conv-2"), rev_ws2)


class AttachmentInvalidationTests(GateBase):
    DATE = "2026-03-01 10:00:00+00"

    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-1")
        self.make_workspace("ws-2")
        self.make_conversation("ws-1", "conv-a1")
        self.make_conversation("ws-1", "conv-a2")
        self.make_memory("ws-1", "conv-a1")
        self.make_memory("ws-1", "conv-a2")
        self.insert_message("ws-1", "conv-a1", "am-1", created=self.DATE)
        self.insert_message("ws-1", "conv-a2", "am-2", created=self.DATE)

    def test_attachment_insert_invalidates_parent_conversation(self) -> None:
        self.insert_message("ws-1", "conv-a1", "am-3", created=self.DATE)
        rev0 = self.revision_of("conv-a1")
        self.insert_attachment("ws-1", "conv-a1", "att-1", "am-3", self.DATE)
        self.assertGreater(self.revision_of("conv-a1"), rev0)

    def test_attachment_update_invalidates_parent_conversation(self) -> None:
        self.insert_attachment("ws-1", "conv-a1", "att-2", "am-1", self.DATE)
        rev0 = self.revision_of("conv-a1")
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE \"Attachment\" SET \"name\" = 'renamed.png'"
                ' WHERE "id" = %s',
                ("att-2",),
            )
        self.assertGreater(self.revision_of("conv-a1"), rev0)

    def test_attachment_delete_invalidates_parent_conversation(self) -> None:
        self.insert_attachment("ws-1", "conv-a1", "att-3", "am-1", self.DATE)
        rev0 = self.revision_of("conv-a1")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "Attachment" WHERE "id" = %s', ("att-3",))
        self.assertGreater(self.revision_of("conv-a1"), rev0)

    def test_attachment_without_parent_leaves_foreign_memory_alone(self) -> None:
        # An orphaned/dangling attachment must not invalidate the memory of an
        # unrelated conversation whose message id happens to be different.
        rev_other = self.revision_of("conv-a2")
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Attachment" ("id", "conversationId",'
                ' "workspaceId", "messageId", "messageCreatedAt", "fileType",'
                ' "originPath") VALUES (%s, %s, %s, %s, %s, %s, %s)',
                (
                    "att-orphan",
                    "conv-a1",
                    "ws-1",
                    "no-such-message",
                    "2026-03-01 10:00:00+00",
                    "image",
                    "s3://gate/att-orphan",
                ),
            )
        self.assertEqual(self.revision_of("conv-a2"), rev_other)


class CasPublishTests(GateBase):
    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-1")
        self.make_conversation("ws-1", "conv-c1")
        self.make_memory("ws-1", "conv-c1")

    def test_stale_summary_fails_cas_after_message_edit(self) -> None:
        self.insert_message("ws-1", "conv-c1", "cm-1")
        snapshot_rev = self.revision_of("conv-c1")
        version = self.memory_row("conv-c1")[1]
        epoch = self.epoch_of("ws-1")
        # Message edited while the summary was being generated.
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE \"Message\" SET \"text\" = 'new content'"
                ' WHERE "id" = %s',
                ("cm-1",),
            )
        accepted = self.publish(
            "conv-c1", "stale", snapshot_rev, version, epoch
        )
        self.assertFalse(accepted, "CAS accepted a summary built on old sourceRevision")
        self.assertEqual(self.memory_row("conv-c1")[0], "seed")

    def test_fresh_summary_passes_cas(self) -> None:
        self.insert_message("ws-1", "conv-c1", "cm-2")
        accepted = self.publish(
            "conv-c1",
            "fresh",
            self.revision_of("conv-c1"),
            self.memory_row("conv-c1")[1],
            self.epoch_of("ws-1"),
        )
        self.assertTrue(accepted)
        self.assertEqual(self.memory_row("conv-c1")[0], "fresh")


class TopologyTests(GateBase):
    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-1")
        self.make_conversation("ws-1", "conv-t1")
        self.make_memory("ws-1", "conv-t1")

    def _insert_shard(self, sid: str, status: str = "active") -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "MessageShard" ("id", "workspaceId", "shardIndex",'
                ' "status") VALUES (%s, %s, 0, %s)',
                (sid, "ws-1", status),
            )

    def test_any_shard_insert_bumps_topology_epoch_including_inactive(self) -> None:
        self.assertEqual(self.epoch_of("ws-1"), 0)
        self._insert_shard("shard-1")
        self.assertEqual(self.epoch_of("ws-1"), 1)
        # Inactive/archived registry rows are still shard registry rows.
        self._insert_shard("shard-2", status="retired")
        self.assertEqual(self.epoch_of("ws-1"), 2)

    def test_shard_insert_blocks_publish_with_old_epoch(self) -> None:
        self.insert_message("ws-1", "conv-t1", "tm-1")
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        self._insert_shard("shard-3")  # topology changed after snapshot
        self.assertFalse(self.publish("conv-t1", "snap", rev, version, 0))

    def test_registry_delete_does_not_revive_old_epoch_summary(self) -> None:
        self._insert_shard("shard-4")
        epoch_with_shard = self.epoch_of("ws-1")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "MessageShard" WHERE "id" = %s', ("shard-4",))
        # Epoch is monotonic: deleting registry rows must not roll it back.
        self.assertGreaterEqual(self.epoch_of("ws-1"), epoch_with_shard)
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        # A summary snapshotted under an older epoch stays rejected forever.
        self.assertFalse(self.publish("conv-t1", "ghost", rev, version, 0))

    def test_shard_time_range_change_bumps_epoch(self) -> None:
        before = self.epoch_of("ws-1")
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "ShardTimeRange" ("id", "workspaceId",'
                ' "messageShardId", "fromCreatedAt", "toCreatedAt") VALUES'
                " (%s, %s, %s, %s, %s)",
                (
                    "range-1",
                    "ws-1",
                    "shard-x",
                    "2026-01-01 00:00:00+00",
                    "2026-06-01 00:00:00+00",
                ),
            )
        self.assertGreater(self.epoch_of("ws-1"), before)

    def test_new_partition_inherits_trigger(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'CREATE TABLE IF NOT EXISTS "Message_2027"'
                ' PARTITION OF "Message" FOR VALUES FROM'
                " ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00')"
            )
        before = self.revision_of("conv-t1")
        self.insert_message(
            "ws-1", "conv-t1", "tm-2", created="2027-03-01 10:00:00+00"
        )
        self.assertNotEqual(self.revision_of("conv-t1"), before)


_guard_env()  # refuse early, before any connection attempt

if __name__ == "__main__":
    unittest.main(verbosity=2)
