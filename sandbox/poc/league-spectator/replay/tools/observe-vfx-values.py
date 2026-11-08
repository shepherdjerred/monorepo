"""Probe original VFX curve math using exact-build authored effect fields.

Owned dynamic objects run original constructor/post-load/sample code. Probability
composition uses original scalar evaluation per lane with supplied chances; this
does not establish BIN loading, vector wrapper dispatch or native random draws.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as reg


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "effects", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    definition_bytes = (args.package / "vfx-values.json").read_bytes()
    definition = json.loads(definition_bytes)
    manifest_bytes = (args.effects / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    if (sha(image) != profile["decoderImageSha256"] or sha(definition_bytes) != profile["vfxValuesSha256"]
        or definition["sliceSha256"] != profile["sliceSha256"]
        or manifest["build"] != profile["clientVersion"] or manifest["protocol"] != profile["protocolDigest"]):
        raise ValueError("VFX value package mismatch")
    fields, families = [], {"ValueFloat": "VfxAnimatedFloatVariableData", "ValueColor": "VfxAnimatedColorVariableData"}

    def walk(value, path, effect, digest):
        if isinstance(value, dict):
            family = value.get("__type")
            if family in families and value.get("dynamics", {}).get("__type") == families[family]:
                fields.append({"effect": effect, "definitionSha256": digest, "path": path, "field": value,
                               "width": 1 if family == "ValueFloat" else 4})
            for key, child in value.items():
                walk(child, path + "." + key, effect, digest)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, path + f"[{index}]", effect, digest)

    for effect, entry in sorted(manifest["definitions"].items()):
        data = (args.effects / entry["file"]).read_bytes()
        if sha(data) != entry["sha256"]:
            raise ValueError("VFX definition changed")
        walk(json.loads(data)["definition"], "definition", effect, entry["sha256"])
    # Evenly spaced, deterministic asset-field sample, independent of any replay.
    selected = [fields[i] for i in sorted({int(i * len(fields) / min(512, len(fields)))
                for i in range(min(512, len(fields)))})]
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x100000)
    stop, stack, dynamic, times_at, values_at, table_at, table_times, table_values, chance_at, output = [
        0x10000000 + at for at in [0, 0x10008, 0x20000, 0x30000, 0x40000, 0x50000, 0x60000, 0x70000, 0x80000, 0x90000]]
    initial = engine.context_save()
    f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]
    bits = lambda n: int.from_bytes(struct.pack("<f", n), "little")

    def reject(uc, address, size, user):
        raise ValueError(f"VFX value probe entered modeled service {address-base:x}")

    for patch in profile["modeledServices"]:
        engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + patch["rva"],
            end=base + patch["rva"] + len(bytes.fromhex(patch["bytesHex"])) - 1)
    engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + 0x1490eb0, end=base + 0x1490eb0)

    def call(entry, registers, end=None, time=None):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        for register, value in registers.items():
            engine.reg_write(register, value)
        if time is not None:
            engine.reg_write(reg.UC_X86_REG_XMM0, bits(time))
        expected = base + end if end is not None else stop
        engine.emu_start(base + entry, expected, count=100000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != expected:
            raise ValueError("VFX value instruction limit")

    def put_array(at, values):
        if len(values) > 4096:
            raise ValueError("VFX probe array limit")
        engine.mem_write(at, struct.pack("<" + "f" * len(values), *values) if values else bytes(4))

    def prepare(kind, times, values, table=None):
        engine.mem_write(dynamic, b"\xa5" * 0x100)
        meta = definition[kind]
        call(meta["constructorBlock"][0], {reg.UC_X86_REG_RAX: dynamic}, end=meta["constructorBlock"][1])
        put_array(times_at, times)
        flat = values if kind == "float" else [n for value in values for n in value]
        put_array(values_at, flat)
        time_offset, value_offset = (0x10, 0x20) if kind == "float" else (0x28, 0x38)
        engine.mem_write(dynamic + time_offset, struct.pack("<QI", times_at, len(times)))
        engine.mem_write(dynamic + value_offset, struct.pack("<QI", values_at, len(values)))
        if table is not None:
            meta_table = definition["probability"]
            call(meta_table["constructorBlock"][0], {reg.UC_X86_REG_RAX: table_at}, end=meta_table["constructorBlock"][1])
            tt, tv = table.get("keyTimes", []), table.get("keyValues", [])
            if len(tt) != len(tv):
                raise ValueError("Mismatched authored VFX probability lists")
            put_array(table_times, tt)
            put_array(table_values, tv)
            engine.mem_write(table_at, struct.pack("<QI", table_times, len(tt)))
            engine.mem_write(table_at + 0x10, struct.pack("<QI", table_values, len(tv)))
            engine.mem_write(table_at + 0x20, struct.pack("<f", table.get("singleValue", 1)))
            call(meta_table["postLoadRva"], {reg.UC_X86_REG_RDI: table_at})
            engine.mem_write(dynamic + 8, struct.pack("<Q", table_at))
        call(meta["postLoadRva"], {reg.UC_X86_REG_RDI: dynamic})

    cases = []
    for item in selected:
        field, width = item["field"], item["width"]
        curve = field["dynamics"]
        times, values = curve.get("times", []), curve.get("values", [])
        if len(times) != len(values) or any(times[i] < times[i-1] for i in range(1, len(times))):
            raise ValueError("Mismatched/unordered authored VFX curve")
        probes = sorted({f(n) for n in [-0.125, 0, .05, .25, .5, .75, 1, 1.125, *times]})
        tables = curve.get("probabilityTables", [])
        for time in probes:
            prepare("float" if width == 1 else "color", times, values)
            call(definition["float" if width == 1 else "color"]["sampleRva"],
                {reg.UC_X86_REG_RDI: dynamic, reg.UC_X86_REG_RSI: output, reg.UC_X86_REG_RDX: output}, time=time)
            base_bits = list(struct.unpack("<" + "I" * width, bytes(engine.mem_read(output, width * 4))))
            sample = {**item, "time": time, "baseBits": base_bits, "chanceCases": []}
            for chance in [0.0, 0.25, 1.0]:
                lane_bits = []
                for lane in range(width):
                    lane_values = values if width == 1 else [value[lane] for value in values]
                    table = tables[lane] if lane < len(tables) else None
                    prepare("float", times, lane_values, table)
                    engine.mem_write(chance_at, struct.pack("<f", chance))
                    call(definition["float"]["sampleRva"], {reg.UC_X86_REG_RDI: dynamic,
                        reg.UC_X86_REG_RSI: output, reg.UC_X86_REG_RDX: chance_at}, time=time)
                    lane_bits.append(struct.unpack("<I", bytes(engine.mem_read(output, 4)))[0])
                sample["chanceCases"].append({"chances": [chance] * width, "bits": lane_bits})
            cases.append(sample)
    result = {"schema": 1, "build": manifest["build"], "protocol": manifest["protocol"],
        "decoderImageSha256": profile["decoderImageSha256"], "definitionSha256": sha(definition_bytes),
        "effectsManifestSha256": sha(manifest_bytes), "availableFields": len(fields), "sampledFields": len(selected),
        "cases": cases, "scope": "Original unbaked float/color curve sampling and scalar probability composition per lane on owned authored-field objects. No actual BIN loader, vector2/3 wrapper dispatch, baked/integrated evaluation, RNG, emission or rendered A/V validation"}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"availableFields": len(fields), "sampledFields": len(selected), "cases": len(cases)}))


if __name__ == "__main__":
    main()
