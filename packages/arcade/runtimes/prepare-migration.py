"""Copy legacy saves and a consistent SQLite backup into a new Arcade directory."""

import argparse
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path


def checksum(file: Path) -> str:
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def copy_saves(source: Path, destination: Path) -> dict[str, str]:
    files = {}
    for file in source.rglob("*"):
        if file.is_symlink():
            raise ValueError(f"Resolve save symlink before migration: {file}")
        if file.is_file():
            files[file.relative_to(source).as_posix()] = checksum(file)
    shutil.copytree(source, destination)
    for name, digest in files.items():
        if checksum(destination / name) != digest:
            raise ValueError(f"Save copy verification failed: {name}")
    return files


def prepare(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    repository = Path(__file__).resolve().parents[3]
    if output == repository or repository in output.parents:
        raise ValueError("Migration output must be outside the repository")
    if output.exists():
        raise ValueError("Choose a new directory; never overwrite a migration or rollback copy")
    output.mkdir(parents=True)
    saves = output / "saves"
    saves.mkdir()
    manifest: dict[str, dict[str, str] | str] = {
        "mk64": copy_saves(args.mk64_saves.resolve(strict=True), saves / "mk64"),
        "emerald": copy_saves(args.emerald_saves.resolve(strict=True), saves / "emerald"),
    }
    database = output / "db/arcade.db"
    database.parent.mkdir()
    source = args.database.resolve(strict=True)
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original, sqlite3.connect(database) as copied:
        original.backup(copied)
        if copied.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("Copied database failed integrity checking")
        for table in ("Race", "RaceResult", "Player", "WebSession"):
            query = f'SELECT COUNT(*) FROM "{table}"'
            if original.execute(query).fetchone() != copied.execute(query).fetchone():
                raise ValueError(f"Database count changed during copy: {table}")
    manifest["databaseSha256"] = checksum(database)
    (output / "migration.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Verified migration copy in {output}; originals remain untouched")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mk64-saves", type=Path, required=True)
    parser.add_argument("--emerald-saves", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    prepare(parser.parse_args())
