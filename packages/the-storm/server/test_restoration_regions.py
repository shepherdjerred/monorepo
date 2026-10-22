"""Circular pruning uses synthetic Anvil headers, catalogs and stopped server databases."""

import json
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from typing import Any

import restoration_files as storage
import anvil.regions as regions


def region_bytes(indices: list[int]) -> bytes:
    """One single-sector chunk per index, each with a distinct payload and a nonzero timestamp."""
    block = bytearray(8192 + 4096 * len(indices))
    for sector, index in enumerate(indices, start=2):
        struct.pack_into(">I", block, index * 4, (sector << 8) | 1)
        struct.pack_into(">I", block, 4096 + index * 4, 1_450_000_000 + index)
        struct.pack_into(">I", block, sector * 4096, 3)
        block[sector * 4096 + 4 : sector * 4096 + 7] = b"\x02" + struct.pack(">H", index)
    return bytes(block)


class PruneDimensionTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.dimension = self.root / "export/world/dimensions/minecraft/fixture"
        # Radius 400: chunk 0,0 is inside, chunk 31,0 starts at 496 and region 1,0 starts at 512.
        for store in regions.STORES:
            (self.dimension / store).mkdir(parents=True)
        (self.dimension / "region/r.0.0.mca").write_bytes(region_bytes([0, 31]))
        (self.dimension / "region/r.-1.0.mca").write_bytes(region_bytes([31]))
        (self.dimension / "region/r.1.0.mca").write_bytes(region_bytes([0, 5]))
        (self.dimension / "entities/r.0.0.mca").write_bytes(region_bytes([0, 31]))
        (self.dimension / "poi/r.1.0.mca").write_bytes(region_bytes([0]))
        self.owned = self.root / "owned-root"
        catalog = self.owned / "owned/plugins/TheStorm"
        catalog.mkdir(parents=True)
        self.heritage = catalog / "heritage.yml"
        self.site_chunks([[0, 0]])
        (catalog / "parcels.yml").write_text(
            "parcels:\n"
            "  - id: market-shop\n"
            "    name: Market\n"
            "    kind: PERMANENT_SHOP\n"
            "    area:\n"
            "      world: fixture\n"
            "      from: { x: -8, y: -64, z: -8 }\n"
            "      to: { x: 8, y: 319, z: 8 }\n"
            "    owners: []\n"
            "    weeklyRent: 0\n"
        )

    def site_chunks(self, chunks: list[list[int]]) -> None:
        self.heritage.write_text(
            '{\n  "schemaVersion": 2,\n  "sites":\n    [\n      {\n        "id": "fixture-spawn",\n'
            '        "world": "fixture",\n        "protectedChunks": '
            + json.dumps([{"x": x, "z": z} for x, z in chunks])
            + ',\n        "protectedAreas": [],\n      },\n    ],\n}\n'
        )

    def prune(
        self, name: str, *, data: Path | None = None, apply: bool = False, allow_outside_claims: bool = False
    ) -> Any:
        """Return the written receipt, which is the operation's durable evidence."""
        regions.prune_dimension(
            self.dimension,
            "fixture",
            400,
            self.root / name,
            data=data,
            apply=apply,
            allow_outside_claims=allow_outside_claims,
            owned=self.owned,
        )
        return json.loads((self.root / name).read_text())

    def test_dry_run_plans_partial_and_whole_regions_without_writing(self):
        before = storage.files(self.dimension)
        facts = self.prune("dry.json")
        self.assertEqual(facts["status"], "PLANNED")
        self.assertEqual(storage.files(self.dimension), before)
        plan = facts["plan"]
        self.assertEqual(plan["region"]["chunksBefore"], 5)
        self.assertEqual(plan["region"]["chunksRemoved"], 3)
        self.assertEqual(plan["region"]["regions"]["r.0.0.mca"]["removedChunks"], ["31,0"])
        self.assertEqual(plan["region"]["regions"]["r.-1.0.mca"]["removedChunks"], [])
        self.assertTrue(plan["region"]["regions"]["r.1.0.mca"]["deleteFile"])
        self.assertFalse(plan["region"]["regions"]["r.0.0.mca"]["deleteFile"])
        with self.assertRaisesRegex(ValueError, "must be new"):
            self.prune("dry.json")

    def test_apply_clears_outside_headers_deletes_outside_regions_and_keeps_chunk_bytes(self):
        partial = self.dimension / "region/r.0.0.mca"
        untouched = self.dimension / "region/r.-1.0.mca"
        original, kept = partial.read_bytes(), storage.digest(untouched)
        facts = self.prune("applied.json", apply=True)
        self.assertEqual(facts["status"], "VERIFIED")
        updated = partial.read_bytes()
        index = 31
        self.assertEqual(updated[index * 4 : index * 4 + 4], b"\0\0\0\0")
        self.assertEqual(updated[4096 + index * 4 : 4096 + index * 4 + 4], b"\0\0\0\0")
        self.assertEqual(updated[:4], original[:4])
        self.assertEqual(updated[8192:], original[8192:])
        self.assertEqual(storage.digest(untouched), kept)
        self.assertFalse((self.dimension / "region/r.1.0.mca").exists())
        self.assertFalse((self.dimension / "poi/r.1.0.mca").exists())
        result = facts["result"]
        self.assertEqual(
            {store: (value["chunksBefore"], value["chunksAfter"]) for store, value in result.items()},
            {"region": (5, 2), "entities": (2, 1), "poi": (1, 0)},
        )
        self.assertEqual(result["region"]["removedRegionFiles"], ["r.1.0.mca"])
        self.assertEqual(result["region"]["headerSha256"]["r.0.0.mca"], regions.header_digest(partial))
        with partial.open("rb") as source:
            self.assertEqual(set(regions.region_chunks(partial.name, source, partial.stat().st_size)), {"0,0"})
        repeated = self.prune("repeated.json", apply=True)
        self.assertEqual(repeated["result"]["region"]["chunksRemoved"], 0)
        self.assertEqual(repeated["status"], "VERIFIED")

    def test_heritage_chunk_entirely_outside_refuses_apply_unless_explicitly_allowed(self):
        # Chunk 24,0 starts at 384 and still meets the disc; chunk 25,0 starts at 400 and does not.
        self.site_chunks([[24, 0], [25, 0]])
        before = storage.files(self.dimension)
        dry = self.prune("dry.json")
        self.assertEqual(dry["safety"]["heritageChunksOutside"], {"fixture-spawn": [[25, 0]]})
        with self.assertRaisesRegex(ValueError, "entirely outside the disc"):
            self.prune("refused.json", apply=True)
        self.assertEqual(storage.files(self.dimension), before)
        self.assertEqual(self.prune("allowed.json", apply=True, allow_outside_claims=True)["status"], "VERIFIED")

    def server_data(self) -> Path:
        data = self.root / "data"
        dimension = data / "world/dimensions/minecraft/fixture"
        dimension.parent.mkdir(parents=True)
        self.dimension.rename(dimension)
        self.dimension = dimension
        (data / "world/level.dat").write_bytes(b"level")
        (data / "world/session.lock").write_bytes(b"")
        (data / "plugins/TheStorm").mkdir(parents=True)
        (data / "plugins/CoreProtect").mkdir(parents=True)
        with closing(sqlite3.connect(data / "plugins/TheStorm/the-storm.db")) as connection:
            connection.executescript(
                "CREATE TABLE towns_town(id TEXT PRIMARY KEY, name TEXT);"
                "CREATE TABLE towns_claim(world TEXT, chunk_x INT, chunk_z INT, town_id TEXT);"
                "INSERT INTO towns_town VALUES('t','Faraway');"
                "INSERT INTO towns_claim VALUES('fixture',30,0,'t'),('fixture',0,0,'t'),('world',30,0,'t');"
            )
            connection.commit()
        with closing(sqlite3.connect(data / "plugins/CoreProtect/database.db")) as connection:
            connection.executescript(
                "CREATE TABLE co_user(id INT, user TEXT);"
                "CREATE TABLE co_world(id INT, world TEXT);"
                "CREATE TABLE co_block(user INT, wid INT, x INT, z INT, action INT);"
                "INSERT INTO co_user VALUES(1,'Builder'),(2,'#fire');"
                "INSERT INTO co_world VALUES(1,'fixture'),(2,'world');"
                "INSERT INTO co_block VALUES(1,1,600,0,1),(1,1,601,0,1),(1,1,600,0,0),(2,1,600,0,1),"
                "(1,1,10,0,1),(1,2,600,0,1);"
            )
            connection.commit()
        return data

    def test_server_report_lists_outside_claims_and_player_blocks_and_refuses_apply(self):
        data = self.server_data()
        safety = self.prune("dry.json", data=data)["safety"]
        self.assertEqual(
            safety["server"],
            {"townClaims": {"Faraway": [[30, 0]]}, "placedBlocksByPlayer": {"Builder": 2}},
        )
        with self.assertRaisesRegex(ValueError, "entirely outside the disc"):
            self.prune("refused.json", data=data, apply=True)

    def test_held_save_lock_and_linked_inputs_are_refused(self):
        data = self.server_data()
        # Save locks are per process, so a separate writer holds the server's lock.
        worker = (
            "import fcntl,sys\n"
            "with open(sys.argv[1],'r+b') as lock:\n"
            " fcntl.lockf(lock,fcntl.LOCK_EX)\n"
            " print('locked',flush=True)\n"
            " sys.stdin.readline()\n"
        )
        with subprocess.Popen(
            [sys.executable, "-c", worker, str(data / "world/session.lock")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        ) as process:
            if process.stdout is None:
                self.fail("Fixture lock worker has no output pipe")
            self.assertEqual(process.stdout.readline().strip(), "locked")
            with self.assertRaisesRegex(ValueError, "save lock"):
                self.prune("held.json", data=data)
            process.communicate("release\n", timeout=5)
        (self.dimension / "region/r.5.5.mca").symlink_to(self.dimension / "region/r.0.0.mca")
        with self.assertRaisesRegex(ValueError, "Unexpected entry"):
            self.prune("linked.json", data=data)
        with self.assertRaisesRegex(ValueError, "native dimensions"):
            regions.prune_dimension(
                self.dimension / "region",
                "fixture",
                400,
                self.root / "wrong.json",
                data=None,
                apply=False,
                allow_outside_claims=False,
                owned=self.owned,
            )


if __name__ == "__main__":
    unittest.main()
