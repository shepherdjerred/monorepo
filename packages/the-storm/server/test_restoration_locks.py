import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import restoration_files
import restoration_locks
from restoration_json import JsonObject


def fixture(staging: Path, database: Path, request: str) -> JsonObject:
    """Small SQL/receipt fixture; never native-world acceptance evidence."""
    database.parent.mkdir(parents=True, exist_ok=True)
    database.write_bytes(b"")
    with closing(sqlite3.connect(database)) as connection:
        connection.executescript(
            "CREATE TABLE towns_lock(id TEXT, shared_with_town INTEGER, redstone INTEGER);"
            "CREATE TABLE towns_lock_block(lock_id TEXT);"
            "CREATE TABLE towns_lock_restoration(lock_id TEXT, request_id TEXT);"
            "CREATE TABLE towns_lock_historical_owner(lock_id TEXT, player_id TEXT);"
            "CREATE TABLE towns_lock_trust(lock_id TEXT);"
            "INSERT INTO towns_lock VALUES('one',0,0),('two',0,0);"
            "INSERT INTO towns_lock_block VALUES('one'),('two');"
            "INSERT INTO towns_lock_historical_owner VALUES('one','alpha'),('one','beta'),('two','alpha');"
        )
        connection.executemany("INSERT INTO towns_lock_restoration VALUES(?,?)", [("one", request), ("two", request)])
        connection.commit()
    owned = Path(restoration_locks.__file__).parent
    inputs = {
        name: restoration_files.digest(owned / "conversion" / name)
        for name in ("NativeHistoricalLocks.java", "NativeTerrain.java")
    }
    inputs["restoration_locks.py"] = restoration_files.digest(owned / "restoration_locks.py")
    facts = {
        "schemaVersion": 1,
        "requestId": request,
        "databaseReadback": "VERIFIED",
        "worldTicks": 0,
        "terrainChanged": False,
        "containerContentsChanged": False,
        "locks": 2,
        "containerBlocks": 2,
        "historicalOwners": 3,
    }
    for name in ("heritage", "parcels", "towns"):
        checksum = restoration_files.digest(owned / "owned/plugins/TheStorm" / (name + ".yml"))
        inputs[name + ".yml"] = checksum
        facts[name + "Sha256"] = checksum
    receipt = staging / "restoration-database/historical-locks.json"
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(facts))
    return JsonObject(
        {
            "historicalContainerLocks": "VERIFIED",
            "historicalLocksReceiptSha256": restoration_files.digest(receipt),
            "historicalLockCounts": {
                "towns_lock": 2,
                "towns_lock_block": 2,
                "towns_lock_restoration": 2,
                "towns_lock_historical_owner": 3,
            },
            "inputs": inputs,
        }
    )


class RestorationLocksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "restoration-database/the-storm.db"
        self.proof = fixture(self.root, self.database, "request")

    def verify(self):
        return restoration_locks.verify(self.root, self.proof, "request", self.database)

    def test_sealed_inventory_is_verified_without_writes(self):
        before = restoration_files.files(self.root)
        self.assertEqual(self.verify().integer("locks"), 2)
        self.assertEqual(before, restoration_files.files(self.root))

    def test_missing_import_changed_receipt_and_configuration_are_refused(self):
        self.proof["historicalContainerLocks"] = "PENDING"
        with self.assertRaisesRegex(ValueError, "missing"):
            self.verify()
        self.proof["historicalContainerLocks"] = "VERIFIED"
        self.proof.object("inputs")["parcels.yml"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "configuration"):
            self.verify()
        self.proof = fixture(self.root, self.database, "request")
        (self.root / "restoration-database/historical-locks.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "receipt changed"):
            self.verify()

    def test_wrong_request_counts_and_accidental_sharing_are_refused(self):
        for statement in (
            "UPDATE towns_lock_restoration SET request_id='foreign'",
            "DELETE FROM towns_lock_block WHERE lock_id='two'",
            "UPDATE towns_lock SET shared_with_town=1",
            "UPDATE towns_lock SET redstone=1",
            "INSERT INTO towns_lock_trust VALUES('one')",
        ):
            with self.subTest(statement=statement):
                self.proof = fixture(self.root, self.database, "request")
                with closing(sqlite3.connect(self.database)) as connection:
                    connection.execute(statement)
                    connection.commit()
                with self.assertRaises(ValueError):
                    self.verify()

    def test_changed_importer_and_verifier_are_refused(self):
        for name in ("NativeHistoricalLocks.java", "NativeTerrain.java", "restoration_locks.py"):
            with self.subTest(name=name):
                self.proof = fixture(self.root, self.database, "request")
                self.proof.object("inputs")[name] = "a" * 64
                with self.assertRaisesRegex(ValueError, "changed after preparation"):
                    self.verify()
