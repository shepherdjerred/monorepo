#!/usr/bin/env python3
"""Offline identity retention for a fresh database migrated by the exact candidate plugin."""

import hashlib
import json
import re
import sqlite3
import struct
from contextlib import closing
from pathlib import Path
from typing import TypedDict, cast


class RetentionPolicy(TypedDict):
    schemaVersion: int
    archiveSha256: str
    retainTables: list[str]
    resetTables: list[str]
    migrationModules: list[str]


def reviewed_policy(path: Path) -> RetentionPolicy:
    policy = json.loads(path.read_text(encoding="utf-8"))
    fields = {"schemaVersion", "archiveSha256", "retainTables", "resetTables", "migrationModules"}
    if (
        not isinstance(policy, dict)
        or policy.keys() != fields
        or policy["schemaVersion"] != 1
        or policy["archiveSha256"] != "89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa"
    ):
        raise ValueError("Invalid restoration retention policy")
    for key in ("retainTables", "resetTables", "migrationModules"):
        values = policy[key]
        if (
            not isinstance(values, list)
            or not values
            or any(not isinstance(value, str) or not re.fullmatch("[a-z_]+", value) for value in values)
            or len(set(values)) != len(values)
        ):
            raise ValueError("Invalid or duplicated restoration policy entry")
    if set(policy["retainTables"]) & set(policy["resetTables"]):
        raise ValueError("Retention and reset policy overlap")
    return cast(RetentionPolicy, policy)


def tables(connection: sqlite3.Connection, schema: str) -> set[str]:
    if schema not in ("main", "original"):
        raise ValueError("Unknown schema")
    return {
        row[0]
        for row in connection.execute(
            f"SELECT name FROM {schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def columns(connection: sqlite3.Connection, schema: str, table: str) -> list[tuple[object, ...]]:
    if schema not in ("main", "original") or not re.fullmatch("[a-z_]+", table):
        raise ValueError("Invalid database identifier")
    return list(connection.execute(f'PRAGMA {schema}.table_xinfo("{table}")'))


def row_digest(row: tuple[object, ...]) -> bytes:
    """Type and length framing preserves exact SQLite values without exposing them."""
    digest = hashlib.sha256()
    for value in row:
        if value is None:
            kind, raw = b"n", b""
        elif isinstance(value, int):
            kind, raw = b"i", str(value).encode("ascii")
        elif isinstance(value, float):
            kind, raw = b"f", struct.pack(">d", value)
        elif isinstance(value, str):
            kind, raw = b"s", value.encode("utf-8")
        elif isinstance(value, bytes):
            kind, raw = b"b", value
        else:
            raise ValueError("Unexpected SQLite storage type")
        digest.update(kind + struct.pack(">Q", len(raw)) + raw)
    return digest.digest()


def table_digest(connection: sqlite3.Connection, schema: str, table: str) -> tuple[int, str]:
    if schema not in ("main", "original") or not re.fullmatch("[a-z_]+", table):
        raise ValueError("Invalid database identifier")
    rows = sorted(row_digest(row) for row in connection.execute(f'SELECT * FROM {schema}."{table}"'))
    return len(rows), hashlib.sha256(b"".join(rows)).hexdigest()


def identity_manifest(database: Path, policy: RetentionPolicy) -> dict[str, tuple[int, str]]:
    """Seal existing retained rows before migrating a private source copy."""
    if database.is_symlink() or not database.is_file():
        raise ValueError("Identity manifest requires a regular database")
    wal = database.with_name(database.name + "-wal")
    if wal.is_symlink() or (wal.exists() and (not wal.is_file() or wal.stat().st_size)):
        raise ValueError("Identity manifest requires a fully checkpointed WAL")
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("Identity source failed integrity_check")
        if list(connection.execute("PRAGMA foreign_key_check")):
            raise ValueError("Identity source failed foreign_key_check")
        present = tables(connection, "main")
        return {table: table_digest(connection, "main", table) for table in policy["retainTables"] if table in present}


def verify_identity_upgrade(
    before: dict[str, tuple[int, str]], upgraded: Path, policy: RetentionPolicy
) -> dict[str, tuple[int, str]]:
    """Migrations must preserve existing identities exactly and create empty new identity tables."""
    after = identity_manifest(upgraded, policy)
    if set(after) != set(policy["retainTables"]) or any(after.get(table) != value for table, value in before.items()):
        raise ValueError("Candidate migration changed retained identity rows or omitted a reviewed table")
    if any(value[0] for table, value in after.items() if table not in before):
        raise ValueError("Candidate migration invented new retained identity rows")
    return after


def retain_identity(original: Path, candidate: Path, policy: RetentionPolicy) -> dict[str, object]:
    """Copy only reviewed identity/moderation rows; original must be a stopped, verified copy."""
    for file in (original, candidate):
        if file.is_symlink() or not file.is_file():
            raise ValueError("Expected an existing independent database file")
    original, candidate = original.resolve(strict=True), candidate.resolve(strict=True)
    if original == candidate or original.samefile(candidate):
        raise ValueError("Original and candidate database are the same file")
    wal = original.with_name(original.name + "-wal")
    if wal.is_symlink() or (wal.exists() and (not wal.is_file() or wal.stat().st_size != 0)):
        raise ValueError("Original database requires a stopped, fully checkpointed WAL")
    data = set(policy["retainTables"]) | set(policy["resetTables"])
    histories = {"flyway_" + module + "_history" for module in policy["migrationModules"]}
    expected = data | histories
    receipt = {}
    with closing(sqlite3.connect(candidate.as_uri() + "?mode=rw", uri=True)) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("ATTACH DATABASE ? AS original", (original.as_uri() + "?mode=ro&immutable=1",))
        connection.execute("BEGIN IMMEDIATE")
        try:
            for schema in ("main", "original"):
                if tables(connection, schema) != expected:
                    raise ValueError("Database tables differ from the reviewed retention policy")
                if connection.execute(f"PRAGMA {schema}.integrity_check").fetchone() != ("ok",):
                    raise ValueError("Database failed integrity_check")
                if list(connection.execute(f"PRAGMA {schema}.foreign_key_check")):
                    raise ValueError("Database failed foreign_key_check")
            for table in data:
                if connection.execute(f'SELECT COUNT(*) FROM main."{table}"').fetchone()[0]:
                    raise ValueError("Identity retention requires a fresh empty candidate database")
            # Staff state mixes IP bans with positions, jails and logout snapshots.
            # Never carry modern coordinates or a spawn override into the historical
            # world without an explicit, separately verified position migration.
            if (
                "essentials_staff_state" in data
                and connection.execute(
                    "SELECT COUNT(*) FROM original.essentials_staff_state WHERE kind <> 'ip-ban'"
                ).fetchone()[0]
            ):
                raise ValueError("World-bound staff state requires an explicit position migration before restoration")
            connection.execute("PRAGMA defer_foreign_keys=ON")
            for table in policy["retainTables"]:
                source = columns(connection, "original", table)
                if not source or source != columns(connection, "main", table):
                    raise ValueError("Retained table schema changed; review a version migration")
                names: list[str] = []
                for column in source:
                    if column[6] != 0:
                        continue
                    name = column[1]
                    if not isinstance(name, str) or not re.fullmatch("[a-z_][a-z_0-9]*", name):
                        raise ValueError("Invalid retained column")
                    names.append(name)
                selected = ",".join('"' + name + '"' for name in names)
                connection.execute(f'INSERT INTO main."{table}" ({selected}) SELECT {selected} FROM original."{table}"')
                before = table_digest(connection, "original", table)
                if before != table_digest(connection, "main", table):
                    raise ValueError("Retained rows changed during import")
                receipt[table] = {"rows": before[0], "sha256": before[1]}
            if list(connection.execute("PRAGMA main.foreign_key_check")):
                raise ValueError("Retained identities violate foreign keys")
            for table in policy["resetTables"]:
                if connection.execute(f'SELECT COUNT(*) FROM main."{table}"').fetchone()[0]:
                    raise ValueError("Gameplay rows survived the reset")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        connection.execute("DETACH DATABASE original")
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return {
        "schemaVersion": 1,
        "retained": receipt,
        "gameplayReset": True,
        "migrationHistoryCopied": False,
        "townImport": "PENDING",
        "privateLiveAcceptance": "PENDING",
    }
