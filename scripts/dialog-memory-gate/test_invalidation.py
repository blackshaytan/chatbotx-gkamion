#!/usr/bin/env python3
"""T02 RED-stage integration gate: dialog memory mainDB-only v1 invalidation.

Runs ONLY in GitHub Actions against a dedicated PostgreSQL (service container)
database named ``dialog_memory_gate``. Hard requirements:

  * DIALOG_MEMORY_TEST_DATABASE_URL set explicitly (never DATABASE_URL)
  * dbname parsed from that URL equals ``dialog_memory_gate``
  * DIALOG_MEMORY_TEST_ALLOW_WRITES=1

The future prototype triggers/functions will live in
``scripts/dialog-memory-gate/invalidation.sql``. In the RED stage that file
does not exist on purpose: the harness runs the fixture WITHOUT triggers and
tests must FAIL on the expected missing effects (not on import/syntax errors).
If the file exists, it is applied so the same suite turns GREEN.

Contract names are fixed in docs/dialog-memory/T02-gate.md.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import threading
import unittest
from typing import Any

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


def _dbname_from_url(url: str) -> str:
    info = psycopg.conninfo.make_conninfo(url)
    parts = psycopg.conninfo.conninfo_to_dict(info)
    return parts.get("dbname") or ""


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
    if _dbname_from_url(URL) != REQUIRED_DB:
        raise SystemExit(
            f"DIALOG_MEMORY_TEST_DATABASE_URL dbname must be {REQUIRED_DB!r}. "
            "Refusing to run before any connection."
        )
    if ALLOW != "1":
        raise SystemExit(
            "DIALOG_MEMORY_TEST_ALLOW_WRITES=1 is required. Refusing without it."
        )


def _raw_connect() -> "psycopg.Connection":
    assert URL is not None
    conn = psycopg.connect(URL, autocommit=True)
    # Prevent any single buggy statement from hanging CI if a thread misbehaves.
    conn.execute("SET statement_timeout = '10s'")
    return conn


def _tx_connect() -> "psycopg.Connection":
    """Transactional harness connection with the same safety timeout."""
    conn = _raw_connect()
    conn.autocommit = False
    return conn


class GateBase(unittest.TestCase):
    conn: "psycopg.Connection"

    @classmethod
    def setUpClass(cls) -> None:
        # The CI workflow creates the dedicated database via POSTGRES_DB.
        # We reconnect, assert the identity, and rebuild the dedicated schema.
        cls.conn = _raw_connect()
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
            # Global topology singleton is recreated fresh for every test.
            cur.execute(
                'INSERT INTO "DialogMemoryTopology" DEFAULT VALUES '
                'ON CONFLICT ("id") DO NOTHING'
            )

    # ---- tiny data helpers -------------------------------------------------
    def make_workspace(self, wid: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Workspace" ("id") VALUES (%s)'
                ' ON CONFLICT ("id") DO NOTHING',
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

    def revision_of(self, cid: str) -> Any:
        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "sourceRevision" FROM "DialogMemorySource"'
                ' WHERE "conversationId" = %s',
                (cid,),
            )
            row = cur.fetchone()
        return row[0] if row else None

    def epoch_of(self) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "topologyEpoch" FROM "DialogMemoryTopology"'
                ' WHERE "id" = %s',
                ("global",),
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
        tx = _raw_connect()
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

    def test_concurrent_distinct_messages_same_source_no_lost_revision(self) -> None:
        created = "2026-03-01 10:00:00+00"
        self.insert_message("ws-1", "conv-1", "m-dist-a", created=created, text="hello")
        self.insert_message("ws-1", "conv-1", "m-dist-b", created=created, text="hello")
        rev0 = self.revision_of("conv-1")
        barrier = threading.Barrier(2)
        observations: dict[str, dict[str, object]] = {}
        errors: list[BaseException] = []

        def bump(mid: str, value: str) -> None:
            conn = None
            try:
                conn = _raw_connect()
                with conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    barrier.wait(timeout=10)
                    cur.execute(
                        'UPDATE "Message" SET "text" = %s WHERE "id" = %s'
                        ' RETURNING id, text, tableoid::regclass::text, xmin::text',
                        (value, mid),
                    )
                    rowcount = cur.rowcount
                    row = cur.fetchone()
                    observations[mid] = {
                        "value": value,
                        "rowcount": rowcount,
                        "returned": {
                            "id": row[0] if row else None,
                            "text": row[1] if row else None,
                            "tableoid": row[2] if row else None,
                            "xmin": row[3] if row else None,
                        },
                    }
            except BaseException as exc:  # pragma: no cover - diagnostic
                errors.append(exc)
                raise
            finally:
                if conn is not None:
                    conn.close()

        t1 = threading.Thread(target=bump, args=("m-dist-a", "a"))
        t2 = threading.Thread(target=bump, args=("m-dist-b", "b"))
        t1.start()
        t2.start()
        t1.join(15)
        t2.join(15)
        with self.conn.cursor() as cur:
            cur.execute("SET search_path = dialog_memory_gate, public")
            cur.execute(
                'SELECT "id", "text", tableoid::regclass::text, xmin::text'
                ' FROM "Message" WHERE "id" IN (%s, %s) ORDER BY "id"',
                ("m-dist-a", "m-dist-b"),
            )
            final_a = cur.fetchone()
            final_b = cur.fetchone()
            cur.execute(
                'SELECT "sourceRevision" FROM "DialogMemorySource"'
                ' WHERE "conversationId" = %s',
                ("conv-1",),
            )
            final_rev = cur.fetchone()
        diagnostics = {
            "before_revision": rev0,
            "after_revision": final_rev[0] if final_rev else None,
            "observations": observations,
            "errors": [repr(e) for e in errors],
            "final_rows": {
                "a": {
                    "id": final_a[0] if final_a else None,
                    "text": final_a[1] if final_a else None,
                    "tableoid": final_a[2] if final_a else None,
                    "xmin": final_a[3] if final_a else None,
                },
                "b": {
                    "id": final_b[0] if final_b else None,
                    "text": final_b[1] if final_b else None,
                    "tableoid": final_b[2] if final_b else None,
                    "xmin": final_b[3] if final_b else None,
                },
            },
        }
        print(json.dumps(diagnostics, sort_keys=True, default=str), flush=True)
        self.assertFalse(errors, msg=repr(diagnostics))
        self.assertFalse(t1.is_alive(), msg=repr(diagnostics))
        self.assertFalse(t2.is_alive(), msg=repr(diagnostics))
        self.assertEqual(observations.get("m-dist-a", {}).get("rowcount"), 1)
        self.assertEqual(observations.get("m-dist-b", {}).get("rowcount"), 1)
        self.assertEqual(observations["m-dist-a"]["returned"]["id"], "m-dist-a")
        self.assertEqual(observations["m-dist-a"]["returned"]["text"], "a")
        self.assertEqual(observations["m-dist-b"]["returned"]["id"], "m-dist-b")
        self.assertEqual(observations["m-dist-b"]["returned"]["text"], "b")
        self.assertEqual(final_a[1], "a")
        self.assertEqual(final_b[1], "b")
        self.assertEqual(
            self.revision_of("conv-1"), rev0 + 2, msg=repr(diagnostics)
        )

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

    def test_reassign_message_to_other_conversation_bumps_both_owners(self) -> None:
        self.make_conversation("ws-1", "conv-1a")
        self.insert_message("ws-1", "conv-1", "m-reassign")
        rev_old = self.revision_of("conv-1")
        rev_new = self.revision_of("conv-1a")
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Message" SET "conversationId" = %s WHERE "id" = %s',
                ("conv-1a", "m-reassign"),
            )
        self.assertIsNotNone(rev_old)
        self.assertIsNotNone(rev_new)
        self.assertGreater(self.revision_of("conv-1"), rev_old)
        self.assertGreater(self.revision_of("conv-1a"), rev_new)

    def test_reassign_message_to_other_workspace_bumps_both_owners(self) -> None:
        self.make_workspace("ws-2")
        self.make_conversation("ws-2", "conv-2a")
        self.insert_message("ws-1", "conv-1", "m-ws-move")
        rev_old = self.revision_of("conv-1")
        rev_new = self.revision_of("conv-2a")
        self.assertIsNotNone(rev_old)
        self.assertIsNotNone(rev_new)
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Message" SET "conversationId" = %s, "workspaceId" = %s'
                ' WHERE "id" = %s',
                ("conv-2a", "ws-2", "m-ws-move"),
            )
        self.assertGreater(self.revision_of("conv-1"), rev_old)
        self.assertGreater(self.revision_of("conv-2a"), rev_new)

    def test_source_id_and_created_at_composition_for_attachment(self) -> None:
        created = "2026-03-01 10:00:00+00"
        self.insert_message("ws-1", "conv-1", "m-source", created=created)
        rev = self.revision_of("conv-1")
        # Correct (messageId, messageCreatedAt) pair resolves the parent.
        self.insert_attachment("ws-1", "conv-1", "att-ok", "m-source", created)
        self.assertGreater(self.revision_of("conv-1"), rev)
        # A mismatched messageCreatedAt makes the row orphan even with a known id.
        rev2 = self.revision_of("conv-1")
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Attachment"'
                ' ("id", "conversationId", "workspaceId", "messageId",'
                ' "messageCreatedAt", "fileType", "originPath")'
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    "att-wrong",
                    "conv-1",
                    "ws-1",
                    "m-source",
                    "2026-04-01 10:00:00+00",
                    "image",
                    "s3://gate/att-wrong",
                ),
            )
        self.assertEqual(self.revision_of("conv-1"), rev2)


class AttachmentInvalidationTests(GateBase):
    DATE = "2026-03-01 10:00:00+00"

    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-1")
        self.make_workspace("ws-2")
        self.make_conversation("ws-1", "conv-a1")
        self.make_conversation("ws-1", "conv-a2")
        self.make_conversation("ws-2", "conv-a3")
        self.make_memory("ws-1", "conv-a1")
        self.make_memory("ws-1", "conv-a2")
        self.insert_message("ws-1", "conv-a1", "am-1", created=self.DATE)
        self.insert_message("ws-1", "conv-a2", "am-2", created=self.DATE)
        self.insert_message("ws-2", "conv-a3", "am-3", created=self.DATE)

    def test_attachment_insert_invalidates_parent_conversation(self) -> None:
        self.insert_message("ws-1", "conv-a1", "am-valid-insert", created=self.DATE)
        rev0 = self.revision_of("conv-a1")
        self.insert_attachment("ws-1", "conv-a1", "att-1", "am-valid-insert", self.DATE)
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

    def test_forged_attachment_insert_does_not_bump_foreign_owner(self) -> None:
        # The attachment row lives in ws-1/conv-a1 but references a real foreign
        # message am-3 in ws-2/conv-a3 by its (messageId, messageCreatedAt).
        # A trigger that resolves parent by id/createdAt only would wrongly bump
        # the foreign owner's sourceRevision.
        foreign_rev = self.revision_of("conv-a3")
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Attachment" ("id", "conversationId",'
                ' "workspaceId", "messageId", "messageCreatedAt", "fileType",'
                ' "originPath") VALUES (%s, %s, %s, %s, %s, %s, %s)',
                (
                    "att-forged-insert",
                    "conv-a1",
                    "ws-1",
                    "am-3",
                    self.DATE,
                    "image",
                    "s3://gate/att-forged-insert",
                ),
            )
        self.assertEqual(
            self.revision_of("conv-a3"),
            foreign_rev,
            "forged attachment insert bumped the real foreign owner's sourceRevision",
        )

    def test_forged_attachment_update_does_not_bump_foreign_owner(self) -> None:
        # Same workspace, different conversation: forged parent is am-2 in
        # ws-1/conv-a2, but the attachment row belongs to conv-a1.
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Attachment" ("id", "conversationId",'
                ' "workspaceId", "messageId", "messageCreatedAt", "fileType",'
                ' "originPath") VALUES (%s, %s, %s, %s, %s, %s, %s)',
                (
                    "att-forged-update",
                    "conv-a1",
                    "ws-1",
                    "am-2",
                    self.DATE,
                    "image",
                    "s3://gate/att-forged-update",
                ),
            )
        # A buggy INSERT may already have bumped the foreign owner once;
        # capture the post-insert value and ensure UPDATE does not bump again.
        foreign_rev_after_insert = self.revision_of("conv-a2")
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Attachment" SET "name" = %s WHERE "id" = %s',
                ("renamed.png", "att-forged-update"),
            )
        self.assertEqual(
            self.revision_of("conv-a2"),
            foreign_rev_after_insert,
            "forged attachment update bumped the real foreign owner's sourceRevision again",
        )

    def test_forged_attachment_delete_does_not_bump_foreign_owner(self) -> None:
        # Cross-workspace forged parent again: the attachment belongs to
        # ws-1/conv-a1 but references am-3 in ws-2/conv-a3.
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "Attachment" ("id", "conversationId",'
                ' "workspaceId", "messageId", "messageCreatedAt", "fileType",'
                ' "originPath") VALUES (%s, %s, %s, %s, %s, %s, %s)',
                (
                    "att-forged-delete",
                    "conv-a1",
                    "ws-1",
                    "am-3",
                    self.DATE,
                    "image",
                    "s3://gate/att-forged-delete",
                ),
            )
        foreign_rev_after_insert = self.revision_of("conv-a3")
        with self.conn.cursor() as cur:
            cur.execute(
                'DELETE FROM "Attachment" WHERE "id" = %s', ("att-forged-delete",)
            )
        self.assertEqual(
            self.revision_of("conv-a3"),
            foreign_rev_after_insert,
            "forged attachment delete bumped the real foreign owner's sourceRevision again",
        )


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
        epoch = self.epoch_of()
        # Simulate the future source trigger: a committed meaningful edit bumps
        # the source revision in the same transaction.
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE \"Message\" SET \"text\" = 'new content'"
                ' WHERE "id" = %s',
                ("cm-1",),
            )
            cur.execute(
                'UPDATE "DialogMemorySource" SET "sourceRevision" ='
                ' "sourceRevision" + 1 WHERE "conversationId" = %s',
                ("conv-c1",),
            )
        accepted = self.publish(
            "conv-c1", "stale", snapshot_rev, version, epoch
        )
        self.assertFalse(
            accepted, "CAS accepted a summary built on old sourceRevision"
        )
        self.assertEqual(self.memory_row("conv-c1")[0], "seed")

    def test_fresh_summary_passes_cas(self) -> None:
        self.insert_message("ws-1", "conv-c1", "cm-2")
        accepted = self.publish(
            "conv-c1",
            "fresh",
            self.revision_of("conv-c1"),
            self.memory_row("conv-c1")[1],
            self.epoch_of(),
        )
        self.assertTrue(accepted)
        self.assertEqual(self.memory_row("conv-c1")[0], "fresh")

    def test_concurrent_publishers_same_snapshot_only_one_wins(self) -> None:
        self.insert_message("ws-1", "conv-c1", "cm-conc")
        rev = self.revision_of("conv-c1")
        version = self.memory_row("conv-c1")[1]
        epoch = self.epoch_of()
        results: list[tuple[str, object]] = []
        barrier = threading.Barrier(2)

        def attempt(label: str) -> None:
            try:
                conn = _tx_connect()
                with conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    barrier.wait(timeout=10)
                    cur.execute(
                        "SELECT publish_summary_candidate(%s, %s, %s, %s, %s)",
                        ("conv-c1", f"summary-{label}", rev, version, epoch),
                    )
                    ok = bool(cur.fetchone()[0])
                conn.commit()
                conn.close()
                results.append((label, ok))
            except BaseException as exc:
                results.append((label, exc))

        t1 = threading.Thread(target=attempt, args=("A",))
        t2 = threading.Thread(target=attempt, args=("B",))
        t1.start()
        t2.start()
        t1.join(15)
        t2.join(15)
        self.assertFalse(t1.is_alive())
        self.assertFalse(t2.is_alive())
        winners = [r for r in results if r[1] is True]
        self.assertEqual(len(winners), 1, f"unexpected results: {results}")

    def test_edit_holds_source_lock_and_publish_after_edit_fails(self) -> None:
        """Deterministic interleaving: edit updates Message (the trigger bumps
        DialogMemorySource) and stays open; publish attempts with the old
        snapshot; edit commits first; publish observes the bumped sourceRevision
        and returns false. No manual sourceRevision bump in the edit thread.
        """
        self.insert_message("ws-1", "conv-c1", "cm-race-edit-first")
        rev = self.revision_of("conv-c1")
        version = self.memory_row("conv-c1")[1]
        epoch = self.epoch_of()
        results: dict[str, object] = {}
        edit_ready = threading.Event()
        publish_attempting = threading.Event()
        edit_can_commit = threading.Event()

        def edit() -> None:
            try:
                conn = _tx_connect()
                with conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    cur.execute(
                        'UPDATE "Message" SET "text" = %s WHERE "id" = %s',
                        ("edited", "cm-race-edit-first"),
                    )
                    # The AFTER ROW trigger has bumped DialogMemorySource and the
                    # source row lock is held until this transaction commits.
                    edit_ready.set()
                    edit_can_commit.wait(timeout=10)
                conn.commit()
                conn.close()
                results["edit"] = "committed"
            except BaseException as exc:
                results["edit"] = exc

        def publish() -> None:
            try:
                edit_ready.wait(timeout=10)
                conn = _tx_connect()
                with conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    publish_attempting.set()
                    cur.execute(
                        "SELECT publish_summary_candidate(%s, %s, %s, %s, %s)",
                        ("conv-c1", "during-edit", rev, version, epoch),
                    )
                    ok = bool(cur.fetchone()[0])
                conn.commit()
                conn.close()
                results["publish"] = ok
            except BaseException as exc:
                results["publish"] = exc

        t1 = threading.Thread(target=edit)
        t2 = threading.Thread(target=publish)
        t1.start()
        t2.start()
        self.assertTrue(
            edit_ready.wait(timeout=10), "edit never acquired source lock"
        )
        self.assertTrue(
            publish_attempting.wait(timeout=10), "publish never started"
        )
        edit_can_commit.set()
        t1.join(15)
        t2.join(15)
        self.assertFalse(t1.is_alive())
        self.assertFalse(t2.is_alive())
        self.assertEqual(
            results.get("edit"), "committed", f"edit failed: {results.get('edit')}"
        )
        pub = results.get("publish")
        self.assertIsNotNone(rev)
        self.assertIsInstance(pub, bool, f"publish failed: {pub}")
        self.assertFalse(pub, "publish succeeded against a concurrent edit")
        self.assertEqual(self.revision_of("conv-c1"), rev + 1)

    def test_publish_holds_locks_and_edit_after_publish_is_detected_as_dirty(
        self,
    ) -> None:
        """Deterministic interleaving: publish acquires the source/topology
        locks and wins; edit then updates Message (the trigger bumps sourceRevision
        after the locks are released); a later publish with the old sourceRevision
        but the new memoryVersion must fail CAS.
        """
        self.insert_message("ws-1", "conv-c1", "cm-race-publish-first")
        rev = self.revision_of("conv-c1")
        version = self.memory_row("conv-c1")[1]
        epoch = self.epoch_of()
        results: dict[str, object] = {}
        publish_locked = threading.Event()
        edit_attempting = threading.Event()
        publish_can_commit = threading.Event()

        def publish() -> None:
            try:
                conn = _tx_connect()
                with conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    cur.execute(
                        "SELECT publish_summary_candidate(%s, %s, %s, %s, %s)",
                        ("conv-c1", "publish-first", rev, version, epoch),
                    )
                    ok = bool(cur.fetchone()[0])
                    # The function left source/topology/memory rows locked.
                    publish_locked.set()
                    publish_can_commit.wait(timeout=10)
                conn.commit()
                conn.close()
                results["publish"] = ok
            except BaseException as exc:
                results["publish"] = exc

        def edit() -> None:
            try:
                publish_locked.wait(timeout=10)
                conn = _tx_connect()
                with conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    edit_attempting.set()
                    cur.execute(
                        'UPDATE "Message" SET "text" = %s WHERE "id" = %s',
                        ("edited-after-publish", "cm-race-publish-first"),
                    )
                    # The AFTER ROW trigger bumps sourceRevision after the
                    # publish transaction releases the source row lock.
                conn.commit()
                conn.close()
                results["edit"] = "committed"
            except BaseException as exc:
                results["edit"] = exc

        t1 = threading.Thread(target=publish)
        t2 = threading.Thread(target=edit)
        t1.start()
        t2.start()
        self.assertTrue(
            publish_locked.wait(timeout=10), "publish never acquired locks"
        )
        self.assertTrue(
            edit_attempting.wait(timeout=10), "edit never started"
        )
        publish_can_commit.set()
        t1.join(15)
        t2.join(15)
        self.assertFalse(t1.is_alive())
        self.assertFalse(t2.is_alive())
        pub = results.get("publish")
        self.assertIsNotNone(rev)
        self.assertIsInstance(pub, bool, f"publish failed: {pub}")
        self.assertTrue(pub, "publish should succeed while holding the snapshot locks")
        self.assertEqual(
            results.get("edit"), "committed", f"edit failed: {results.get('edit')}"
        )
        self.assertEqual(self.revision_of("conv-c1"), rev + 1)
        new_version = self.memory_row("conv-c1")[1]
        self.assertFalse(
            self.publish("conv-c1", "after-edit", rev, new_version, epoch),
            "CAS missed the sourceRevision bump that happened after publish",
        )


class TopologyTests(GateBase):
    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-1")
        self.make_workspace("ws-2")
        self.make_conversation("ws-1", "conv-t1")
        self.make_conversation("ws-2", "conv-t2")
        self.make_memory("ws-1", "conv-t1")
        self.make_memory("ws-2", "conv-t2")

    def _insert_shard(
        self, sid: str, is_active: bool = False, is_main: bool = False
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "MessageShard"'
                ' ("id", "name", "host", "database", "user", "isActive", "isMain")'
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (sid, f"shard-{sid}", f"host-{sid}", "postgres", "postgres", is_active, is_main),
            )

    def _insert_time_range(
        self, rid: str, shard_id: str, start: str, end: str
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "ShardTimeRange"'
                ' ("id", "shardId", "startTime", "endTime")'
                " VALUES (%s, %s, %s, %s)",
                (rid, shard_id, start, end),
            )

    def test_any_shard_insert_bumps_global_topology_epoch(self) -> None:
        self.assertEqual(self.epoch_of(), 0)
        self._insert_shard("shard-1")
        self.assertEqual(self.epoch_of(), 1)

    def test_inactive_shard_insert_bumps_global_topology_epoch(self) -> None:
        # Inactive/archived registry rows are still shard registry rows.
        self._insert_shard("shard-2", is_active=False)
        self.assertEqual(self.epoch_of(), 1)

    def test_shard_insert_blocks_publish_with_old_epoch(self) -> None:
        self.insert_message("ws-1", "conv-t1", "tm-1")
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        self._insert_shard("shard-3")  # topology changed after snapshot
        self.assertFalse(self.publish("conv-t1", "snap", rev, version, 0))

    def test_fresh_candidate_with_current_epoch_and_registry_is_rejected(self) -> None:
        # Memory must stay disabled whenever ANY MessageShard row exists, even
        # if the candidate was snapshot after the shard was inserted.
        self.insert_message("ws-1", "conv-t1", "tm-fresh")
        self._insert_shard("shard-present")
        epoch = self.epoch_of()
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        self.assertFalse(
            self.publish("conv-t1", "fresh", rev, version, epoch),
            "publish accepted while MessageShard registry is non-empty",
        )

    def test_registry_delete_does_not_revive_old_epoch_summary(self) -> None:
        self._insert_shard("shard-4")
        epoch_with_shard = self.epoch_of()
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "MessageShard" WHERE "id" = %s', ("shard-4",))
        # Epoch is monotonic: deleting registry rows must not roll it back.
        self.assertGreaterEqual(self.epoch_of(), epoch_with_shard)
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        # A summary snapshotted under an older epoch stays rejected forever.
        self.assertFalse(self.publish("conv-t1", "ghost", rev, version, 0))

    def test_registry_delete_bumps_epoch(self) -> None:
        self._insert_shard("shard-del")
        before = self.epoch_of()
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "MessageShard" WHERE "id" = %s', ("shard-del",))
        # GREEN trigger must increment the global epoch on registry delete.
        self.assertGreater(self.epoch_of(), before)

    def test_truncate_registry_bumps_topology_epoch(self) -> None:
        self._insert_shard("shard-trunc")
        before = self.epoch_of()
        with self.conn.cursor() as cur:
            cur.execute('TRUNCATE "MessageShard" CASCADE')
        # GREEN trigger must invalidate memory on registry TRUNCATE.
        self.assertGreater(self.epoch_of(), before)

    def test_shard_time_range_change_bumps_global_epoch(self) -> None:
        self._insert_shard("shard-x")
        before = self.epoch_of()
        self._insert_time_range(
            "range-1",
            "shard-x",
            "2026-01-01 00:00:00+00",
            "2026-06-01 00:00:00+00",
        )
        self.assertGreater(self.epoch_of(), before)

    def test_cross_workspace_any_shard_invalidates_all_workspaces(self) -> None:
        self.insert_message("ws-1", "conv-t1", "tm-w1")
        self.insert_message("ws-2", "conv-t2", "tm-w2")
        rev1 = self.revision_of("conv-t1")
        rev2 = self.revision_of("conv-t2")
        v1 = self.memory_row("conv-t1")[1]
        v2 = self.memory_row("conv-t2")[1]
        # The registry is global: no workspaceId on MessageShard.
        self._insert_shard("shard-global")
        self.assertFalse(self.publish("conv-t1", "w1-snap", rev1, v1, 0))
        self.assertFalse(self.publish("conv-t2", "w2-snap", rev2, v2, 0))
        # Snapshots taken at the current epoch are still rejected while
        # MessageShard is non-empty.
        epoch = self.epoch_of()
        self.assertFalse(
            self.publish("conv-t1", "w1-current", rev1, v1, epoch)
        )
        self.assertFalse(
            self.publish("conv-t2", "w2-current", rev2, v2, epoch)
        )

    def test_stale_epoch_after_registry_insert_delete_rejects(self) -> None:
        # Snapshot a candidate at the clean epoch 0, then mutate the registry,
        # then remove the registry row. The candidate snapshotted at epoch 0
        # must stay rejected even though the registry is empty again.
        self.insert_message("ws-1", "conv-t1", "tm-stale")
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        self._insert_shard("shard-stale")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "MessageShard" WHERE "id" = %s', ("shard-stale",))
        self.assertFalse(
            self.publish("conv-t1", "stale", rev, version, 0),
            "stale-epoch candidate accepted after registry insert/delete",
        )

    def test_fresh_epoch_after_registry_removal_accepts(self) -> None:
        # A fresh summary snapshot at the post-removal epoch must be allowed to
        # publish once the registry is empty.
        self._insert_shard("shard-removal")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "MessageShard" WHERE "id" = %s', ("shard-removal",))
        self.insert_message("ws-1", "conv-t1", "tm-fresh-after")
        epoch = self.epoch_of()
        self.assertGreater(epoch, 0, "registry removal should have bumped epoch")
        accepted = self.publish(
            "conv-t1",
            "fresh-after-removal",
            self.revision_of("conv-t1"),
            self.memory_row("conv-t1")[1],
            epoch,
        )
        self.assertTrue(accepted)
        self.assertEqual(self.memory_row("conv-t1")[0], "fresh-after-removal")

    def test_missing_topology_singleton_rejects(self) -> None:
        # If the global topology row is absent the publish CAS cannot verify the
        # epoch and must fail safely.
        self.insert_message("ws-1", "conv-t1", "tm-no-topo")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "DialogMemoryTopology" WHERE "id" = %s', ("global",))
        accepted = self.publish(
            "conv-t1",
            "no-topology",
            self.revision_of("conv-t1"),
            self.memory_row("conv-t1")[1],
            0,
        )
        self.assertFalse(accepted)

    def test_truncate_message_bumps_topology_epoch(self) -> None:
        # RED: Message TRUNCATE is a destructive storage event that must
        # invalidate the entire memory view, not just the source rows it removes.
        self.insert_message("ws-1", "conv-t1", "tm-trunc-msg")
        before_epoch = self.epoch_of()
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        with self.conn.cursor() as cur:
            cur.execute('TRUNCATE "Message" CASCADE')
        self.assertGreater(self.epoch_of(), before_epoch)
        self.assertFalse(
            self.publish("conv-t1", "after-trunc-msg", rev, version, before_epoch),
            "old-epoch candidate accepted after TRUNCATE Message",
        )

    def test_truncate_attachment_bumps_topology_epoch(self) -> None:
        # RED: Attachment TRUNCATE is equally destructive and must bump the global
        # topology epoch so no pre-truncate summary can be published.
        created = "2026-03-01 10:00:00+00"
        self.insert_message("ws-1", "conv-t1", "tm-trunc-att", created=created)
        self.insert_attachment("ws-1", "conv-t1", "att-trunc-att", "tm-trunc-att", created)
        before_epoch = self.epoch_of()
        rev = self.revision_of("conv-t1")
        version = self.memory_row("conv-t1")[1]
        with self.conn.cursor() as cur:
            cur.execute('TRUNCATE "Attachment" CASCADE')
        self.assertGreater(self.epoch_of(), before_epoch)
        self.assertFalse(
            self.publish("conv-t1", "after-trunc-att", rev, version, before_epoch),
            "old-epoch candidate accepted after TRUNCATE Attachment",
        )

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


class PostgresSameRowWriteSemanticsTests(GateBase):
    """Reference check for plain PostgreSQL same-row UPDATE serialization.

    This class is deliberately NOT mixed into the TimescaleDB suite: it checks
    the upstream PostgreSQL semantics on the plain-Postgres job. The shared
    memory gate only guarantees a revision for each committed mutation, not
    for attempted UPDATEs that the platform silently turns into no-ops.
    """

    def test_concurrent_updates_serialize_without_lost_update(self) -> None:
        self.insert_message("ws-1", "conv-1", "m-9")
        rev0 = self.revision_of("conv-1")
        barrier = threading.Barrier(2)
        observations: list[dict[str, object]] = []
        errors: list[BaseException] = []

        def bump(value: str) -> None:
            try:
                conn = _raw_connect()
                try:
                    with conn.cursor() as cur:
                        barrier.wait(timeout=10)
                        cur.execute("SET search_path = dialog_memory_gate, public")
                        cur.execute(
                            'UPDATE "Message" SET "text" = %s WHERE "id" = %s'
                            ' RETURNING id, text, tableoid::regclass::text, xmin::text',
                            (value, "m-9"),
                        )
                        rowcount = cur.rowcount
                        row = cur.fetchone()
                        observations.append(
                            {
                                "value": value,
                                "rowcount": rowcount,
                                "returned": {
                                    "id": row[0] if row else None,
                                    "text": row[1] if row else None,
                                    "tableoid": row[2] if row else None,
                                    "xmin": row[3] if row else None,
                                },
                            }
                        )
                finally:
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
        with self.conn.cursor() as cur:
            cur.execute("SET search_path = dialog_memory_gate, public")
            cur.execute(
                'SELECT text, tableoid::regclass::text, xmin::text'
                ' FROM "Message" WHERE "id" = %s',
                ("m-9",),
            )
            final = cur.fetchone()
            cur.execute(
                'SELECT "sourceRevision" FROM "DialogMemorySource"'
                ' WHERE "conversationId" = %s',
                ("conv-1",),
            )
            final_rev = cur.fetchone()
        diagnostics = {
            "before_revision": rev0,
            "after_revision": final_rev[0] if final_rev else None,
            "observations": observations,
            "errors": [repr(e) for e in errors],
            "final_row": {
                "text": final[0] if final else None,
                "tableoid": final[1] if final else None,
                "xmin": final[2] if final else None,
            },
        }
        print(json.dumps(diagnostics, sort_keys=True, default=str), flush=True)
        self.assertFalse(errors, msg=repr(diagnostics))
        self.assertFalse(t1.is_alive(), msg=repr(diagnostics))
        self.assertFalse(t2.is_alive(), msg=repr(diagnostics))
        # Both updates must be reflected: no lost +1.
        self.assertEqual(
            self.revision_of("conv-1"), rev0 + 2, msg=repr(diagnostics)
        )


_guard_env()  # refuse early, before any connection attempt

if __name__ == "__main__":
    unittest.main(verbosity=2)
