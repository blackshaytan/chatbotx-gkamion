#!/usr/bin/env python3
"""T02 hosted TimescaleDB characterization: same-row EPQ under issue #10902.

This module is intentionally separate from ``test_timescale.py`` so the shared
memory-gate contract stays small and the upstream-storage characterization is
explicit. It is imported into the TimescaleDB test suite below, but it is NOT a
memory guarantee: it documents the real committed mutations on a known-upstream
platform with the EvalPlanQual/dummyResult limitation tracked as
`timescale/timescaledb#10902`.
"""

from __future__ import annotations

import json
import os
import threading
import time
import unittest
from pathlib import Path
from typing import Any

import test_invalidation as base
import test_timescale as ts

ISSUE = "timescale/timescaledb#10902"
FIX_SHA = "d6b6dc649622ffeab20d88ccfba6190c1c631922"
FIX_DATE = "2026-10-29"
EVIDENCE_FILE = "timescale-10902-characterization.json"
WARNING_TAG = "upstream platform limitation, DB semantics not asserted correct"


def _evidence_path() -> Path:
    """Return the explicit CI evidence file; local fallback outside /tmp."""
    env = os.environ.get("DIALOG_MEMORY_TEST_EVIDENCE_PATH")
    if env:
        p = Path(env)
    else:
        scratch = os.environ.get("TMPDIR", "/opt/hermes-data/cache/scratch")
        p = Path(scratch) / "dialog-memory-characterization" / EVIDENCE_FILE
    if p.suffix != ".json":
        p = p / EVIDENCE_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load_evidence() -> dict[str, Any]:
    path = _evidence_path()
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"cases": []}


def _append_evidence(case: dict[str, Any]) -> None:
    path = _evidence_path()
    data = _load_evidence()
    data.setdefault("cases", []).append(case)
    path.write_text(
        json.dumps(data, indent=2, sort_keys=True, default=str),
        encoding="utf-8",
    )


def _server_info(conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT current_setting('server_version_num')")
        version_num = cur.fetchone()[0]
        cur.execute(
            "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
        )
        ext = cur.fetchone()
    return {
        "server_version_num": version_num,
        "timescaledb_extversion": ext[0] if ext else None,
    }


def _row_dict(row: tuple[Any, ...] | None, keys: tuple[str, ...]) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[i] for i, key in enumerate(keys)}


class TimescaleUpstream10902CharacterizationTests(ts.TimescaleGateBase):
    """Document real committed mutations under TimescaleDB issue #10902.

    These tests run on the pinned production TimescaleDB image and record what
    the database actually commits when two transactions touch the same
    hypertable row. They do NOT assert that the upstream result is correct;
    they only assert facts about committed rows and issue a warning when the
    second writer reports ``rowcount = 0`` (the known EPQ limitation).
    """

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.server_info = _server_info(cls.conn)

    def setUp(self) -> None:
        super().setUp()
        self.make_workspace("ws-epq")
        self.make_conversation("ws-epq", "conv-epq")
        self.make_memory("ws-epq", "conv-epq")
        self.created = "2026-03-01 10:00:00+00"
        self.insert_message(
            "ws-epq", "conv-epq", "m-epq", created=self.created, text="hello"
        )
        self.insert_attachment(
            "ws-epq", "conv-epq", "att-epq", "m-epq", self.created
        )
        self.before_rev = self.revision_of("conv-epq")

    def _run_blocking_interleaving(
        self,
        first_query: str,
        first_params: tuple[Any, ...],
        second_query: str,
        second_params: tuple[Any, ...],
        first_keys: tuple[str, ...],
        second_keys: tuple[str, ...],
    ) -> dict[str, Any]:
        """First writer holds the row lock; second writer is observed waiting."""
        first_conn: Any = None
        second_conn: Any = None
        first_ready = threading.Event()
        first_can_commit = threading.Event()
        abort = threading.Event()
        first_pid: int | None = None
        second_pid: int | None = None
        first_obs: dict[str, Any] = {}
        second_obs: dict[str, Any] = {}
        errors: list[BaseException] = []

        def first_tx() -> None:
            nonlocal first_conn, first_pid
            try:
                first_conn = base._tx_connect()
                with first_conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    cur.execute("SELECT pg_backend_pid()")
                    first_pid = cur.fetchone()[0]
                    cur.execute(first_query, first_params)
                    first_obs["rowcount"] = cur.rowcount
                    first_obs["returned"] = _row_dict(cur.fetchone(), first_keys)
                    first_ready.set()
                    if not first_can_commit.wait(timeout=10):
                        raise TimeoutError(
                            "first writer was not released within timeout"
                        )
                    if abort.is_set():
                        return  # controller failed; rollback in finally
                first_conn.commit()
            except BaseException as exc:  # pragma: no cover - diagnostic
                errors.append(exc)
                raise
            finally:
                if first_conn is not None:
                    try:
                        first_conn.rollback()
                    except Exception:
                        pass
                    first_conn.close()

        def second_tx() -> None:
            nonlocal second_conn, second_pid
            try:
                second_conn = base._tx_connect()
                with second_conn.cursor() as cur:
                    cur.execute("SET search_path = dialog_memory_gate, public")
                    cur.execute("SELECT pg_backend_pid()")
                    second_pid = cur.fetchone()[0]
                    self.assertTrue(
                        first_ready.wait(timeout=10),
                        "first writer never acquired the row lock",
                    )
                    cur.execute(second_query, second_params)
                    second_obs["rowcount"] = cur.rowcount
                    second_obs["returned"] = _row_dict(cur.fetchone(), second_keys)
                second_conn.commit()
            except BaseException as exc:  # pragma: no cover - diagnostic
                errors.append(exc)
                raise
            finally:
                if second_conn is not None:
                    try:
                        second_conn.rollback()
                    except Exception:
                        pass
                    second_conn.close()

        t1 = threading.Thread(target=first_tx)
        t2 = threading.Thread(target=second_tx)
        t1.start()
        t2.start()

        try:
            # Wait until both backend PIDs are known.
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and (
                first_pid is None or second_pid is None
            ):
                time.sleep(0.01)

            msg = {
                "first_pid": first_pid,
                "second_pid": second_pid,
                "first_alive": t1.is_alive(),
                "second_alive": t2.is_alive(),
                "errors": [repr(e) for e in errors],
            }
            self.assertIsNotNone(first_pid, msg=repr(msg))
            self.assertIsNotNone(second_pid, msg=repr(msg))

            # Observe that the second backend is blocked by the first backend.
            blockers: list[int] = []
            blocked_by_first = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                with self.conn.cursor() as cur:
                    cur.execute(
                        "SELECT pg_blocking_pids(%s)",
                        (second_pid,),
                    )
                    blockers = cur.fetchone()[0]
                    if first_pid in blockers:
                        blocked_by_first = True
                        break
                time.sleep(0.05)

            msg["blocked_by_first"] = blocked_by_first
            msg["blockers"] = blockers if "blockers" in dir() else None
            self.assertTrue(
                blocked_by_first,
                msg=repr(msg),
            )

            # Only now release the first writer.
            first_can_commit.set()
        except BaseException:
            abort.set()
            raise
        finally:
            first_can_commit.set()
            t1.join(15)
            t2.join(15)

        msg = {
            "first": first_obs,
            "second": second_obs,
            "first_pid": first_pid,
            "second_pid": second_pid,
            "errors": [repr(e) for e in errors],
            "first_alive": t1.is_alive(),
            "second_alive": t2.is_alive(),
        }
        self.assertFalse(t1.is_alive(), msg=repr(msg))
        self.assertFalse(t2.is_alive(), msg=repr(msg))
        self.assertFalse(errors, msg=repr(msg))
        return {
            "first": first_obs,
            "second": second_obs,
            "first_pid": first_pid,
            "second_pid": second_pid,
            "blocked_by_first": True,
        }

    def _common_assertions(
        self,
        case_name: str,
        first: dict[str, Any],
        second: dict[str, Any],
        after_rev: Any,
    ) -> tuple[int, str | None]:
        """Return (sum_rowcounts, warning)."""
        first_rc = int(first.get("rowcount", 0))
        second_rc = int(second.get("rowcount", 0))
        total_rc = first_rc + second_rc

        # rowcount is 0 or 1; RETURNING only present on a hit.
        self.assertIn(first_rc, (0, 1))
        self.assertIn(second_rc, (0, 1))
        if first_rc == 0:
            self.assertIsNone(first["returned"])
        else:
            self.assertIsNotNone(first["returned"])
        if second_rc == 0:
            self.assertIsNone(second["returned"])
        else:
            self.assertIsNotNone(second["returned"])

        # First writer must always affect its row; at least one hit overall.
        self.assertEqual(first_rc, 1, msg=repr({"first": first, "second": second}))
        self.assertGreaterEqual(total_rc, 1, msg=repr({"first": first, "second": second}))

        # Committed source revision shift equals the number of committed mutations.
        delta = after_rev - self.before_rev
        self.assertEqual(
            int(delta),
            total_rc,
            msg=repr({
                "before": self.before_rev,
                "after": after_rev,
                "delta": delta,
                "rowcounts": [first_rc, second_rc],
            }),
        )

        warning = None
        if second_rc == 0:
            warning = (
                f"{WARNING_TAG}: {case_name} saw second UPDATE rowcount=0 "
                f"under {ISSUE} (fix {FIX_SHA}, {FIX_DATE}); "
                f"server={self.server_info['server_version_num']} "
                f"timescaledb={self.server_info['timescaledb_extversion']}"
            )
            print(f"WARNING: {warning}", flush=True)
        return total_rc, warning

    def _write_evidence(
        self,
        case_name: str,
        first: dict[str, Any],
        second: dict[str, Any],
        after_rev: Any,
        final: dict[str, Any] | None,
        status: str,
        warning: str | None,
    ) -> None:
        if final is not None:
            second_rc = int(second.get("rowcount", 0))
            winner = second if second_rc == 1 else first
            self.assertEqual(final["tableoid"], winner["returned"]["tableoid"])
        _append_evidence({
            "case": case_name,
            "issue": ISSUE,
            "fix_sha": FIX_SHA,
            "fix_date": FIX_DATE,
            "server_info": self.server_info,
            "before_revision": self.before_rev,
            "after_revision": after_rev,
            "delta_revision": after_rev - self.before_rev,
            "first": first,
            "second": second,
            "final": final,
            "status": status,
            "warning": warning,
        })

    def test_message_update_update_same_row(self) -> None:
        """(a) Two concurrent Message UPDATEs on the same row."""
        first_keys = ("id", "text", "tableoid", "xmin")
        second_keys = ("id", "text", "tableoid", "xmin")
        result = self._run_blocking_interleaving(
            'UPDATE "Message" SET "text" = %s WHERE "id" = %s'
            ' RETURNING "id", "text", tableoid::regclass::text, xmin::text',
            ("first", "m-epq"),
            'UPDATE "Message" SET "text" = %s WHERE "id" = %s'
            ' RETURNING "id", "text", tableoid::regclass::text, xmin::text',
            ("second", "m-epq"),
            first_keys,
            second_keys,
        )
        first = result["first"]
        second = result["second"]
        after_rev = self.revision_of("conv-epq")

        total_rc, warning = self._common_assertions(
            "message_update_update_same_row", first, second, after_rev
        )

        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "text", tableoid::regclass::text, xmin::text'
                ' FROM "Message" WHERE "id" = %s',
                ("m-epq",),
            )
            final = cur.fetchone()

        final_dict: dict[str, Any] | None = None
        if final:
            final_dict = {
                "text": final[0],
                "tableoid": final[1],
                "xmin": final[2],
            }

        if second["rowcount"] == 1:
            self.assertIsNotNone(final)
            self.assertEqual(final[0], "second")
            self.assertEqual(final[2], second["returned"]["xmin"])
            status = "second_committed"
        else:
            self.assertIsNotNone(final)
            self.assertEqual(final[0], "first")
            self.assertEqual(final[2], first["returned"]["xmin"])
            status = "second_noop"

        self._write_evidence(
            "message_update_update_same_row",
            first,
            second,
            after_rev,
            final_dict,
            status,
            warning,
        )

    def test_message_update_soft_delete_same_row(self) -> None:
        """(b) First Message UPDATE, then soft DELETE (deletedAt) on same row."""
        first_keys = ("id", "text", "tableoid", "xmin")
        second_keys = ("id", "deletedAt", "tableoid", "xmin")
        result = self._run_blocking_interleaving(
            'UPDATE "Message" SET "text" = %s WHERE "id" = %s'
            ' RETURNING "id", "text", tableoid::regclass::text, xmin::text',
            ("first", "m-epq"),
            'UPDATE "Message" SET "deletedAt" = now() WHERE "id" = %s'
            ' RETURNING "id", "deletedAt", tableoid::regclass::text, xmin::text',
            ("m-epq",),
            first_keys,
            second_keys,
        )
        first = result["first"]
        second = result["second"]
        after_rev = self.revision_of("conv-epq")

        total_rc, warning = self._common_assertions(
            "message_update_soft_delete_same_row", first, second, after_rev
        )

        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "text", "deletedAt", tableoid::regclass::text, xmin::text'
                ' FROM "Message" WHERE "id" = %s',
                ("m-epq",),
            )
            final = cur.fetchone()

        final_dict: dict[str, Any] | None = None
        if final:
            final_dict = {
                "text": final[0],
                "deletedAt": final[1],
                "tableoid": final[2],
                "xmin": final[3],
            }

        if second["rowcount"] == 1:
            self.assertIsNotNone(final)
            self.assertEqual(final[0], "first")
            self.assertIsNotNone(final[1])
            self.assertEqual(final[1], second["returned"]["deletedAt"])
            self.assertEqual(final[3], second["returned"]["xmin"])
            status = "second_committed"
        else:
            self.assertIsNotNone(final)
            self.assertEqual(final[0], "first")
            self.assertIsNone(final[1])
            self.assertEqual(final[3], first["returned"]["xmin"])
            status = "second_noop"

        self._write_evidence(
            "message_update_soft_delete_same_row",
            first,
            second,
            after_rev,
            final_dict,
            status,
            warning,
        )

    def test_message_update_delete_same_row(self) -> None:
        """(c) First Message UPDATE, then physical DELETE on same row."""
        first_keys = ("id", "text", "tableoid", "xmin")
        second_keys = ("id", "tableoid", "xmin")
        result = self._run_blocking_interleaving(
            'UPDATE "Message" SET "text" = %s WHERE "id" = %s'
            ' RETURNING "id", "text", tableoid::regclass::text, xmin::text',
            ("first", "m-epq"),
            'DELETE FROM "Message" WHERE "id" = %s'
            ' RETURNING "id", tableoid::regclass::text, xmin::text',
            ("m-epq",),
            first_keys,
            second_keys,
        )
        first = result["first"]
        second = result["second"]
        after_rev = self.revision_of("conv-epq")

        total_rc, warning = self._common_assertions(
            "message_update_delete_same_row", first, second, after_rev
        )

        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT tableoid::regclass::text, xmin::text'
                ' FROM "Message" WHERE "id" = %s',
                ("m-epq",),
            )
            final = cur.fetchone()

        final_dict: dict[str, Any] | None = None
        if final:
            final_dict = {
                "tableoid": final[0],
                "xmin": final[1],
            }

        if second["rowcount"] == 1:
            self.assertIsNone(final)
            status = "second_committed"
        else:
            self.assertIsNotNone(final)
            self.assertEqual(final[1], first["returned"]["xmin"])
            status = "second_noop"

        self._write_evidence(
            "message_update_delete_same_row",
            first,
            second,
            after_rev,
            final_dict,
            status,
            warning,
        )

    def test_attachment_update_update_same_parent(self) -> None:
        """(d) Two concurrent Attachment UPDATEs sharing the same parent row."""
        first_keys = ("id", "originPath", "tableoid", "xmin")
        second_keys = ("id", "originPath", "tableoid", "xmin")
        result = self._run_blocking_interleaving(
            'UPDATE "Attachment" SET "originPath" = %s WHERE "id" = %s'
            ' RETURNING "id", "originPath", tableoid::regclass::text, xmin::text',
            ("s3://first", "att-epq"),
            'UPDATE "Attachment" SET "originPath" = %s WHERE "id" = %s'
            ' RETURNING "id", "originPath", tableoid::regclass::text, xmin::text',
            ("s3://second", "att-epq"),
            first_keys,
            second_keys,
        )
        first = result["first"]
        second = result["second"]
        after_rev = self.revision_of("conv-epq")

        total_rc, warning = self._common_assertions(
            "attachment_update_update_same_parent", first, second, after_rev
        )

        with self.conn.cursor() as cur:
            cur.execute(
                'SELECT "originPath", tableoid::regclass::text, xmin::text'
                ' FROM "Attachment" WHERE "id" = %s',
                ("att-epq",),
            )
            final = cur.fetchone()

        final_dict: dict[str, Any] | None = None
        if final:
            final_dict = {
                "originPath": final[0],
                "tableoid": final[1],
                "xmin": final[2],
            }

        if second["rowcount"] == 1:
            self.assertIsNotNone(final)
            self.assertEqual(final[0], "s3://second")
            self.assertEqual(final[2], second["returned"]["xmin"])
            status = "second_committed"
        else:
            self.assertIsNotNone(final)
            self.assertEqual(final[0], "s3://first")
            self.assertEqual(final[2], first["returned"]["xmin"])
            status = "second_noop"

        self._write_evidence(
            "attachment_update_update_same_parent",
            first,
            second,
            after_rev,
            final_dict,
            status,
            warning,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
