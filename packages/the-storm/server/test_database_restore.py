import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

spec = importlib.util.spec_from_file_location("database_restore", Path(__file__).with_name("database-restore.py"))
assert spec is not None and spec.loader is not None
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class DatabaseRestoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = self.root / "original.db"
        self.candidate = self.root / "candidate.db"
        self.policy = {
            "schemaVersion": 1,
            "archiveSha256": "89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa",
            "retainTables": ["core_player", "chat_ignore"],
            "resetTables": ["tracks_level"],
            "migrationModules": ["core"],
        }
        for file in (self.original, self.candidate):
            with closing(sqlite3.connect(file)) as connection:
                connection.executescript("""
                    CREATE TABLE core_player(id TEXT PRIMARY KEY, name TEXT, payload BLOB, value REAL);
                    CREATE TABLE chat_ignore(player TEXT REFERENCES core_player(id), ignored TEXT,
                        PRIMARY KEY(player, ignored));
                    CREATE TABLE tracks_level(player TEXT PRIMARY KEY, level INTEGER);
                    CREATE TABLE flyway_core_history(version TEXT PRIMARY KEY);
                """)
                connection.execute("INSERT INTO flyway_core_history VALUES (?)", (file.stem,))
                connection.commit()
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("INSERT INTO core_player VALUES ('alice','Alice',?,1.5)", (b"\x00\xfffixture",))
            connection.execute("INSERT INTO core_player VALUES ('bob',NULL,NULL,NULL)")
            connection.execute("INSERT INTO chat_ignore VALUES ('alice','bob')")
            connection.execute("INSERT INTO tracks_level VALUES ('alice',5)")
            connection.commit()

    def import_rows(self):
        return restore.retain_identity(self.original, self.candidate, self.policy)

    def test_preserves_every_identity_value_and_keeps_fresh_history_and_empty_progression(self):
        before = hashlib.sha256(self.original.read_bytes()).hexdigest()
        receipt = self.import_rows()
        self.assertEqual(receipt["retained"]["core_player"]["rows"], 2)
        self.assertEqual(before, hashlib.sha256(self.original.read_bytes()).hexdigest())
        with closing(sqlite3.connect(self.candidate)) as connection:
            self.assertEqual(
                connection.execute("SELECT payload,value FROM core_player WHERE id='alice'").fetchone(),
                (b"\x00\xfffixture", 1.5),
            )
            self.assertEqual(
                connection.execute("SELECT name,payload,value FROM core_player WHERE id='bob'").fetchone(),
                (None, None, None),
            )
            self.assertEqual(connection.execute("SELECT * FROM chat_ignore").fetchall(), [("alice", "bob")])
            self.assertEqual(connection.execute("SELECT * FROM tracks_level").fetchall(), [])
            self.assertEqual(connection.execute("SELECT * FROM flyway_core_history").fetchall(), [("candidate",)])
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_uncheckpointed_source_wal_is_refused_before_any_rows_are_imported(self):
        self.original.with_name(self.original.name + "-wal").write_bytes(b"uncheckpointed")
        with self.assertRaisesRegex(ValueError, "fully checkpointed WAL"):
            self.import_rows()
        with closing(sqlite3.connect(self.candidate)) as connection:
            self.assertEqual(connection.execute("SELECT * FROM core_player").fetchall(), [])

    def test_wal_mode_source_readback_does_not_create_sidecars(self):
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
        before = sorted(file.name for file in self.root.iterdir())
        self.import_rows()
        self.assertEqual(sorted(file.name for file in self.root.iterdir()), before)

    def test_unknown_tables_fail_without_copying_rows(self):
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("CREATE TABLE unreviewed_state(id TEXT)")
        with self.assertRaisesRegex(ValueError, "reviewed retention policy"):
            self.import_rows()
        with closing(sqlite3.connect(self.candidate)) as connection:
            self.assertEqual(connection.execute("SELECT * FROM core_player").fetchall(), [])

    def test_schema_change_rolls_back_earlier_retained_rows(self):
        with closing(sqlite3.connect(self.candidate)) as connection:
            connection.execute("ALTER TABLE chat_ignore ADD COLUMN unreviewed TEXT")
        with self.assertRaisesRegex(ValueError, "schema changed"):
            self.import_rows()
        with closing(sqlite3.connect(self.candidate)) as connection:
            self.assertEqual(connection.execute("SELECT * FROM core_player").fetchall(), [])

    def test_nonempty_candidate_is_refused(self):
        with closing(sqlite3.connect(self.candidate)) as connection:
            connection.execute("INSERT INTO tracks_level VALUES ('alice',1)")
            connection.commit()
        with self.assertRaisesRegex(ValueError, "fresh empty"):
            self.import_rows()

    def test_original_cannot_be_its_own_candidate_or_a_link(self):
        with self.assertRaisesRegex(ValueError, "same file"):
            restore.retain_identity(self.original, self.original, self.policy)
        linked = self.root / "linked.db"
        linked.symlink_to(self.original)
        with self.assertRaisesRegex(ValueError, "independent database"):
            restore.retain_identity(linked, self.candidate, self.policy)

    def test_invalid_retained_foreign_key_is_refused(self):
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("INSERT INTO chat_ignore VALUES ('absent','bob')")
            connection.commit()
        with self.assertRaisesRegex(ValueError, "foreign_key_check"):
            self.import_rows()

    def test_hashes_preserve_types_duplicates_and_length_boundaries(self):
        self.assertNotEqual(restore.row_digest((1,)), restore.row_digest(("1",)))
        self.assertNotEqual(restore.row_digest(("ab", "c")), restore.row_digest(("a", "bc")))
        self.assertNotEqual(restore.row_digest((None,)), restore.row_digest((b"",)))

    def test_private_version_upgrade_preserves_existing_identity_rows(self):
        policy = dict(self.policy, retainTables=["core_player", "chat_ignore", "mail_letters"])
        before = restore.identity_manifest(self.original, policy)
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("CREATE TABLE mail_letters(id TEXT PRIMARY KEY, text TEXT)")
        after = restore.verify_identity_upgrade(before, self.original, policy)
        self.assertEqual(after["core_player"], before["core_player"])
        self.assertEqual(after["chat_ignore"], before["chat_ignore"])
        self.assertEqual(after["mail_letters"][0], 0)
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("UPDATE core_player SET name='changed' WHERE id='alice'")
            connection.commit()
        with self.assertRaisesRegex(ValueError, "changed retained"):
            restore.verify_identity_upgrade(before, self.original, policy)

    def test_private_version_upgrade_refuses_invented_or_missing_identity_tables(self):
        policy = dict(self.policy, retainTables=["core_player", "chat_ignore", "mail_letters"])
        before = restore.identity_manifest(self.original, policy)
        with self.assertRaisesRegex(ValueError, "omitted"):
            restore.verify_identity_upgrade(before, self.original, policy)
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("CREATE TABLE mail_letters(id TEXT PRIMARY KEY, text TEXT)")
            connection.execute("INSERT INTO mail_letters VALUES ('invented','not from a player')")
            connection.commit()
        with self.assertRaisesRegex(ValueError, "invented"):
            restore.verify_identity_upgrade(before, self.original, policy)

    def test_world_bound_staff_state_is_refused_before_any_retained_rows_are_copied(self):
        policy = dict(self.policy, retainTables=["core_player", "chat_ignore", "essentials_staff_state"])
        for file in (self.original, self.candidate):
            with closing(sqlite3.connect(file)) as connection:
                connection.execute("CREATE TABLE essentials_staff_state(kind TEXT, id TEXT, value TEXT)")
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("INSERT INTO essentials_staff_state VALUES ('spawn','global','modern coordinates')")
            connection.commit()
        with self.assertRaisesRegex(ValueError, "explicit position migration"):
            restore.retain_identity(self.original, self.candidate, policy)
        with closing(sqlite3.connect(self.candidate)) as connection:
            self.assertEqual(connection.execute("SELECT * FROM core_player").fetchall(), [])
        with closing(sqlite3.connect(self.original)) as connection:
            connection.execute("UPDATE essentials_staff_state SET kind='ip-ban'")
            connection.commit()
        receipt = restore.retain_identity(self.original, self.candidate, policy)
        self.assertEqual(receipt["retained"]["essentials_staff_state"]["rows"], 1)

    def test_reviewed_policy_covers_every_current_candidate_migration_table(self):
        policy = restore.reviewed_policy(Path(__file__).with_name("restoration-policy.json"))
        plugin = Path(__file__).parents[1] / "plugin"
        migrations: dict[str, list[Path]] = {}
        for file in plugin.glob("**/src/main/resources/db/migration/*/V*.sql"):
            migrations.setdefault(file.parent.name, []).append(file)
        self.assertEqual(set(migrations), set(policy["migrationModules"]))
        with closing(sqlite3.connect(":memory:")) as connection:
            for module in policy["migrationModules"]:
                for file in sorted(migrations[module], key=lambda path: int(path.name.split("__")[0][1:])):
                    connection.executescript(file.read_text(encoding="utf-8"))
            self.assertEqual(
                restore.tables(connection, "main"), set(policy["retainTables"]) | set(policy["resetTables"])
            )
        self.assertIn("mail_letters", policy["retainTables"])
        self.assertIn("essentials_staff_audit", policy["retainTables"])
        self.assertIn("essentials_teleport_state", policy["resetTables"])
        self.assertIn("essentials_teleport_uses", policy["resetTables"])
        self.assertNotIn("essentials_teleport_usage", policy["resetTables"])

    def test_policy_has_no_overlap_duplicates_or_unknown_fields(self):
        file = self.root / "policy.json"
        file.write_text(json.dumps(self.policy), encoding="utf-8")
        self.assertEqual(restore.reviewed_policy(file), self.policy)
        for bad in (
            dict(self.policy, resetTables=["core_player"]),
            dict(self.policy, retainTables=["core_player", "core_player"]),
            dict(self.policy, unknown=True),
            dict(self.policy, retainTables=[{"invalid": True}]),
        ):
            file.write_text(json.dumps(bad), encoding="utf-8")
            with self.assertRaises(ValueError):
                restore.reviewed_policy(file)


if __name__ == "__main__":
    unittest.main()
