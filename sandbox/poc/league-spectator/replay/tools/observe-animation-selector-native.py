"""Load exact original selector graph fields and inspect original preparation/runtime ownership."""
import argparse
import inspect
import json
import struct
from pathlib import Path
import capstone
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from libcpp_shared_native import NativeLibcppSharedOwnership
from vfx_spawn_native import sha, name_hash, ADDRESSES

class NativeSelector(NativeLibcppSharedOwnership, NativeCharacterAssets):
    seed_clock = None
    seed_clock_reads = 0
    owned_tls_destructors = None
    def reject(self, uc, address, size, user):
        name = self.source.imports.get(address - self.base)
        if self.seed_clock is not None and name in ["_mach_absolute_time", "__tlv_atexit"]: return
        return super().reject(uc, address, size, user)
    def imported(self, uc, address, size, user):
        name = self.source.imports[address - self.base]
        if self.seed_clock is not None and name == "_mach_absolute_time":
            self.seed_clock_reads += 1
            uc.reg_write(r.UC_X86_REG_RAX, self.seed_clock)
            self.ret()
            return
        if self.seed_clock is not None and name == "__tlv_atexit":
            callback, value, image = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX]]
            if not self.base <= callback < self.base + len(self.image) or value != ADDRESSES["stream"] or image != self.base:
                raise ValueError("Selector TLS destructor registration escaped its owned stream/image")
            self.owned_tls_destructors.append({"callbackRva": callback - self.base, "ownedStream": value, "image": image})
            uc.reg_write(r.UC_X86_REG_RAX, 0)
            self.ret()
            return
        return super().imported(uc, address, size, user)

parser = argparse.ArgumentParser(description=__doc__)
for name in ["cache", "client", "input", "output"]: parser.add_argument(name, type=Path)
args = parser.parse_args()
encoded = args.input.read_bytes()
request = json.loads(encoded)
source = Path(request["source"]["file"]).read_bytes()
root = Path(__file__).resolve().parent
if (request["kind"] != "original-animation-selector-input" or request["build"] != "16.21.829.8620" or request["protocol"] != "20e09df23c66b85e" or
    sha(source) != request["source"]["sha256"] or len(source) != request["source"]["bytes"] or
    request["readerSha256"] != sha((root / "exact-map-bin.mjs").read_bytes()) or request["preparerSha256"] != sha((root / "prepare-animation-selector-input.mjs").read_bytes())):
    raise ValueError("Exact original selector graph field input required")
n = NativeSelector(args.cache / "public/decoder-16.21-macos", args.client)
n.call(0x14aa3bf, {}, 0x14aa5f9)
n.initialize_character_types()
fields = []
for span in request["fields"]:
    start, size = span["offset"], span["bytes"]
    if start < 0 or size < 5 or start + size > len(source): raise ValueError("Original selector graph field escaped its source")
    raw = source[start:start + size]
    if sha(raw) != span["sha256"]: raise ValueError("Original selector field digest changed")
    fields.append(raw)
loaded = n.observe_actor_fields(name_hash("AnimationGraphData"), fields)
if loaded["originalSkippedFields"] or loaded["pendingReferences"]: raise ValueError("Original selector graph fields not completely loaded")
graph = loaded["object"]
n.call(0x15afe30, {r.UC_X86_REG_RDI: graph}, 0x15afffc)
count, rows_at = n.u32(graph + 0x10), n.q(graph + 8)
if not 0 < count <= 10000 or not n.library_pointer(rows_at, count * 16): raise ValueError("Original graph clip map escaped its bounds")
rows = [{"index": index, "key": n.u32(rows_at + index * 16), "object": n.q(rows_at + index * 16 + 8)} for index in range(count)]
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
def instructions(entry, length=1024):
    result = []
    for item in decoder.disasm(n.image[entry:entry + length], entry):
        result.append({"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str})
        if item.mnemonic == "ret": break
    return result
cases, boundary, active = [], None, None
try:
    for row in rows:
        data = row["object"]
        table = n.q(data)
        n.call(n.q(table + 0x10) - n.base, {r.UC_X86_REG_RDI: data})
        if n.u32(n.u.reg_read(r.UC_X86_REG_RAX) + 8) != name_hash("SelectorClipData"): continue
        active = {"index": row["index"], "key": row["key"]}
        n.call(n.q(table + 0x28) - n.base, {r.UC_X86_REG_RDI: data, r.UC_X86_REG_RSI: graph, r.UC_X86_REG_RDX: row["key"], r.UC_X86_REG_RCX: row["index"]})
        pair_at, pair_count = n.q(data + 0x38), n.u32(data + 0x40)
        if not 0 < pair_count <= 1024 or not n.library_pointer(pair_at, pair_count * 12): raise ValueError("Original prepared selector pairs escaped owned bounds")
        prepared_pairs = [{"key": n.u32(pair_at + index * 12), "probability": struct.unpack("<f", n.u.mem_read(pair_at + index * 12 + 4, 4))[0],
            "clipIndex": n.u32(pair_at + index * 12 + 8)} for index in range(pair_count)]
        context, out = n.allocate(256), n.allocate(16)
        n.call(n.q(table + 0x38) - n.base, {r.UC_X86_REG_RDI: out, r.UC_X86_REG_RSI: data, r.UC_X86_REG_RDX: context})
        runtime = n.q(out)
        if runtime not in n.allocations: raise ValueError("Original selector runtime allocation escaped ownership")
        size, runtime_table = n.allocations[runtime], n.q(runtime)
        methods = []
        for slot in range(16):
            entry = n.q(runtime_table + slot * 8) - n.base
            if not 0 <= entry < len(n.image) - 1024: continue
            methods.append({"slot": slot, "rva": entry, "instructions": instructions(entry)})
        cases.append({**active, "data": data, "preparedDataPrefixHex": bytes(n.u.mem_read(data, 0x70)).hex(), "runtime": runtime,
            "runtimeBytes": size, "initializedRuntimeHex": bytes(n.u.mem_read(runtime, size)).hex(), "runtimeVtableRva": runtime_table - n.base, "methods": methods, "preparedPairs": prepared_pairs})
        samples = []
        n.owned_tls_destructors = []
        for host_tick in [0, 1, 7, 0x123456789abcdef0, 0xffffffffffffffff]:
            n.seed_clock = host_tick
            n.call(0x665bf4, {}, 0x665c01)
            actual_seed = n.q(n.base + 0x2516698)
            if actual_seed != max(1, host_tick): raise ValueError("Original selector startup seed conversion changed")
            for draw in range(8):
                n.call(0x1591bd1, {r.UC_X86_REG_RBX: runtime, r.UC_X86_REG_RBP: 0x10040000}, 0x1591cba)
                selected = n.u.reg_read(r.UC_X86_REG_ESI)
                if selected >= len(rows): raise ValueError("Original selector selected an unresolved graph index")
                samples.append({"suppliedHostClockTicks": str(host_tick), "originalSeed": str(actual_seed), "draw": draw,
                    "selectedIndex": selected, "selectedKey": rows[selected]["key"],
                    "originalStreamHex": bytes(n.u.mem_read(ADDRESSES["stream"], 0x18)).hex()})
        cases[-1]["weightedSelectionSamples"] = samples
        cases[-1]["seedClockReads"] = n.seed_clock_reads
        cases[-1]["ownedTlsDestructorRegistrations"] = n.owned_tls_destructors
except Exception as error:
    boundary = {"kind": type(error).__name__, "message": str(error), "active": active, "instructionRva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
random_entry_instructions = [{"rva": item.address, "bytes": item.bytes.hex(), "op": item.mnemonic, "args": item.op_str}
    for item in decoder.disasm(n.image[0x1490eb0:0x14912b0], 0x1490eb0)]
report = {"schema": 1, "kind": "original-animation-selector-runtime-inventory", "build": request["build"], "protocol": request["protocol"],
    "imageSha256": sha(n.image), "inputSha256": sha(encoded), "sourceBinSha256": sha(source), "loaded": loaded, "rows": rows, "cases": cases, "boundary": boundary,
    "originalMathInitialization": {"startRva": 0x14aa3bf, "endRva": 0x14aa5f9, "sha256": sha(n.image[0x14aa3bf:0x14aa5f9])},
    "randomEntryInstructions": random_entry_instructions,
    "originalBlocks": list(n.blocks.values()), "sources": {str(file.resolve()): sha(file.read_bytes()) for file in sorted(paths)},
    "scope": "Original field reader, clip-index preparation and selector runtime allocation; live RNG owner, activation, chosen child and rendered pose are separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "cases": len(cases), "runtimeBytes": [item["runtimeBytes"] for item in cases], "boundary": boundary}))
if boundary: raise SystemExit(1)
