"""Run the original emitter-count function on owned inputs and authored rates.

Time, normalized emitter age and quality scale are supplied inputs. The original
ArbitraryQuad capacity callback executes. No renderer, original outer emitter
update, global quality selection, velocity/flex inputs or RNG is modeled.
"""
import argparse
import hashlib
import itertools
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
    package_bytes = (args.package / "vfx-emission.json").read_bytes()
    package = json.loads(package_bytes)
    values_bytes = (args.package / "vfx-values.json").read_bytes()
    values_package = json.loads(values_bytes)
    manifest_bytes = (args.effects / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    if (sha(image) != profile["decoderImageSha256"] or sha(package_bytes) != profile["vfxEmissionSha256"]
        or sha(values_bytes) != profile["vfxValuesSha256"] or package["decoderImageSha256"] != sha(image)
        or package["build"] != manifest["build"] or package["protocol"] != manifest["protocol"]):
        raise ValueError("VFX emission package mismatch")
    fields, omitted = [], {}
    for effect, entry in sorted(manifest["definitions"].items()):
        data = (args.effects / entry["file"]).read_bytes()
        if sha(data) != entry["sha256"]:
            raise ValueError("VFX emission asset changed")
        definition = json.loads(data)["definition"]
        for family in ["complexEmitterDefinitionData", "simpleEmitterDefinitionData"]:
            for index, emitter in enumerate(definition.get(family, [])):
                reason = ("flex-rate" if emitter.get("flexRate") else
                          "velocity-derived-rate" if emitter.get("rateByVelocityFunction") else
                          "rate-rng" if any(t and t.get("keyTimes") for t in
                              emitter.get("rate", {}).get("dynamics", {}).get("probabilityTables", [])) else None)
                if reason:
                    omitted[reason] = omitted.get(reason, 0) + 1
                    continue
                relevant = {key: emitter[key] for key in ["rate", "period", "HasVariableStartTime", "isSingleParticle"] if key in emitter}
                fields.append({"effect": effect, "family": family, "index": index,
                               "definitionSha256": entry["sha256"], "emitter": relevant})
    selected = [fields[index] for index in sorted({int(i * len(fields) / min(512, len(fields)))
                for i in range(min(512, len(fields)))})]
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    owned = 0x10000000
    engine.mem_map(owned, 0x100000)
    stop, stack, emitter_at, link, definition_at, system, quality, context, primitive, dynamic, times_at, values_at = [
        owned + at for at in [0, 0x10008, 0x20000, 0x21000, 0x22000, 0x23000, 0x24000,
                             0x25000, 0x26000, 0x30000, 0x40000, 0x50000]]
    engine.mem_write(base + package["qualityPointerRva"], struct.pack("<Q", quality))
    engine.mem_write(emitter_at, struct.pack("<QQ", system, link))
    engine.mem_write(link + 0x10, struct.pack("<Q", definition_at))
    engine.mem_write(definition_at + 0x60, struct.pack("<Q", primitive))
    initial = engine.context_save()

    def reject(uc, address, size, user):
        raise ValueError(f"VFX emission entered unadmitted service {address-base:x}")

    for patch in profile["modeledServices"]:
        engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + patch["rva"],
                        end=base + patch["rva"] + len(bytes.fromhex(patch["bytesHex"])) - 1)
    engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + 0x1490eb0, end=base + 0x1490eb0)

    def call(entry, registers, end=None):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        for register, value in registers.items():
            engine.reg_write(register, value)
        expected = base + end if end is not None else stop
        engine.emu_start(base + entry, expected, count=100000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != expected:
            raise ValueError("VFX emission instruction limit")

    block = package["primitiveConstructorBlock"]
    call(block[0], {reg.UC_X86_REG_RDI: primitive}, block[1])
    primitive_vtable = struct.unpack("<Q", bytes(engine.mem_read(primitive, 8)))[0]
    if primitive_vtable != base + package["primitiveVtableRva"]:
        raise ValueError("VFX emission primitive constructor mismatch")
    default_period = struct.unpack("<f", struct.pack("<I", package["defaults"]["periodBits"]))[0]

    def put_float(at, value):
        engine.mem_write(at, struct.pack("<f", value))

    def prepare(emitter):
        engine.mem_write(definition_at + 0x1f8, bytes(8))
        field = emitter.get("rate", {})
        put_float(definition_at + 0x1f0, field.get("constantValue", 0))
        put_float(definition_at + 0x224, emitter.get("period", default_period))
        flags = (0x80000 if emitter.get("HasVariableStartTime") else 0) | (0x100000 if emitter.get("isSingleParticle") else 0)
        engine.mem_write(definition_at + 0x2d0, struct.pack("<I", flags))
        if "dynamics" not in field:
            return
        meta = values_package["float"]
        block = meta["constructorBlock"]
        call(block[0], {reg.UC_X86_REG_RAX: dynamic}, block[1])
        curve = field["dynamics"]
        times, values = curve.get("times", []), curve.get("values", [])
        if len(times) != len(values) or len(times) > 4096:
            raise ValueError("Invalid VFX emission rate keys")
        if any(t for t in curve.get("probabilityTables", [])):
            # Nonempty authored probability object needs its own native setup;
            # even a deterministic single-value factor is not silently dropped.
            raise ValueError("Unprepared authored rate probability object")
        for at, array in [(times_at, times), (values_at, values)]:
            engine.mem_write(at, struct.pack("<" + "f" * len(array), *array) if array else bytes(4))
        engine.mem_write(dynamic + 0x10, struct.pack("<QI", times_at, len(times)))
        engine.mem_write(dynamic + 0x20, struct.pack("<QI", values_at, len(values)))
        call(meta["postLoadRva"], {reg.UC_X86_REG_RDI: dynamic})
        engine.mem_write(definition_at + 0x1f8, struct.pack("<Q", dynamic))

    cases, sequences, position_cases = [], [], []

    def observe(source, emitter, inputs):
        prepare(emitter)
        for input_value in inputs:
            put_float(context + 0x18, input_value["time"])
            put_float(context + 0x1c, input_value["normalizedAge"])
            put_float(emitter_at + 0x1c, input_value["lastEmissionTime"])
            engine.mem_write(emitter_at + 0x18, bytes([4 if input_value["hasEmitted"] else 0]))
            # Index zero is an explicitly supplied quality context, not a claim
            # about the client's chosen importance/quality configuration.
            put_float(quality + package["qualityArrayOffset"], input_value["qualityScale"])
            call(package["countRva"], {reg.UC_X86_REG_RDI: emitter_at, reg.UC_X86_REG_RSI: context})
            count = engine.reg_read(reg.UC_X86_REG_RAX)
            if count > 65535:
                raise ValueError("Native emission count exceeds u16")
            cases.append({"source": source, "emitter": emitter, "input": input_value, "count": count})

    for selected_field in selected:
        inputs = []
        for time, age, last in [(0, 0, 0), (.001, .001, 0), (.05, .25, 0), (.5, .5, .1),
                                (.61, .75, .55), (1, 1, .9), (2, 1.125, 0)]:
            for has_emitted in [False, True]:
                inputs.append({"time": time, "normalizedAge": age, "lastEmissionTime": last,
                               "qualityScale": 1, "hasEmitted": has_emitted})
        observe({key: value for key, value in selected_field.items() if key != "emitter"}, selected_field["emitter"], inputs)
    for rate, period, single, variable, quality_scale in itertools.product(
            [0, .001, .5, 1, 3.5, 30, 100, 65536, 1e10, default_period],
            [default_period, 1, .6, 0], [False, True], [False, True], [0, .5, 1, 2]):
        emitter = {"rate": {"constantValue": rate, "__type": "ValueFloat"}, "period": period,
                   "isSingleParticle": single, "HasVariableStartTime": variable}
        inputs = [{"time": time, "normalizedAge": age, "lastEmissionTime": last,
                   "qualityScale": quality_scale, "hasEmitted": has_emitted}
                  for time, age, last, has_emitted in [(0, 0, 0, False), (.016, .1, 0, False),
                                                       (.016, .1, 0, True), (.61, .5, .55, True)]]
        observe({"kind": "controlled-diagnostic"}, emitter, inputs)
    for rate, cadence, single in itertools.product([1, 30, 100, 300], [1/30, 1/60, 1/120, 1/144, .1], [False, True]):
        emitter = {"rate": {"constantValue": rate, "__type": "ValueFloat"}, "isSingleParticle": single}
        prepare(emitter)
        put_float(emitter_at + 0x1c, 0)
        engine.mem_write(emitter_at + 0x18, b"\0")
        put_float(quality + package["qualityArrayOffset"], 1)
        frames = []
        f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]
        for index in range(int(.8 / cadence) + 1):
            time = f(index * cadence)
            put_float(context + 0x18, time)
            put_float(context + 0x1c, f(time / .8))
            call(package["countRva"], {reg.UC_X86_REG_RDI: emitter_at, reg.UC_X86_REG_RSI: context})
            count = engine.reg_read(reg.UC_X86_REG_RAX)
            if count:
                # Execute the two original birth-commit stores in isolation.
                # This explicitly assumes that actual birth work was admitted.
                frame_stack = owned + 0x70000
                put_float(frame_stack - 0x2d0, time)
                block = package["birthTimeCommitBlock"]
                call(block[0], {reg.UC_X86_REG_RBX: emitter_at, reg.UC_X86_REG_RBP: frame_stack}, block[1])
                block = package["birthFlagCommitBlock"]
                call(block[0], {reg.UC_X86_REG_RBX: emitter_at}, block[1])
            last_bits = struct.unpack("<I", bytes(engine.mem_read(emitter_at + 0x1c, 4)))[0]
            flags = engine.mem_read(emitter_at + 0x18, 1)[0]
            frames.append({"time": time, "normalizedAge": f(time / .8), "count": count,
                           "lastEmissionTimeBits": last_bits, "hasEmitted": bool(flags & 4)})
        sequences.append({"emitter": emitter, "cadence": cadence, "frames": frames})
    # Independently execute native count clamping, position-delta staging, setup
    # and per-birth origin interpolation. These are supplied system positions;
    # no claim is made that an actor's attachment matrices have been rebuilt.
    random_state = 0x915c2026
    frame_stack = owned + 0x70000
    for index in range(24):
        coordinates = []
        for lane in range(6):
            random_state = (1664525 * random_state + 1013904223) & 0xffffffff
            coordinates.append(f(((random_state / 0xffffffff) - .5) * 30000))
        previous, current = coordinates[:3], coordinates[3:]
        if index == 0:
            previous, current = [0, 0, 0], [0, 0, 0]
        if index == 1:
            previous, current = [-0., 0., -0.], [0., -0., 0.]
        engine.mem_write(system + 0xfc, struct.pack("<fff", *previous))
        engine.mem_write(system + 0x108, struct.pack("<fff", *current))
        for requested_count in [0, 1, 2, 7, 32, 1000, 1001, 65535]:
            if not requested_count:
                position_cases.append({"previous": previous, "current": current, "requestedCount": 0, "positionsBits": []})
                continue
            block = package["birthCountClampBlock"]
            call(block[0], {reg.UC_X86_REG_RBP: frame_stack, reg.UC_X86_REG_RDX: requested_count}, block[1])
            block = package["birthPositionInputsBlock"]
            call(block[0], {reg.UC_X86_REG_RBP: frame_stack, reg.UC_X86_REG_R14: system}, block[1])
            put_float(frame_stack - 0x1e0, 0)
            put_float(frame_stack - 0x2d0, .1)
            block = package["birthPositionSetupBlock"]
            call(block[0], {reg.UC_X86_REG_RBP: frame_stack, reg.UC_X86_REG_R14: system,
                           reg.UC_X86_REG_XMM1: int.from_bytes(struct.pack("<f", .1), "little")}, block[1])
            count = struct.unpack("<f", bytes(engine.mem_read(frame_stack - 0x22c, 4)))[0]
            if not 0 < count <= 1000 or count != int(count):
                raise ValueError("Native birth count clamp invalid")
            positions = []
            for ordinal in range(1, int(count) + 1):
                block = package["birthPositionBlock"]
                call(block[0], {reg.UC_X86_REG_RBP: frame_stack, reg.UC_X86_REG_R14: system,
                               reg.UC_X86_REG_R12: ordinal}, block[1])
                positions.append(list(struct.unpack("<III", bytes(engine.mem_read(frame_stack - 0x380, 12)))))
            position_cases.append({"previous": previous, "current": current, "requestedCount": requested_count, "positionsBits": positions})
    result = {"schema": 1, "build": package["build"], "protocol": package["protocol"],
              "definitionSha256": sha(package_bytes), "vfxValuesSha256": sha(values_bytes),
              "decoderImageSha256": sha(image), "effectsManifestSha256": sha(manifest_bytes),
              "observerSourceSha256": sha(Path(__file__).read_bytes()),
              "availableEmitterFields": len(fields), "sampledEmitterFields": len(selected),
              "omitted": omitted, "cases": cases, "sequences": sequences, "positionCases": position_cases,
              "positionScope": "Original count-clamp and birth-origin staging/setup/interpolation fragments on supplied system positions. Actual attachment/system pose, emitter offsets, orientation, random birth data, pool insertion and trail geometry are not executed",
              "sequenceScope": "Original count plus conditional original time/flag birth-commit fragments. Actual particle birth work is assumed admitted, not executed; supplied clocks and outer gates are not native scheduling evidence",
              "scope": __doc__}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"availableEmitterFields": len(fields), "sampledEmitterFields": len(selected),
                      "cases": len(cases), "sequences": len(sequences), "frames": sum(len(s["frames"]) for s in sequences),
                      "positionCases": len(position_cases), "birthOrigins": sum(len(s["positionsBits"]) for s in position_cases), "omitted": omitted}))


if __name__ == "__main__":
    main()
