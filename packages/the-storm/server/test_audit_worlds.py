import io
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from audit_worlds import NbtReader, chunks, entities


class WorldAuditTest(unittest.TestCase):
    def test_all_sign_dialects_and_exact_inventory_data_survive_the_census(self):
        signs = [{"id": "minecraft:sign", "front_text": {"messages": [tag]}} for tag in
                 ("[Buy]", "[MondoChest]", "[MondoSlave]", "[MC1111]S", "[Lift Up]")]
        chest = {"id": "minecraft:chest", "Items": [{"id": "minecraft:diamond", "count": 24}]}
        expected = [*signs, chest]
        self.assertEqual(list(entities({"block_entities": expected})), expected)

    def test_anvil_zlib_chunk_uses_the_allocated_sector(self):
        nbt = b"\x0a\x00\x00\x03\x00\x04xPos" + struct.pack(">i", -32) + b"\x00"
        compressed = zlib.compress(nbt)
        region = bytearray(12288)
        struct.pack_into(">I", region, 0, (2 << 8) | 1)
        struct.pack_into(">IB", region, 8192, len(compressed) + 1, 2)
        region[8197:8197 + len(compressed)] = compressed
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "r.-1.0.mca"
            path.write_bytes(region)
            self.assertEqual(list(chunks(path)), [{"xPos": -32}])

    def test_corrupt_lengths_and_duplicate_keys_fail_instead_of_omitting_data(self):
        with self.assertRaisesRegex(ValueError, "truncated"):
            NbtReader(io.BytesIO(b"\x0a\x00\x00\x08\x00\x01x\x00\x05a")).root()
        duplicate = b"\x0a\x00\x00" + 2 * (b"\x01\x00\x01x\x01") + b"\x00"
        with self.assertRaisesRegex(ValueError, "duplicate"):
            NbtReader(io.BytesIO(duplicate)).root()


if __name__ == "__main__":
    unittest.main()
