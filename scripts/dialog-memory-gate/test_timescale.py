#!/usr/bin/env python3
"""T02 RED-stage integration gate: hosted TimescaleDB proof.

Runs ONLY in GitHub Actions against a dedicated TimescaleDB service container
using the pinned production image. Reuses the test harness from
``test_invalidation.py`` and transforms the declarative-partition fixture into
real hypertables so the same invalidation contract is exercised on the actual
storage substrate.

Hard requirements (same as the mainDB gate, but the URL points at the Timescale
service):

  * DIALOG_MEMORY_TEST_DATABASE_URL set explicitly (never DATABASE_URL)
  * dbname parsed from that URL equals ``dialog_memory_gate``
  * DIALOG_MEMORY_TEST_ALLOW_WRITES=1
"""

from __future__ import annotations

import pathlib
import re
import sys
import textwrap
import unittest

import test_invalidation as base

BASE = pathlib.Path(__file__).resolve().parent
ORIGINAL_FIXTURE = BASE / "fixture.sql"


class _TransformedFixture:
    """Fixture.sql wrapper that returns a TimescaleDB hypertable variant.

    Reads the source fixture and applies only the documented transforms. The
    anchors/counts are intentionally strict: if the fixture drifts, this script
    fails loudly instead of silently producing a different schema.
    """

    def read_text(self, encoding: str = "utf-8") -> str:
        original = ORIGINAL_FIXTURE.read_text(encoding=encoding)

        # ---- strict anchors against fixture drift ---------------------------
        assert original.count('CREATE TABLE "Message"') == 1, (
            "fixture drift: Message table definition count changed"
        )
        assert original.count('PARTITION BY RANGE ("createdAt")') == 1, (
            "fixture drift: Message partitioning clause missing/changed"
        )
        assert original.count('PARTITION OF "Message"') == 2, (
            "fixture drift: Message partition count changed"
        )
        assert original.count('CREATE TABLE "Message_2026_h1"') == 1, (
            "fixture drift: Message_2026_h1 partition missing/changed"
        )
        assert original.count('CREATE TABLE "Message_2026_h2"') == 1, (
            "fixture drift: Message_2026_h2 partition missing/changed"
        )
        assert original.count('CREATE TABLE "Attachment"') == 1, (
            "fixture drift: Attachment table definition count changed"
        )
        assert original.count('CREATE TABLE "MessageShard"') == 1, (
            "fixture drift: MessageShard table definition count changed"
        )
        assert original.count("CREATE OR REPLACE FUNCTION publish_summary_candidate(") == 1, (
            "fixture drift: publish_summary_candidate definition missing/changed"
        )

        # 1) CREATE EXTENSION before the fixture's explicit BEGIN.
        lines = original.splitlines()
        new_lines: list[str] = []
        inserted_extension = False
        for line in lines:
            if not inserted_extension and line.strip().upper().startswith("BEGIN"):
                new_lines.append("CREATE EXTENSION IF NOT EXISTS timescaledb;")
                inserted_extension = True
            new_lines.append(line)
        assert inserted_extension, "fixture drift: BEGIN marker not found"
        text = "\n".join(new_lines) + "\n"

        # 2) Turn Message into a hypertable (drop declarative partitioning).
        text = text.replace(
            ') PARTITION BY RANGE ("createdAt");\n',
            ');\n',
        )
        text = re.sub(
            r'CREATE TABLE "Message_2026_h1" PARTITION OF "Message".*?;\n',
            "",
            text,
            flags=re.DOTALL,
        )
        text = re.sub(
            r'CREATE TABLE "Message_2026_h2" PARTITION OF "Message".*?;\n',
            "",
            text,
            flags=re.DOTALL,
        )
        assert 'PARTITION BY RANGE ("createdAt")' not in text, (
            "transform left a partition clause behind"
        )
        assert 'PARTITION OF "Message"' not in text, (
            "transform left a partition table behind"
        )

        text = text.replace(
            'CREATE TABLE "Attachment"',
            "SELECT public.create_hypertable('dialog_memory_gate.\"Message\"'::regclass,'createdAt',chunk_time_interval=>INTERVAL'30days');\n\nCREATE TABLE \"Attachment\"",
        )

        # 3) Turn Attachment into a hypertable by createdAt.
        text = text.replace(
            'CREATE TABLE "MessageShard"',
            "SELECT public.create_hypertable('dialog_memory_gate.\"Attachment\"'::regclass,'createdAt',chunk_time_interval=>INTERVAL'30days');\n\nCREATE TABLE \"MessageShard\"",
        )

        # 4) Enable compression on both hypertables.
        compression = textwrap.dedent(
            '''\
            ALTER TABLE dialog_memory_gate."Message" SET (
              timescaledb.compress,
              timescaledb.compress_segmentby = '"workspaceId","conversationId"',
              timescaledb.compress_orderby = '"createdAt" DESC'
            );
            ALTER TABLE dialog_memory_gate."Attachment" SET (
              timescaledb.compress,
              timescaledb.compress_segmentby = '"workspaceId","conversationId"',
              timescaledb.compress_orderby = '"createdAt" DESC'
            );
            '''
        )
        text = text.replace(
            'CREATE OR REPLACE FUNCTION publish_summary_candidate(',
            compression + 'CREATE OR REPLACE FUNCTION publish_summary_candidate(',
        )

        return text


# A single instance the test base can treat like a ``pathlib.Path``.
TRANSFORMED_FIXTURE = _TransformedFixture()


class TimescaleGateBase(base.GateBase):
    """Shared setup for TimescaleDB hypertable runs.

    Re-implements only ``setUpClass``; everything else (helpers, tear-down,
    per-test truncation) is inherited from ``base.GateBase``.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.conn = base._raw_connect()
        with cls.conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            db = cur.fetchone()[0]
        if db != base.REQUIRED_DB:
            raise SystemExit(
                f"connected database is {db!r}, expected {base.REQUIRED_DB!r}. "
                "Wrong database identity; refusing to write."
            )
        with cls.conn.cursor() as cur:
            cur.execute("SET search_path = dialog_memory_gate, public")
            cur.execute("DROP SCHEMA IF EXISTS dialog_memory_gate CASCADE")
            cur.execute(TRANSFORMED_FIXTURE.read_text())
            if base.INVALIDATION.exists():  # GREEN stage applies triggers too
                cur.execute(base.INVALIDATION.read_text())


class TimescaleMetadataTests(TimescaleGateBase):
    """Pin the CI image to the exact production engine + extension version."""

    def test_server_and_extension_versions(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT current_setting('server_version_num')")
            version_num = cur.fetchone()[0]
            cur.execute(
                "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
            )
            ext = cur.fetchone()
        self.assertTrue(
            version_num.startswith("18"),
            f"expected PostgreSQL major 18, got server_version_num={version_num}",
        )
        self.assertIsNotNone(ext, "timescaledb extension is not installed")
        self.assertEqual(
            ext[0],
            "2.30.2",
            f"expected TimescaleDB 2.30.2, got {ext[0]}",
        )
        print(
            f"[timescale metadata] server_version_num={version_num} "
            f"timescaledb={ext[0]} database={base.REQUIRED_DB}"
        )


class TimescaleMessageInvalidationTests(TimescaleGateBase, base.MessageInvalidationTests):
    """Run every Message invalidation test against a real hypertable."""


class TimescaleAttachmentInvalidationTests(
    TimescaleGateBase, base.AttachmentInvalidationTests
):
    """Run every Attachment invalidation test against a real hypertable."""


class TimescaleCasPublishTests(TimescaleGateBase, base.CasPublishTests):
    """Run the CAS publish contract against a real hypertable."""


class TimescaleTopologyTests(TimescaleGateBase, base.TopologyTests):
    """Topology tests on hypertables; new chunks are created by insertion."""

    def test_new_partition_inherits_trigger(self) -> None:
        # No declarative partitions in Timescale: a future-timestamp insert must
        # create a new chunk automatically and the Message trigger must still fire.
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM timescaledb_information.chunks"
                " WHERE hypertable_schema = 'dialog_memory_gate'"
                "   AND hypertable_name = 'Message'"
                "   AND range_start <= %s AND range_end > %s",
                ("2027-03-01 10:00:00+00", "2027-03-01 10:00:00+00"),
            )
            before = cur.fetchone()[0]

        rev_before = self.revision_of("conv-t1")
        self.insert_message(
            "ws-1", "conv-t1", "tm-2", created="2027-03-01 10:00:00+00"
        )
        self.assertNotEqual(self.revision_of("conv-t1"), rev_before)

        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM timescaledb_information.chunks"
                " WHERE hypertable_schema = 'dialog_memory_gate'"
                "   AND hypertable_name = 'Message'"
                "   AND range_start <= %s AND range_end > %s",
                ("2027-03-01 10:00:00+00", "2027-03-01 10:00:00+00"),
            )
            after = cur.fetchone()[0]
        self.assertGreater(
            after,
            before,
            "future insert into the hypertable did not create a new chunk",
        )


class TimescaleCompressedTests(TimescaleGateBase):
    """Prove the invalidation contract stays valid after Timescale compression.

    This is a real-storage proof: chunks are compressed with ``compress_chunk``,
    the compressed flag is asserted from ``timescaledb_information.chunks``, and
    only SQL mutators + the existing CAS contract are used. No mocks.
    """

    DATE = "2026-03-01 10:00:00+00"

    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-c")
        self.make_conversation("ws-c", "conv-c")
        self.make_memory("ws-c", "conv-c")
        self.insert_message("ws-c", "conv-c", "cm", created=self.DATE)
        self.insert_attachment("ws-c", "conv-c", "att", "cm", self.DATE)
        self._compress_table("Message")
        self._compress_table("Attachment")
        self._assert_table_compressed("Message")
        self._assert_table_compressed("Attachment")

    def _compress_table(self, name: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                f"SELECT public.compress_chunk(c)"
                f" FROM public.show_chunks('dialog_memory_gate.\"{name}\"'::regclass) c"
            )

    def _assert_table_compressed(self, name: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT is_compressed FROM timescaledb_information.chunks"
                " WHERE hypertable_schema = 'dialog_memory_gate'"
                "   AND hypertable_name = %s",
                (name,),
            )
            rows = cur.fetchall()
        self.assertTrue(rows, f"no chunks found for {name}")
        self.assertTrue(
            all(row[0] for row in rows),
            f"not all chunks of {name} are compressed",
        )

    def test_compressed_message_update_bumps_revision(self) -> None:
        rev0 = self.revision_of("conv-c")
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Message" SET "text" = %s WHERE "id" = %s',
                ("compressed-edit", "cm"),
            )
        self.assertGreater(self.revision_of("conv-c"), rev0)

    def test_compressed_message_delete_bumps_revision(self) -> None:
        rev0 = self.revision_of("conv-c")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "Message" WHERE "id" = %s', ("cm",))
        self.assertGreater(self.revision_of("conv-c"), rev0)

    def test_compressed_attachment_update_bumps_revision(self) -> None:
        rev0 = self.revision_of("conv-c")
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Attachment" SET "name" = %s WHERE "id" = %s',
                ("renamed.png", "att"),
            )
        self.assertGreater(self.revision_of("conv-c"), rev0)

    def test_compressed_attachment_delete_bumps_revision(self) -> None:
        rev0 = self.revision_of("conv-c")
        with self.conn.cursor() as cur:
            cur.execute('DELETE FROM "Attachment" WHERE "id" = %s', ("att",))
        self.assertGreater(self.revision_of("conv-c"), rev0)

    def test_stale_publish_rejected_after_compressed_edit(self) -> None:
        rev = self.revision_of("conv-c")
        version = self.memory_row("conv-c")[1]
        epoch = self.epoch_of()
        with self.conn.cursor() as cur:
            cur.execute(
                'UPDATE "Message" SET "text" = %s WHERE "id" = %s',
                ("compressed-edit", "cm"),
            )
        self.assertFalse(
            self.publish("conv-c", "stale-compressed", rev, version, epoch),
            "CAS accepted a summary built before a compressed Message edit",
        )


if __name__ == "__main__":
    # When this file is executed as a script, ``test_timescale_characterization``
    # imports it as ``test_timescale``. Register the current module under that
    # name so the script entry-point does not execute itself twice.
    sys.modules.setdefault("test_timescale", sys.modules[__name__])
    # Import the upstream-issue characterization suite explicitly into this
    # script-based runner. Kept inside ``__main__`` to avoid a circular import
    # when ``test_timescale_characterization`` loads ``test_timescale`` as a
    # module to inherit ``TimescaleGateBase``.
    from test_timescale_characterization import (
        TimescaleUpstream10902CharacterizationTests,
    )

    unittest.main(verbosity=2)
