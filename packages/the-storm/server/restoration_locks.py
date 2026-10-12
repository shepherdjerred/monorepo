"""Verify the sealed historical container import before assembling or installing a world."""

import sqlite3
from contextlib import closing
from pathlib import Path

import restoration_files
from restoration_json import JsonObject


def verify(staging: Path, database_proof: JsonObject, request: str, database: Path) -> JsonObject:
    owned = Path(__file__).resolve().parent
    if database_proof.get("historicalContainerLocks") != "VERIFIED":
        raise ValueError("Historical container lock import is missing")
    receipt = staging / "restoration-database/historical-locks.json"
    if receipt.is_symlink() or restoration_files.digest(receipt) != database_proof.string(
        "historicalLocksReceiptSha256"
    ):
        raise ValueError("Historical container lock receipt changed")
    facts = JsonObject.parse(receipt.read_bytes())
    if (
        facts.integer("schemaVersion") != 1
        or facts.string("requestId") != request
        or facts.string("databaseReadback") != "VERIFIED"
        or facts.integer("worldTicks") != 0
        or facts.get("terrainChanged") is not False
        or facts.get("containerContentsChanged") is not False
        or facts.integer("locks") <= 0
        or facts.integer("containerBlocks") < facts.integer("locks")
        or facts.integer("historicalOwners") < facts.integer("locks")
    ):
        raise ValueError("Historical container lock proof violates the restoration contract")
    inputs = database_proof.object("inputs")
    for name in ("NativeHistoricalLocks.java", "NativeTerrain.java"):
        if inputs.string(name) != restoration_files.digest(owned / "conversion" / name):
            raise ValueError("Historical container importer changed after preparation")
    if inputs.string("restoration_locks.py") != restoration_files.digest(Path(__file__)):
        raise ValueError("Historical container verification changed after preparation")
    for name in ("heritage", "parcels", "towns"):
        checksum = restoration_files.digest(owned / "owned/plugins/TheStorm" / (name + ".yml"))
        if inputs.string(name + ".yml") != checksum or facts.string(name + "Sha256") != checksum:
            raise ValueError("Historical container ownership configuration changed")
    counts = {
        "towns_lock": facts.integer("locks"),
        "towns_lock_block": facts.integer("containerBlocks"),
        "towns_lock_restoration": facts.integer("locks"),
        "towns_lock_historical_owner": facts.integer("historicalOwners"),
    }
    recorded = database_proof.object("historicalLockCounts")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
        for table, count in counts.items():
            if recorded.integer(table) != count or connection.execute("SELECT COUNT(*) FROM " + table).fetchone() != (
                count,
            ):
                raise ValueError("Historical container database counts differ from the sealed inventory")
        if connection.execute(
            "SELECT COUNT(*) FROM towns_lock_restoration WHERE request_id <> ?", (request,)
        ).fetchone() != (0,):
            raise ValueError("Historical container database belongs to another restoration")
        if connection.execute(
            "SELECT COUNT(*) FROM towns_lock WHERE shared_with_town <> 0 OR redstone <> 0"
        ).fetchone() != (0,) or connection.execute("SELECT COUNT(*) FROM towns_lock_trust").fetchone() != (0,):
            raise ValueError("Historical containers have unexpected shared access")
    return facts
