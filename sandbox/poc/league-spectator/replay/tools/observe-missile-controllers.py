"""Execute original missile components on replay-derived and diagnostic inputs.

Owned records are not a complete controller or trajectory. Terrain layout is
admitted by independent original-loader evidence. The imported macOS powf call
uses an explicitly identified Windows CRT adapter; macOS libm parity is unknown.
"""
import argparse
import ctypes
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
    for name in ["package", "scene", "missiles", "terrain_evidence", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    controller_bytes = (args.package / "missile-controllers.json").read_bytes()
    definition = json.loads(controller_bytes)
    manifest_bytes = (args.scene / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    height_bytes = (args.scene / "heights.bin").read_bytes()
    missile_bytes = args.missiles.read_bytes()
    missiles = json.loads(missile_bytes)
    terrain_bytes = args.terrain_evidence.read_bytes()
    terrain = json.loads(terrain_bytes)
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(image) != profile["decoderImageSha256"]
        or sha(controller_bytes) != profile["missileControllersSha256"]
        or definition["decoderImageSha256"] != profile["decoderImageSha256"]
        or definition["build"] != profile["clientVersion"]
        or manifest["build"] != profile["clientVersion"]
        or missiles["missileControllersSha256"] != profile["missileControllersSha256"]
        or missiles["build"] != manifest["build"]
        or missiles["protocol"] != manifest["protocol"]
        or terrain["decoderImageSha256"] != profile["decoderImageSha256"]
        or terrain["sceneManifestSha256"] != sha(manifest_bytes)
        or terrain["heightsSha256"] != sha(height_bytes)
        or terrain["mismatches"] or not terrain["loader"]["preparedSamplesMatch"]):
        raise ValueError("Missile component inspection package mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x2000000)
    stop, stack, manager, grid_at = 0x10000000, 0x10008000, 0x10001000, 0x10002000
    height_at = 0x10100000
    entity, motion, update, solver = 0x10020000, 0x10021000, 0x10022000, 0x10023000
    target_at, start_at, predicted_at, current_at = 0x10024000, 0x10025000, 0x10026000, 0x10027000
    grid = manifest["map"]["heightGrid"]
    engine.mem_write(grid_at + 0xbc, struct.pack("<fff", *manifest["map"]["min"]))
    engine.mem_write(grid_at + 0xc8, struct.pack("<fff", *manifest["map"]["max"]))
    engine.mem_write(grid_at + 0xf8, struct.pack("<Q", height_at))
    engine.mem_write(grid_at + 0x100, struct.pack("<IIff", grid["x"], grid["z"], *grid["step"]))
    engine.mem_write(height_at, height_bytes)
    engine.mem_write(manager + 8, struct.pack("<Q", grid_at))
    engine.mem_write(base + 0x246c948, struct.pack("<Q", manager))
    initial = engine.context_save()
    f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]
    bits = lambda n: int.from_bytes(struct.pack("<f", n), "little")
    scalar = lambda r: struct.unpack("<f", (engine.reg_read(r) & 0xffffffff).to_bytes(4, "little"))[0]
    crt = Path("C:/Windows/System32/ucrtbase.dll")
    powf = ctypes.CDLL(str(crt)).powf
    powf.argtypes = [ctypes.c_float, ctypes.c_float]
    powf.restype = ctypes.c_float
    pow_calls = 0

    def imported_powf(uc, address, size, user):
        nonlocal pow_calls
        a, b = scalar(reg.UC_X86_REG_XMM0), scalar(reg.UC_X86_REG_XMM1)
        value = powf(a, b)
        if not value >= 0:
            raise ValueError("Unexpected non-finite/negative powf fixture result")
        rsp = uc.reg_read(reg.UC_X86_REG_RSP)
        return_at = struct.unpack("<Q", bytes(uc.mem_read(rsp, 8)))[0]
        uc.reg_write(reg.UC_X86_REG_XMM0, bits(value))
        uc.reg_write(reg.UC_X86_REG_RSP, rsp + 8)
        uc.reg_write(reg.UC_X86_REG_RIP, return_at)
        pow_calls += 1

    engine.hook_add(unicorn.UC_HOOK_CODE, imported_powf,
                    begin=base + 0x1feeb3a, end=base + 0x1feeb3a)

    def call(entry, registers, xmm0=None):
        engine.context_restore(initial)
        engine.mem_write(stack, struct.pack("<Q", stop))
        engine.reg_write(reg.UC_X86_REG_RSP, stack)
        for register, value in registers.items():
            engine.reg_write(register, value)
        if xmm0 is not None:
            engine.reg_write(reg.UC_X86_REG_XMM0, bits(xmm0))
        engine.emu_start(base + entry, stop, count=3000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != stop:
            raise ValueError(f"Native controller instruction limit {entry:x}")

    cases = []
    for record in missiles["records"]:
        height_controller = record["heightController"]
        if not record["settings"] and height_controller["status"] not in [
            "translated", "translated-external-powf-unverified"]:
            continue
        packet_initialized = record["packetInitialization"]["status"] == "initialized-position-fields"
        start = list(map(f, record["packetInitialization"]["initialPosition"] if packet_initialized
                         else record["cast"]["sourcePosition"]))
        initialized = record["targetInitialization"]["status"] == "initialized"
        # A cast endpoint is a valid vector probe. It is explicitly NOT admitted
        # as the runtime target when initialization is unresolved.
        target = list(map(f, record["packetInitialization"]["targetPosition"] if packet_initialized
                         else record["targetInitialization"]["position"] if initialized
                         else record["cast"]["targetPosition"]))
        engine.mem_write(motion + 0x18, struct.pack("<Q", entity))
        engine.mem_write(motion + 0x70, struct.pack("<fff", *start))
        engine.mem_write(motion + 0x7c, struct.pack("<fff", *target))
        engine.mem_write(motion + 0xa0, struct.pack("<f", record["movementSpeed"]))
        for fraction in [0, 0.5, 1.05]:
            position = [f(a + (b - a) * fraction) for a, b in zip(start, target)]
            engine.mem_write(entity + 0x15c, struct.pack("<fff", *position))
            for seconds in [f(1/60), f(0.1), f(0.25)]:
                call(0x87f4e0, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: update}, seconds)
                displacement = list(struct.unpack("<fff", bytes(engine.mem_read(update + 0x10, 12))))
                for radius in [0.0, 30.0]:
                    engine.mem_write(motion + 0x9c, struct.pack("<f", radius))
                    for pass_once in [False, True]:
                        engine.mem_write(update + 0x10, struct.pack("<fff", *displacement))
                        engine.mem_write(entity + 0x3ca, bytes([pass_once]))
                        call(0x88be60, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: update})
                        arrived = bool(engine.reg_read(reg.UC_X86_REG_EAX) & 255)
                        pass_after = bool(bytes(engine.mem_read(entity + 0x3ca, 1))[0])
                        if arrived:
                            call(0x88bc40, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: update + 0x10})
                        final_displacement = list(struct.unpack("<fff", bytes(engine.mem_read(update + 0x10, 12))))
                        engine.mem_write(update + 0x1c, bytes([arrived]))
                        call(0x88d240, {reg.UC_X86_REG_RDI: motion, reg.UC_X86_REG_RSI: update})
                        progress = scalar(reg.UC_X86_REG_XMM0)
                        predicted = [f(a + b) for a, b in zip(position, final_displacement)]
                        sample = {"sequence": record["sequence"], "movementType": record["movementType"],
                            "inputScope": "packet-position-component-probe" if packet_initialized else
                                "initialized-target-component-probe" if initialized else "cast-endpoint-probe-not-runtime-target",
                            "start": start, "target": target, "position": position,
                            "displacement": displacement, "radius": radius, "canPassOnce": pass_once,
                            "arrived": arrived, "canPassAfter": pass_after,
                            "finalDisplacementBits": list(struct.unpack("<III", struct.pack("<fff", *final_displacement))),
                            "progressBits": bits(progress), "predicted": predicted,
                            "heightController": height_controller, "heightBits": None}
                        height_type = height_controller["type"]
                        if height_type in ["FollowTerrainHeightSolver", "BlendedLinearHeightSolver"]:
                            for at, value in [(target_at, target), (start_at, start),
                                              (predicted_at, predicted), (current_at, position)]:
                                engine.mem_write(at, struct.pack("<fff", *value))
                            if height_type == "FollowTerrainHeightSolver":
                                settings = height_controller["settings"]
                                engine.mem_write(solver + 8, struct.pack("<ff", settings["mHeightOffset"], settings["mMaxSlope"]))
                            entry = definition["heightSolvers"][height_type]["evaluateRva"]
                            call(entry, {reg.UC_X86_REG_RDI: solver, reg.UC_X86_REG_RSI: target_at,
                                reg.UC_X86_REG_RDX: start_at, reg.UC_X86_REG_RCX: predicted_at,
                                reg.UC_X86_REG_R8: current_at}, progress)
                            sample["heightBits"] = engine.reg_read(reg.UC_X86_REG_XMM0) & 0xffffffff
                        cases.append(sample)
    if bytes(engine.mem_read(height_at, len(height_bytes))) != height_bytes:
        raise ValueError("Controller probes mutated terrain samples")
    result = {"schema": 1, "build": manifest["build"], "protocol": manifest["protocol"],
        "decoderImageSha256": profile["decoderImageSha256"],
        "controllerDefinitionSha256": sha(controller_bytes), "missileInputsSha256": sha(missile_bytes),
        "sceneManifestSha256": sha(manifest_bytes), "heightsSha256": sha(height_bytes),
        "terrainEvidenceSha256": sha(terrain_bytes),
        "externalMath": {"symbol": "_powf", "stubRva": 0x1feeb3a,
            "adapter": str(crt), "adapterSha256": sha(crt.read_bytes()), "calls": pow_calls,
            "originalMacosImplementationVerified": False},
        "scope": "Original arrival/snap/progress and height components on owned replay-derived vector probes; these are not admitted trajectories. Blended height uses an identified Windows CRT powf adapter, not original macOS libm",
        "cases": cases}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "powfAdapterCalls": pow_calls,
        "followTerrainCases": sum(s["heightController"]["type"] == "FollowTerrainHeightSolver" for s in cases)}))


if __name__ == "__main__":
    main()
