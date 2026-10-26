"""Exercise archive safety against real files and SQLite databases."""

import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

spec = importlib.util.spec_from_file_location("progression", Path(__file__).with_name("archive-progression.py"))
assert spec is not None and spec.loader is not None
progression = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progression)


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        for name, value in {
            "world/level.dat": b"preserved-world",
            "world/playerdata/player.dat": b"vanilla-inventory",
            "world/region/r.0.0.mca": b"preserved-builds",
            "world/session.lock": b"lock",
            "plugins/Essentials/userdata/player.yml": b"legacy-homes",
            "plugins/mcMMO/flatfile": b"legacy-skills",
            "plugins/LuckPerms/runtime.db": b"preserved-permissions",
            "plugins/TheStorm/config.yml": b"owned-config",
        }.items():
            file = self.data / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(value)
        self.database = self.data / "plugins/TheStorm/the-storm.db"
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("CREATE TABLE progression (balance INTEGER)")
            connection.execute("INSERT INTO progression VALUES (999)")

    def test_preserves_worlds_inventory_permissions_and_owned_content(self):
        before = progression.fingerprint(self.data / "world")
        progression.archive(self.data)
        self.assertEqual(progression.fingerprint(self.data / "world"), before)
        self.assertEqual((self.data / "plugins/LuckPerms/runtime.db").read_bytes(), b"preserved-permissions")
        self.assertEqual((self.data / "plugins/TheStorm/config.yml").read_bytes(), b"owned-config")
        self.assertFalse(self.database.exists())
        archive = self.data / "progression-archives/v1"
        self.assertEqual((archive / "plugins/Essentials/userdata/player.yml").read_bytes(), b"legacy-homes")
        with closing(sqlite3.connect(archive / "plugins/TheStorm/the-storm.db")) as connection:
            self.assertEqual(connection.execute("SELECT balance FROM progression").fetchone(), (999,))
        receipt = json.loads((self.data / progression.MARKER).read_text(encoding="utf-8"))
        self.assertEqual(receipt, {"version": 1, "status": "complete", "mode": "archive-only", "backupId": None})
        self.database.write_bytes(b"new-progression")
        progression.archive(self.data)
        self.assertEqual(self.database.read_bytes(), b"new-progression")

    def test_resumes_interrupted_moves(self):
        archived = self.data / "progression-archives/v1/plugins/Essentials"
        archived.parent.mkdir(parents=True)
        (self.data / "plugins/Essentials").rename(archived)
        progression.save_marker(self.data / progression.MARKER, "preparing")
        progression.archive(self.data)
        self.assertTrue((archived / "userdata/player.yml").exists())
        self.assertFalse(self.database.exists())
        receipt = json.loads((self.data / progression.MARKER).read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "complete")

    def test_refuses_a_restore_marker(self):
        progression.save_marker(self.data / progression.MARKER, "preparing")
        receipt = json.loads((self.data / progression.MARKER).read_text(encoding="utf-8"))
        receipt["mode"] = "verified-restore"
        receipt["backupId"] = "backup-123"
        (self.data / progression.MARKER).write_text(json.dumps(receipt) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "original archive mode"):
            progression.archive(self.data)

    def test_refuses_pending_obligations_and_conflicting_targets(self):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("CREATE TABLE qol_grave (player TEXT)")
            connection.execute("INSERT INTO qol_grave VALUES ('player')")
        with self.assertRaisesRegex(ValueError, "qol_grave"):
            progression.archive(self.data)
        self.assertTrue(self.database.exists())
        self.assertFalse((self.data / progression.MARKER).exists())
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("DELETE FROM qol_grave")
        (self.data / "progression-archives/v1/plugins/Essentials").mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "Both live and archived"):
            progression.archive(self.data)

    def test_pending_arena_inventory_must_be_settled(self):
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("CREATE TABLE arena_snapshots (player TEXT, restored_at INTEGER)")
            connection.execute("INSERT INTO arena_snapshots VALUES ('player', NULL)")
        with self.assertRaisesRegex(ValueError, "arena inventories"):
            progression.archive(self.data)
        self.assertTrue(self.database.exists())

    def test_refuses_a_running_server_lock(self):
        code = (
            "import fcntl,sys; f=open(sys.argv[1],'r+b'); fcntl.lockf(f,fcntl.LOCK_EX); "
            "print('locked',flush=True); sys.stdin.read()"
        )
        with subprocess.Popen(
            [sys.executable, "-c", code, str(self.data / "world/session.lock")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        ) as process:
            assert process.stdout is not None and process.stdin is not None
            self.assertEqual(process.stdout.readline().strip(), "locked")
            try:
                with self.assertRaisesRegex(ValueError, "stop the server first"):
                    progression.archive(self.data)
            finally:
                process.stdin.close()
                process.wait(timeout=5)
        self.assertTrue(self.database.exists())

    def test_refuses_symlink_targets(self):
        (self.data / "plugins/LWC").symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink target"):
            progression.archive(self.data)


if __name__ == "__main__":
    unittest.main()
