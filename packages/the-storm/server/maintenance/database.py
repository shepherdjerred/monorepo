"""Relocate saved destinations without rewriting items, claims or progression."""

import hashlib
import math
import sqlite3
from collections.abc import Mapping, Sequence
from contextlib import closing
from pathlib import Path

from restoration_json import JsonObject

RETIRED = frozenset(("wilds", "peaks", "minecraft:wilds", "minecraft:peaks"))
LOCATIONS = frozenset(
    (
        "essentials_homes",
        "essentials_back_history",
        "essentials_warps",
        "arena_snapshots",
        "rwf_snapshots",
        "creative_bodies",
        "spells_mark",
        "qol_grave",
        "qol_graves",
        "qol_grave_drops",
    )
)
Row = tuple[object, ...]


def border_radii(borders: Sequence[Mapping[str, object]]) -> dict[str, float]:
    radii = {}
    for raw in borders:
        border = JsonObject.require(dict(raw))
        world = border.string("world")
        radius = number(border["size"]) / 2
        if (
            world in radii
            or not math.isfinite(radius)
            or not 0 < radius <= 29_999_984
            or border.get("centerX") != 0
            or border.get("centerZ") != 0
            or border.get("shape") != "circle"
        ):
            raise ValueError("World retirement requires unique circles centered at 0,0")
        radii[world] = radius
    if set(radii) != {"world", "map2", "frontier", "skylands", "world_nether", "world_the_end", "creative"}:
        raise ValueError("World retirement border selection is incomplete")
    return radii


def world_name(world: str) -> str:
    if not world.startswith("minecraft:"):
        return world
    name = world.removeprefix("minecraft:")
    return {"overworld": "world", "the_nether": "world_nether", "the_end": "world_the_end"}.get(name, name)


def outside(world: str, x: float, z: float, radii: Mapping[str, float]) -> bool:
    if not math.isfinite(x) or not math.isfinite(z):
        raise ValueError("Saved location is not finite")
    world = world_name(world)
    return world in RETIRED or (world in radii and math.hypot(x, z) > radii[world])


def fingerprint(snapshot: Mapping[str, object]) -> str:
    return hashlib.sha256(repr(snapshot).encode()).hexdigest()


def fingerprints(
    connection: sqlite3.Connection,
    replacements: Mapping[tuple[str, Row], Row] | None = None,
    additions: Mapping[str, list[Row]] | None = None,
) -> dict[str, str]:
    """Hash one row at a time; retain no unrelated items, chat bodies or progression rows."""
    result = {}
    for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        if '"' in name:
            raise ValueError("Unexpected database identifier")
        primary = sorted((row[5], row[1]) for row in connection.execute(f'PRAGMA table_info("{name}")') if row[5])
        if any('"' in column for _, column in primary):
            raise ValueError("Unexpected primary key identifier")
        order = ",".join(f'"{column}"' for _, column in primary) if primary else "rowid"
        digest = hashlib.sha256()
        for row in connection.execute(f'SELECT * FROM "{name}" ORDER BY {order}'):
            encoded = repr((replacements or {}).get((name, row), row)).encode()
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
        for row in (additions or {}).get(name, []):
            encoded = repr(row).encode()
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
        result[name] = digest.hexdigest()
    return result


def number(value: object) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError("Saved location must be numeric")
    return float(value)


def prepare(
    source: Path,
    destination: Path,
    grave_sites: Sequence[Mapping[str, object]],
    now: int,
    radii: Mapping[str, float],
) -> dict[str, object]:
    """Copy SQLite through its backup API, then update only explicit location fields."""
    if source.is_symlink() or not source.is_file() or destination.exists() or destination.is_symlink():
        raise ValueError("Database preparation needs a regular source and a new destination")
    with closing(sqlite3.connect(f"file:{source}?mode=ro", uri=True)) as original:
        before = fingerprints(original)
        with closing(sqlite3.connect(destination)) as connection:
            original.backup(connection)
            connection.execute("PRAGMA foreign_keys=ON")
            columns = {name: [row[1] for row in connection.execute(f'PRAGMA table_info("{name}")')] for name in before}
            plans = {}
            graves = []
            for name, names in columns.items():
                if "world" not in names:
                    continue
                if name not in LOCATIONS:
                    if any(row[names.index("world")] in RETIRED for row in original.execute(f'SELECT * FROM "{name}"')):
                        raise ValueError("Unreviewed retired-world reference in " + name)
                    continue
                for row in original.execute(f'SELECT * FROM "{name}"'):
                    value = JsonObject(dict(zip(names, row, strict=True)))
                    if not outside(value.string("world"), number(value["x"]), number(value["z"]), radii):
                        continue
                    if name == "qol_grave_drops":
                        raise ValueError("Resolve pending drops in retired or inaccessible worlds before maintenance")
                    if name in ("qol_grave", "qol_graves"):
                        graves.append((name, value))
                    else:
                        creative = world_name(value.string("world")) == "creative"
                        target_world = "creative" if creative else "world"
                        if name == "spells_mark" or value.string("world").startswith("minecraft:"):
                            target_world = "minecraft:creative" if creative else "minecraft:overworld"
                        plans[(name, row)] = {
                            "world": target_world,
                            "x": -1.0 if creative else 68.5,
                            "y": 65.0 if creative else 69.0,
                            "z": -1.0 if creative else 66.5,
                            **{key: 0.0 for key in ("yaw", "pitch") if key in names},
                        }
            if len(grave_sites) != len(graves):
                raise ValueError("Every inaccessible grave requires one independently verified recovery site")
            occupied = {
                (
                    dict(zip(columns[name], row, strict=True))["world"],
                    dict(zip(columns[name], row, strict=True))["x"],
                    dict(zip(columns[name], row, strict=True))["y"],
                    dict(zip(columns[name], row, strict=True))["z"],
                )
                for name in ("qol_grave", "qol_graves")
                for row in original.execute(f'SELECT * FROM "{name}"')
            }
            notices = []
            for (name, value), raw_site in zip(graves, grave_sites, strict=True):
                site = JsonObject.require(dict(raw_site))
                if (
                    set(site) != {"world", "x", "y", "z"}
                    or site["world"] != "world"
                    or any(type(site[key]) is not int for key in ("x", "y", "z"))
                    or outside(site.string("world"), site.integer("x"), site.integer("z"), radii)
                    or not -60 <= site.integer("y") < 319
                ):
                    raise ValueError("Grave recovery sites must be integer columns inside the main world")
                location = (site["world"], site["x"], site["y"], site["z"])
                if location in occupied:
                    raise ValueError("Grave recovery site collides with another grave")
                occupied.add(location)
                row = tuple(value[key] for key in columns[name])
                plans[(name, row)] = {
                    **site,
                    **({"replaced_block": "minecraft:air", "created_at": now} if name == "qol_graves" else {}),
                }
                notices.append(
                    (
                        value["owner"],
                        f"Your grave was moved from {value['world']} to world "
                        f"{site['x']}, {site['y']}, {site['z']} during world maintenance. "
                        "Its protection and expiration restarted. /graves lists it.",
                        now,
                    )
                )
            replacements: dict[tuple[str, Row], Row] = {}
            additions: dict[str, list[Row]] = {}
            for (name, row), changes in plans.items():
                names = columns[name]
                # Match the complete original row, including byte-for-byte item snapshots.
                assignments = ", ".join(f'"{key}"=?' for key in changes)
                predicate = " AND ".join(f'"{key}" IS ?' for key in names)
                cursor = connection.execute(
                    f'UPDATE "{name}" SET {assignments} WHERE {predicate}', (*changes.values(), *row)
                )
                if cursor.rowcount != 1:
                    raise ValueError("Saved destination is not uniquely identified")
                revised = tuple(changes.get(key, row[index]) for index, key in enumerate(names))
                replacements[name, row] = revised
            for notice in notices:
                cursor = connection.execute("INSERT INTO qol_notices(player,message,created_at) VALUES(?,?,?)", notice)
                additions.setdefault("qol_notices", []).append((cursor.lastrowid, *notice))
            if "sqlite_sequence" in before:
                # Only the explicitly inserted notices may advance their sequence.
                prior = original.execute("SELECT * FROM sqlite_sequence WHERE name='qol_notices'").fetchone()
                updated = connection.execute("SELECT * FROM sqlite_sequence WHERE name='qol_notices'").fetchone()
                if prior is not None:
                    replacements["sqlite_sequence", prior] = updated
                elif updated is not None:
                    additions["sqlite_sequence"] = [updated]
            expected = fingerprints(original, replacements, additions)
            after = fingerprints(connection)
            if (
                after != expected
                or connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]
                or connection.execute("PRAGMA foreign_key_check").fetchall()
            ):
                raise ValueError("Database maintenance changed data outside the approved destinations and notices")
            connection.commit()
        if fingerprints(original) != before:
            raise ValueError("Source database changed during preparation")
    return {
        "destinationsRelocated": len(plans),
        "gravesRelocated": len(graves),
        "before": fingerprint(before),
        "after": fingerprint(after),
        "itemsAndProgression": "UNCHANGED",
    }
