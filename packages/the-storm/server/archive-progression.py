#!/usr/bin/env python3
"""One-time, stopped-server progression archive; worlds and player data stay put."""

import argparse
from contextlib import ExitStack, closing
import fcntl
import hashlib
import json
from pathlib import Path
import sqlite3

MARKER = ".the-storm-progression-v1.json"
LEGACY = (
    "ChestSort", "ChunkyBorder", "CombatLog", "CraftBook5", "DecentHolograms",
    "DiscordSRV", "DynamicShop", "Essentials", "EssentialsSpawn", "GravesX",
    "LevelledMobs", "Lunamatic", "MobArena", "PlaceholderAPI", "Plan",
    "ProtocolLib", "Sleeper", "Towny", "Vault", "VentureChat", "WorldGuard",
    "XConomy", "mcMMO", "LWC",
)
TARGETS = tuple(f"plugins/{name}" for name in LEGACY) + (
    "plugins/TheStorm/the-storm.db",
    "plugins/TheStorm/the-storm.db-wal",
    "plugins/TheStorm/the-storm.db-shm",
)
PENDING = (
    "arena_pending_rewards", "essentials_teleport_attempts", "essentials_kit_deliveries",
    "shops_refund_failure", "qol_rtp_attempt", "qol_grave", "qol_grave_items",
    "towns_pending_payout", "quests_pending_world",
)


def fingerprint(path: Path) -> dict[str, str]:
    """Names and contents, without emitting or copying file contents."""
    if path.is_symlink():
        raise ValueError(f"Refusing symlink target: {path.name}")
    if not path.exists():
        return {}
    files = [path] if path.is_file() else sorted(path.rglob("*"))
    hashes = {}
    for file in files:
        if file.is_symlink():
            raise ValueError(f"Refusing symlink inside {path.name}")
        if not file.is_file() or file.name == "session.lock":
            continue
        digest = hashlib.sha256()
        with file.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        hashes[str(file.relative_to(path)) if file != path else "."] = digest.hexdigest()
    return hashes


def hold_world_locks(root: Path, stack: ExitStack) -> list[Path]:
    worlds = sorted(p.parent for p in root.glob("*/level.dat"))
    if not worlds or not (root / "world/level.dat").is_file():
        raise ValueError("Expected an existing Minecraft data directory with world/level.dat")
    for world in worlds:
        lock = world / "session.lock"
        if lock.exists():
            handle = stack.enter_context(lock.open("r+b"))
            try:
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ValueError(f"World {world.name} is running; stop the server first") from error
    return worlds


def require_settled(database: Path) -> None:
    if not database.exists():
        return
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("Storm database failed integrity_check")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in PENDING:
            if table in tables and connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]:
                raise ValueError(f"Recover outstanding {table} obligations before archiving")
        if "arena_snapshots" in tables:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(arena_snapshots)")}
            condition = " WHERE restored_at IS NULL" if "restored_at" in columns else ""
            if connection.execute("SELECT COUNT(*) FROM arena_snapshots" + condition).fetchone()[0]:
                raise ValueError("Restore outstanding arena inventories before archiving")


def save_marker(path: Path, status: str, backup_id: str) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"version": 1, "status": status, "backupId": backup_id}) + "\n", encoding="utf-8")
    temporary.replace(path)


def archive(data: Path, restored: Path, backup_id: str) -> None:
    data, restored = data.resolve(strict=True), restored.resolve(strict=True)
    if data == restored or data in restored.parents or restored in data.parents:
        raise ValueError("The restore must be an independent directory outside the live data tree")
    marker = data / MARKER
    if marker.exists():
        receipt = json.loads(marker.read_text(encoding="utf-8"))
        if receipt.get("version") != 1 or receipt.get("status") not in ("preparing", "complete"):
            raise ValueError("Invalid progression archive marker")
        if receipt["status"] == "complete":
            print("Progression archive already complete; nothing changed")
            return
        if receipt.get("backupId") != backup_id:
            raise ValueError("Resume with the original backup ID")
    destination = data / "progression-archives/v1"
    with ExitStack() as stack:
        worlds = hold_world_locks(data, stack)
        hold_world_locks(restored, stack)
        for world in worlds:
            if fingerprint(world) != fingerprint(restored / world.name):
                raise ValueError(f"Restored world differs: {world.name}")
        for target in TARGETS:
            source, archived, backup = data / target, destination / target, restored / target
            if source.exists() and archived.exists():
                raise ValueError(f"Both live and archived copies exist: {target}")
            actual = archived if archived.exists() else source
            if fingerprint(actual) != fingerprint(backup):
                raise ValueError(f"Restored progression differs: {target}")
        database = data / "plugins/TheStorm/the-storm.db"
        require_settled(database if database.exists() else destination / "plugins/TheStorm/the-storm.db")
        save_marker(marker, "preparing", backup_id)
        for target in TARGETS:
            source, archived = data / target, destination / target
            if source.exists():
                archived.parent.mkdir(parents=True, exist_ok=True)
                source.rename(archived)
        save_marker(marker, "complete", backup_id)
    print("Progression archived; verified worlds and vanilla player data preserved")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--restored-data", type=Path, required=True)
    parser.add_argument("--backup-id", required=True)
    args = parser.parse_args()
    if not args.backup_id.strip():
        parser.error("backup ID must not be empty")
    archive(args.data, args.restored_data, args.backup_id)


if __name__ == "__main__":
    main()
