"""Execute original IMAA data readers over bounded owned archived-byte streams."""
import argparse
import hashlib
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from ui_manager_native import NativeUiManager
from navgrid_world_native import NativeNavgridStream
from vfx_spawn_native import ADDRESSES

class NativeImageAtlas(NativeNavgridStream, NativeUiManager):
    def u32(self, address):
        return struct.unpack("<I", self.u.mem_read(address, 4))[0]

    def call_backward_boundary(self, entry, regs, end):
        if not end < entry: raise ValueError("Expected an original backward branch boundary")
        self.u.context_restore(self.initial)
        self.put(ADDRESSES["stack"], "Q", ADDRESSES["stop"])
        self.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES["stack"])
        for register, value in regs.items(): self.u.reg_write(register, value)
        self.u.ctl_remove_cache(self.base + end, self.base + entry)
        self.u.emu_start(self.base + entry, self.base + end, count=5000000)
        if self.u.reg_read(r.UC_X86_REG_RIP) != self.base + end:
            raise ValueError("Original image lookup did not reach its missing-key branch")

    def writable_file_memory(self, address, count):
        return (0x10000000 <= address <= 0x10400000 - count or
                any(start <= address <= start + size - count for start, size in self.allocations.items()))

parser = argparse.ArgumentParser(description=__doc__)
for name in ["assets", "client", "links", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
link_bytes = args.links.read_bytes()
links, observations = json.loads(link_bytes), []
for reference in links["results"]:
    for location in reference["locations"]:
        if location["magic"] != "IMAA": continue
        raw = (args.links.parent / location["filename"]).read_bytes()
        if raw[:4] != b"IMAA" or hashlib.sha256(raw).hexdigest() != location["sha256"] or len(raw) != location["bytes"]: raise ValueError("Original IMAA WAD source changed")
        n = NativeImageAtlas(args.assets / "decoder-16.21-macos", args.client)
        n.initialize_layout_constants()
        stream = n.open_navgrid_stream(raw)
        n.navgrid_stream["position"] = 4
        frame = 0x10030000
        observation = {"reference": reference["value"], "source": location, "boundary": None}
        try:
            # Original output allocation/default stores, before its source read.
            n.call(0x17e5c3f, {r.UC_X86_REG_RBP: frame}, 0x17e5c62)
            output = n.q(frame - 0x20)
            if n.allocations.get(output) != 0x28: raise ValueError("Original IMAA output allocation changed")
            n.call(0x17ea3a0, {r.UC_X86_REG_RDI: stream, r.UC_X86_REG_RSI: output})
            if n.u.reg_read(r.UC_X86_REG_AL) != 1: raise ValueError("Original IMAA header reader rejected the archived source")
            n.call(0x17ea560, {r.UC_X86_REG_RDI: stream, r.UC_X86_REG_RSI: output + 0x10})
            if n.u.reg_read(r.UC_X86_REG_AL) != 1 or n.navgrid_stream["position"] != len(raw): raise ValueError("Original IMAA body reader did not consume its entire source")
            header_at, header_count = n.q(output), n.u32(output + 8)
            rows_at, row_count = n.q(output + 0x10), n.u32(output + 0x18)
            if not 0 < header_count <= 1024 or n.allocations.get(header_at) != header_count * 8 or not 0 < row_count <= 65536 or n.allocations.get(rows_at) != row_count * 32:
                raise ValueError("Original IMAA parsed vectors exceed their exact owned allocations")
            header_words = [str(n.q(header_at + index * 8)) for index in range(header_count)]
            image_records = []
            for index in range(row_count):
                record = rows_at + index * 32
                header_index = n.u32(record + 24)
                if header_index >= header_count: raise ValueError("Original IMAA record index exceeds its loaded header vector")
                image_records.append({"key64": str(n.q(record)), "valuesF32": list(struct.unpack("<4f", n.u.mem_read(record + 8, 16))),
                    "index32": header_index, "indexedHeaderWord64": header_words[header_index]})
            # The original image resolver's atlas branch performs its own lower
            # bound and indexed header lookup over these original reader vectors.
            # Stop before the external texture-cache loader, then execute the
            # original constructor's unchanged four-component UV copy separately.
            lookups = []
            for index, row in enumerate(image_records):
                node, key_at, image_at = 0x10001000, 0x10002000, 0x10003000
                n.put(node + 0x18, "Q", output)
                n.put(key_at, "Q", int(row["key64"]))
                n.call(0x17e546b, {r.UC_X86_REG_R15: node, r.UC_X86_REG_R14: key_at}, 0x17e54d9)
                selected_row = n.u.reg_read(r.UC_X86_REG_R8)
                selected_header = n.u.reg_read(r.UC_X86_REG_RDX)
                if selected_row != rows_at + index * 32 or n.q(selected_header) != int(row["indexedHeaderWord64"]):
                    raise ValueError("Original image resolver selected different archived row/header bytes")
                n.put(frame - 0x50, "Q", selected_row + 8)
                n.call(0x17e39ba, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_RBX: image_at}, 0x17e39c5)
                uv_bytes = bytes(n.u.mem_read(image_at + 0x30, 16))
                if uv_bytes != bytes(n.u.mem_read(selected_row + 8, 16)):
                    raise ValueError("Original image constructor changed the selected four-component UV bytes")
                lookups.append({"key64": row["key64"], "header64": str(n.q(selected_header)),
                    "rowIndex": index, "uvHex": uv_bytes.hex(), "uvValuesF32": list(struct.unpack("<4f", uv_bytes))})
            missing_key = next(key for key in range(row_count + 1) if str(key) not in {row["key64"] for row in image_records})
            n.put(key_at, "Q", missing_key)
            n.call_backward_boundary(0x17e546b, {r.UC_X86_REG_R15: node, r.UC_X86_REG_R14: key_at}, 0x17e5450)
            observation.update(outputHex=bytes(n.u.mem_read(output, 0x28)).hex(), headerWords64=header_words, imageRecords=image_records,
                originalImageLookups=lookups, missingKeyRejectedByAtlasBranch=str(missing_key),
                allocations=[{"address": start, "bytes": size, "hex": bytes(n.u.mem_read(start, size)).hex()} for start, size in n.allocations.items() if size <= 4096])
        except Exception as error:
            observation["boundary"] = {"kind": type(error).__name__, "message": str(error), "instructionRva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
        observation.update(stream={key: value for key, value in n.navgrid_stream.items() if key != "bytes"},
            originalBlocks=list(n.blocks.values()), imageSha256=hashlib.sha256(n.image).hexdigest())
        observations.append(observation)
paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in NativeImageAtlas.__mro__ if cls is not object]}
report = {"schema": 1, "kind": "original-archived-image-atlas-reader-observations", "linksSha256": hashlib.sha256(link_bytes).hexdigest(),
    "observations": observations, "sources": {str(file.resolve()): hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(paths)},
    "scope": "Original IMAA readers, original atlas-branch lower-bound/indexed-header lookup and original unchanged four-component UV constructor copy; external texture-cache ownership, full UV composition, controllers and rendered HUD remain separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "atlases": [{"source": item["source"]["sha256"], "cursor": item["stream"]["position"], "boundary": item["boundary"]} for item in observations]}))
if any(item["boundary"] for item in observations): raise SystemExit(1)
