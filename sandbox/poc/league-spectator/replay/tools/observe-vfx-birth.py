"""Run native RNG with owned TLS and native point-shape callbacks.

The whole seed/next-float functions and original RNG vtable execute. TLS address
resolution maps three descriptors to owned storage; the thread's RNG object is
already initialized. No original match seed or thread scheduling is supplied.
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
    package_bytes = (args.package / "vfx-birth.json").read_bytes()
    package = json.loads(package_bytes)
    value_bytes = (args.package / "vfx-values.json").read_bytes()
    value_package = json.loads(value_bytes)
    manifest_bytes = (args.effects / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    if (sha(image) != profile["decoderImageSha256"] or sha(package_bytes) != profile["vfxBirthSha256"]
        or package["decoderImageSha256"] != sha(image) or package["build"] != manifest["build"]
        or package["protocol"] != manifest["protocol"] or sha(value_bytes) != profile["vfxValuesSha256"]
        or package["vfxValuesSha256"] != sha(value_bytes)):
        raise ValueError("VFX birth package mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    owned = 0x10000000
    engine.mem_map(owned, 0x100000)
    stop, stack, tls_stub, stream, seed_ready, object_ready, shape_at, output = [
        owned + at for at in [0, 0x10008, 0x20000, 0x21000, 0x22000, 0x23000, 0x24000, 0x25000]]
    meta = package["random"]
    slots = {base + meta["tls"][name]: address for name, address in
             [("stream", stream), ("seedReady", seed_ready), ("objectReady", object_ready)]}
    for descriptor in slots:
        engine.mem_write(descriptor, struct.pack("<Q", tls_stub))
    engine.mem_write(tls_stub, b"\xc3")
    engine.mem_write(stream, struct.pack("<QQIB", base + meta["vtableRva"], 1, 0, 0))
    engine.mem_write(object_ready, b"\1")
    initial = engine.context_save()
    tls_calls = 0

    def tls(uc, address, size, user):
        nonlocal tls_calls
        descriptor = uc.reg_read(reg.UC_X86_REG_RDI)
        if descriptor not in slots:
            raise ValueError("Unknown native TLS descriptor")
        uc.reg_write(reg.UC_X86_REG_RAX, slots[descriptor])
        tls_calls += 1

    def reject(uc, address, size, user):
        raise ValueError(f"VFX birth entered unadmitted service {address-base:x}")

    engine.hook_add(unicorn.UC_HOOK_CODE, tls, begin=tls_stub, end=tls_stub)
    for patch in profile["modeledServices"]:
        engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + patch["rva"],
                        end=base + patch["rva"] + len(bytes.fromhex(patch["bytesHex"])) - 1)

    def call(entry, registers=None, end=None):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        for register, value in (registers or {}).items():
            engine.reg_write(register, value)
        expected = base + end if end is not None else stop
        if end is not None:
            # The conversion fragment was previously translated inside the
            # whole RNG function. Split cached blocks at this probe boundary.
            engine.ctl_remove_cache(base + entry, expected)
        engine.emu_start(base + entry, expected, count=100000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != expected:
            raise ValueError("VFX birth instruction limit")

    def random_state():
        state, draws = struct.unpack("<QI", bytes(engine.mem_read(stream + 8, 12)))
        return {"stateHex": f"{state:016x}", "draws": draws}

    seeds = [0, 1, 2, 0xffffffffffffffff, 0x8000000000000000, 0xdeadbeef, 0x123456789abcdef0]
    generated = 0x10980265
    for _ in range(17):
        generated = (generated * 6364136223846793005 + 1442695040888963407) & 0xffffffffffffffff
        seeds.append(generated)
    sequences = []
    for index, seed in enumerate(seeds):
        call(meta["seedRva"], {reg.UC_X86_REG_RDI: seed})
        normalized_seed = struct.unpack("<Q", bytes(engine.mem_read(base + meta["seedStorageRva"], 8)))[0]
        if normalized_seed != (seed or 1):
            raise ValueError("Native seed normalization changed")
        frames = []
        override = 0xfffffff0 if index % 2 else None
        for ordinal in range(512):
            if ordinal == 1 and override is not None:
                engine.mem_write(stream + 0x10, struct.pack("<I", override))
            call(meta["nextFloatRva"])
            frames.append({"floatBits": engine.reg_read(reg.UC_X86_REG_XMM0) & 0xffffffff,
                           **random_state()})
        sequences.append({"seedHex": f"{seed:016x}", "counterOverrideAfterFirst": override, "frames": frames})
    conversions = []
    for value in [0, 1, 2, 0xffffff, 0x1000000, 0x1000001, 0x7fffffff, 0x80000000,
                  0xffffff00, 0xffffff7f, 0xffffff80, 0xfffffffe, 0xffffffff]:
        a, b = meta["floatConversionBlock"]
        call(a, {reg.UC_X86_REG_RBX: value}, b)
        conversions.append({"lowWord": value, "floatBits": engine.reg_read(reg.UC_X86_REG_XMM0) & 0xffffffff})
    points, value_fields = [], []
    families = {"ValueFloat": (1, "VfxAnimatedFloatVariableData"),
                "ValueVector2": (2, "VfxAnimatedVector2fVariableData"),
                "ValueVector3": (3, "VfxAnimatedVector3fVariableData"),
                "ValueColor": (4, "VfxAnimatedColorVariableData")}

    def walk(value, path, effect, digest):
        if isinstance(value, dict):
            family = families.get(value.get("__type"))
            if family and value.get("dynamics", {}).get("__type") == family[1]:
                value_fields.append({"effect": effect, "path": path, "definitionSha256": digest,
                                     "field": value, "width": family[0]})
            if value.get("__type") == "{ee39916f}":
                if set(value) - {"__type", "emitOffset"}:
                    raise ValueError("Unprepared point-shape property")
                points.append({"effect": effect, "path": path, "definitionSha256": digest, "shape": value})
            for key, child in value.items():
                walk(child, f"{path}.{key}", effect, digest)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}[{index}]", effect, digest)

    for effect, entry in sorted(manifest["definitions"].items()):
        raw = (args.effects / entry["file"]).read_bytes()
        if sha(raw) != entry["sha256"]:
            raise ValueError("VFX birth asset changed")
        walk(json.loads(raw)["definition"], "definition", effect, entry["sha256"])
    authored_points = len(points)
    points.extend([{"kind": "controlled-diagnostic", "shape": {"__type": "{ee39916f}", **fields}} for fields in
                   [{}, {"emitOffset": [-0., 0., -0.]}, {"emitOffset": [-50000, 1.25, 1234.567]}]])
    point_cases = []
    for point in points:
        point_meta = package["point"]
        a, b = point_meta["constructorBlock"]
        engine.mem_write(shape_at, b"\xa5" * 0x40)
        call(a, {reg.UC_X86_REG_RAX: shape_at}, b)
        if "emitOffset" in point["shape"]:
            values = point["shape"]["emitOffset"]
            if not isinstance(values, list) or len(values) != 3:
                raise ValueError("Invalid authored point offset")
            engine.mem_write(shape_at + 8, struct.pack("<fff", *values))
        engine.mem_write(output, b"\xa5" * 0x40)
        before = random_state()
        call(point_meta["postLoadRva"], {reg.UC_X86_REG_RDI: shape_at})
        call(point_meta["sampleRva"], {reg.UC_X86_REG_RDI: shape_at, reg.UC_X86_REG_RSI: output})
        call(point_meta["secondaryRva"], {reg.UC_X86_REG_RDI: shape_at, reg.UC_X86_REG_RSI: output})
        actual = bytes(engine.mem_read(output, 0x40))
        if actual[:8] + actual[20:] != b"\xa5" * (0x40 - 12) or random_state() != before:
            raise ValueError("Native point callback modified other fields or RNG")
        point_cases.append({**point, "offsetBits": list(struct.unpack_from("<III", actual, 8)), "otherBytesUnchanged": True})
    selected_fields, field_groups = [], []
    for width in [1, 2, 3, 4]:
        for random_tables in [False, True]:
            group = [item for item in value_fields if item["width"] == width and
                     bool(any(t and t.get("keyTimes") for t in item["field"]["dynamics"].get("probabilityTables", []))) == random_tables]
            selected = [group[index] for index in sorted({int(i * len(group) / min(64, len(group)))
                        for i in range(min(64, len(group)))})]
            selected_fields.extend(selected)
            field_groups.append({"width": width, "randomTables": random_tables,
                                 "available": len(group), "selected": len(selected)})
    dynamic, times_at, values_at, chance_at = [owned + at for at in [0x30000, 0x40000, 0x50000, 0xa0000]]
    value_cases = []
    f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]

    def put_array(at, values):
        if len(values) > 16384:
            raise ValueError("VFX value probe array limit")
        engine.mem_write(at, struct.pack("<" + "f" * len(values), *values) if values else bytes(4))

    for ordinal, item in enumerate(selected_fields):
        width, field = item["width"], item["field"]
        curve = field["dynamics"]
        times, values = curve.get("times", []), curve.get("values", [])
        if len(times) != len(values) or len(times) > 4096 or any(f(times[n]) < f(times[n-1]) for n in range(1, len(times))):
            raise ValueError("Invalid randomized VFX curve keys")
        value_meta = package["randomizedValues"][str(width)]
        engine.mem_write(dynamic, b"\xa5" * 0x100)
        a, b = value_meta["constructorBlock"]
        call(a, {reg.UC_X86_REG_RAX: dynamic}, b)
        vtable = struct.unpack("<Q", bytes(engine.mem_read(dynamic, 8)))[0]
        if vtable != base + value_meta["vtableRva"]:
            raise ValueError("Native VFX value constructor vtable changed")
        post_load = struct.unpack("<Q", bytes(engine.mem_read(vtable + 0x20, 8)))[0] - base
        sample_entry = struct.unpack("<Q", bytes(engine.mem_read(vtable + value_meta["sampleSlot"], 8)))[0] - base
        if post_load != value_meta["postLoadRva"] or sample_entry != value_meta["sampleRva"]:
            raise ValueError("Native VFX value callbacks changed")
        put_array(times_at, times)
        flat = values if width == 1 else [lane for vector in values for lane in vector]
        put_array(values_at, flat)
        engine.mem_write(dynamic + value_meta["timeOffset"], struct.pack("<QI", times_at, len(times)))
        engine.mem_write(dynamic + value_meta["valueOffset"], struct.pack("<QI", values_at, len(values)))
        tables = curve.get("probabilityTables", [])
        if tables and (len(tables) != width or any(t is None for t in tables)):
            raise ValueError("Unprepared sparse authored probability table layout")
        for lane, table in enumerate(tables):
            table_at = owned + 0x60000 + lane * 0x10000
            table_times, table_values = table.get("keyTimes", []), table.get("keyValues", [])
            if len(table_times) != len(table_values) or len(table_times) > 1024:
                raise ValueError("Invalid VFX probability keys")
            a, b = value_package["probability"]["constructorBlock"]
            call(a, {reg.UC_X86_REG_RAX: table_at}, b)
            put_array(table_at + 0x1000, table_times)
            put_array(table_at + 0x3000, table_values)
            engine.mem_write(table_at, struct.pack("<QI", table_at + 0x1000, len(table_times)))
            engine.mem_write(table_at + 0x10, struct.pack("<QI", table_at + 0x3000, len(table_values)))
            engine.mem_write(table_at + 0x20, struct.pack("<f", table.get("singleValue", 1)))
            call(value_package["probability"]["postLoadRva"], {reg.UC_X86_REG_RDI: table_at})
            engine.mem_write(dynamic + 8 + lane * 8, struct.pack("<Q", table_at))
        call(post_load, {reg.UC_X86_REG_RDI: dynamic})
        call(meta["seedRva"], {reg.UC_X86_REG_RDI: 0x915c + ordinal})
        call(meta["nextFloatRva"])
        samples = []
        for time in sorted({f(n) for n in [-.125, 0, .05, .25, .5, .75, 1, 1.125, *times]}):
            for shared in [None, .25]:
                before = random_state()
                registers = {reg.UC_X86_REG_RDI: dynamic,
                             reg.UC_X86_REG_XMM0: int.from_bytes(struct.pack("<f", time), "little")}
                chance_ptr = 0
                if shared is not None:
                    engine.mem_write(chance_at, struct.pack("<f", shared))
                    chance_ptr = chance_at
                if value_meta["outputRegister"] == "rsi":
                    registers.update({reg.UC_X86_REG_RSI: output, reg.UC_X86_REG_RDX: chance_ptr})
                else:
                    registers.update({reg.UC_X86_REG_RDX: output, reg.UC_X86_REG_RCX: chance_ptr})
                call(sample_entry, registers)
                samples.append({"time": time, "sharedChance": shared, "randomBefore": before,
                                "valueBits": list(struct.unpack("<" + "I" * width, bytes(engine.mem_read(output, width * 4)))),
                                "randomAfter": random_state()})
        value_cases.append({**item, "samples": samples})
    result = {"schema": 1, "build": package["build"], "protocol": package["protocol"],
              "definitionSha256": sha(package_bytes), "decoderImageSha256": sha(image),
              "effectsManifestSha256": sha(manifest_bytes), "observerSourceSha256": sha(Path(__file__).read_bytes()),
              "vfxValuesSha256": sha(value_bytes), "fieldGroups": field_groups, "valueCases": value_cases,
              "valueScope": "Whole original unbaked float/vector2/vector3/color dynamic post-load and full samplers, with actual seeded RNG or supplied shared chance. Owned field/table objects; no actual BIN loader, baked/integrated evaluation, emitter birth call order or original match random sequence",
              "adapters": [{"name": "owned TLS address resolution", "descriptors": meta["tls"],
                            "rngObjectAlreadyInitialized": True, "calls": tls_calls}],
              "randomSequences": sequences, "conversions": conversions, "authoredPoints": authored_points,
              "pointCases": point_cases, "scope": __doc__}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"sequences": len(sequences), "randomDraws": sum(len(s["frames"]) for s in sequences),
                      "conversions": len(conversions), "authoredPoints": authored_points, "pointCases": len(point_cases),
                      "valueFields": len(value_cases), "valueSamples": sum(len(c["samples"]) for c in value_cases), "tlsCalls": tls_calls}))


if __name__ == "__main__":
    main()
