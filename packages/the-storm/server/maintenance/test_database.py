import sqlite3
import tempfile
import tracemalloc
import unittest
from contextlib import closing
from pathlib import Path

from maintenance import database


class DatabaseTest(unittest.TestCase):
    @staticmethod
    def snapshot(connection: sqlite3.Connection) -> dict[str, list[database.Row]]:
        return {
            name: sorted(connection.execute(f'SELECT * FROM "{name}"'), key=repr)
            for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.source = Path(temporary.name) / "original.db"
        self.target = Path(temporary.name) / "prepared.db"
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.executescript("""
                CREATE TABLE creative_bodies(player TEXT PRIMARY KEY,world TEXT,x DOUBLE,y DOUBLE,z DOUBLE,
                                             yaw DOUBLE,pitch DOUBLE,inventory BLOB,ender_chest BLOB,level INTEGER);
                CREATE TABLE essentials_homes(player TEXT PRIMARY KEY,world TEXT,x DOUBLE,y DOUBLE,z DOUBLE);
                CREATE TABLE qol_grave(id TEXT PRIMARY KEY,owner TEXT,world TEXT,x INTEGER,y INTEGER,z INTEGER);
                CREATE TABLE qol_graves(id TEXT PRIMARY KEY,owner TEXT,world TEXT,x INTEGER,y INTEGER,z INTEGER,
                                        replaced_block TEXT,created_at BIGINT,UNIQUE(world,x,y,z));
                CREATE TABLE qol_grave_items(grave TEXT REFERENCES qol_graves(id),idx INTEGER,item BLOB,
                                            PRIMARY KEY(grave,idx));
                CREATE TABLE qol_grave_claims(grave TEXT,idx INTEGER,token TEXT,taker TEXT,
                                             FOREIGN KEY(grave,idx) REFERENCES qol_grave_items(grave,idx));
                CREATE TABLE qol_grave_drops(grave TEXT,idx INTEGER,world TEXT,x INTEGER,y INTEGER,z INTEGER,
                                            FOREIGN KEY(grave,idx) REFERENCES qol_grave_items(grave,idx));
                CREATE TABLE qol_notices(id INTEGER PRIMARY KEY AUTOINCREMENT,player TEXT,message TEXT,
                                         created_at BIGINT);
                CREATE TABLE economy_account(player TEXT PRIMARY KEY,balance INTEGER);
                INSERT INTO creative_bodies VALUES('p','creative',2000,65,2000,17,23,X'0001',X'00FF',42);
                INSERT INTO essentials_homes VALUES('p','wilds',10,70,10);
                INSERT INTO qol_graves VALUES('g','p','wilds',20,70,20,'minecraft:stone',0);
                INSERT INTO qol_grave_items VALUES('g',0,X'CAFE');
                INSERT INTO qol_grave_claims VALUES('g',0,'durable-token','p');
                INSERT INTO economy_account VALUES('p',12345);
            """)
        self.sites = [{"world": "world", "x": 71, "y": 69, "z": 67}]
        self.radii = {"world": 7000.0, "creative": 1500.0}

    def test_relocates_destinations_and_preserves_complete_items_effects_and_claim_tokens(self):
        with closing(sqlite3.connect(self.source)) as source:
            before = self.snapshot(source)
        result = database.prepare(self.source, self.target, self.sites, 123456, self.radii)
        self.assertEqual(result["destinationsRelocated"], 3)
        self.assertEqual(result["gravesRelocated"], 1)
        with closing(sqlite3.connect(self.source)) as source, closing(sqlite3.connect(self.target)) as target:
            self.assertEqual(self.snapshot(source), before)
            self.assertEqual(
                target.execute("SELECT world,x,y,z,inventory,ender_chest,level FROM creative_bodies").fetchone(),
                ("creative", -1, 65, -1, b"\x00\x01", b"\x00\xff", 42),
            )
            for table in ("qol_grave_items", "qol_grave_claims", "economy_account"):
                self.assertEqual(self.snapshot(target)[table], before[table])
            self.assertEqual(
                target.execute("SELECT world,x,y,z,replaced_block FROM qol_graves").fetchone(),
                ("world", 71, 69, 67, "minecraft:air"),
            )
            self.assertIn("world 71, 69, 67", target.execute("SELECT message FROM qol_notices").fetchone()[0])
            self.assertEqual(target.execute("SELECT created_at FROM qol_graves").fetchone()[0], 123456)

    def test_every_grave_needs_a_distinct_verified_destination(self):
        with self.assertRaisesRegex(ValueError, "Every inaccessible grave"):
            database.prepare(self.source, self.target, [], 123, self.radii)

    def test_collision_is_refused_before_any_source_write(self):
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("INSERT INTO qol_graves VALUES('other','p','world',71,69,67,'minecraft:air',0)")
        with self.assertRaisesRegex(ValueError, "collides"):
            database.prepare(self.source, self.target, self.sites, 123, self.radii)

    def test_pending_item_drop_requires_reconciliation(self):
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("INSERT INTO qol_grave_drops VALUES('g',0,'wilds',20,70,20)")
        with self.assertRaisesRegex(ValueError, "pending drops"):
            database.prepare(self.source, self.target, self.sites, 123, self.radii)

    def test_unreviewed_world_reference_fails_closed(self):
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.executescript(
                "CREATE TABLE future_items(world TEXT,item BLOB); INSERT INTO future_items VALUES('peaks',X'CAFE');"
            )
        with self.assertRaisesRegex(ValueError, "Unreviewed retired-world reference"):
            database.prepare(self.source, self.target, self.sites, 123, self.radii)

    def test_circle_excludes_the_square_corner(self):
        self.assertFalse(database.outside("creative", 1500, 0, self.radii))
        self.assertTrue(database.outside("creative", 1400, 1400, self.radii))
        self.assertTrue(database.outside("peaks", 0, 0, self.radii))
        with self.assertRaisesRegex(ValueError, "not finite"):
            database.outside("world", float("nan"), 0, self.radii)

    def test_spell_marks_keep_native_world_keys_and_obey_retained_circles(self):
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute(
                "CREATE TABLE spells_mark(player TEXT PRIMARY KEY,world TEXT,x DOUBLE,y DOUBLE,z DOUBLE)"
            )
            connection.executemany(
                "INSERT INTO spells_mark VALUES(?,?,?,70,?)",
                [
                    ("retired", "minecraft:wilds", 0, 0),
                    ("main", "minecraft:overworld", 7001, 0),
                    ("creative", "minecraft:creative", 1400, 1400),
                    ("frontier", "minecraft:frontier", 7001, 0),
                    ("nether", "minecraft:the_nether", 5001, 0),
                    ("end", "minecraft:the_end", 1751, 0),
                    ("edge", "minecraft:frontier", 7000, 0),
                ],
            )
        radii = {**self.radii, "frontier": 7000.0, "world_nether": 5000.0, "world_the_end": 1750.0}
        database.prepare(self.source, self.target, self.sites, 123456, radii)
        with closing(sqlite3.connect(self.target)) as target:
            marks = dict((row[0], row[1:]) for row in target.execute("SELECT player,world,x,y,z FROM spells_mark"))
            for name in ("retired", "main", "frontier", "nether", "end"):
                self.assertEqual(marks[name], ("minecraft:overworld", 68.5, 69, 66.5))
            self.assertEqual(marks["creative"], ("minecraft:creative", -1, 65, -1))
            self.assertEqual(marks["edge"], ("minecraft:frontier", 7000, 70, 0))

    def test_large_unrelated_item_rows_are_verified_without_retaining_their_bytes(self):
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("CREATE TABLE archived_items(id INTEGER PRIMARY KEY,item BLOB)")
            connection.executemany("INSERT INTO archived_items(item) VALUES(zeroblob(262144))", [()] * 256)
            tracemalloc.start()
            try:
                before = database.fingerprints(connection)
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            self.assertLess(peak, 4 * 1024 * 1024)
            connection.execute("UPDATE archived_items SET item=X'CAFE' WHERE id=128")
            self.assertNotEqual(database.fingerprints(connection)["archived_items"], before["archived_items"])


if __name__ == "__main__":
    unittest.main()
