"""Verify original detached ArbitraryQuad pool retirement with reviewed inputs.

The owned scene supplies quality, attachment and update cadence. The probe
establishes CPU pool birth and natural retirement only.
"""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import unicorn
from unicorn import x86_const as reg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from champion_replication_archive import CURRENT_BUILD, read_replication_image


def run(image, event, fields, cadence, supplied_random):
    def constant(key, default=None):
        obj = fields.get(key)
        if obj is None:
            return default
        lanes = obj["fields"]
        assert set(lanes) == {"b4b427aa"}, (key, lanes)
        return lanes["b4b427aa"]["value"]

    def v(x, axes="XYZ"):
        return [x[k] for k in axes]

    offset = v(fields["3bf0b4ed"]["fields"]["e5f268dd"]["value"])
    assert fields["3bf0b4ed"]["classHash"] == "ee39916f"
    assert fields["007b14f6"]["classHash"] == "4beb81fd"
    assert fields["42bd7f6b"]["value"] == 1 and fields["27d40903"]["value"] == 1
    assert "99c94704" not in fields and "22e763bc" not in fields and "2431d42c" not in fields
    authored = {
        "rate": constant("ae839c67"),
        "lifetime": fields["5212abee"]["value"]["value"],
        "particleLifetime": constant("2a552694"),
        "particleLinger": None,
        "bindWeight": None,
    }
    lifetime = authored["particleLifetime"]
    bind = constant("ca406316")
    rng_samples = []
    vm = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    vm.mem_map(image.base, len(image.image))
    vm.mem_write(image.base, bytes(image.image))

    stop = 0x10000000
    vm.mem_map(stop, 0x10000)
    stack = stop + 0xF008
    definition, actor, link, system, quality = (stop + offset for offset in range(0x1000, 0x6000, 0x1000))

    def put(address, format_string, *values):
        vm.mem_write(address, struct.pack("<" + format_string, *values))

    def host_boundary(engine, address, _size, _data):
        nonlocal heap
        rdi = engine.reg_read(reg.UC_X86_REG_RDI)
        rsi = engine.reg_read(reg.UC_X86_REG_RSI)
        rva = address - image.base
        if rva in (0x14A0300, 0x14A2030, 0x14C5B20):
            if not 0 < rdi <= 0x400 or heap + rdi > stop + 0xA000:
                raise ValueError("Original emitter allocation exceeds owned arena")
            engine.reg_write(reg.UC_X86_REG_RAX, heap)
            heap += (rdi + 15) & ~15
        elif rva == 0x14C5B80:
            if rdi and not stop + 0x8000 <= rdi < heap:
                raise ValueError("Unexpected release outside the owned pool")
        elif rva == 0x2051310:
            source = bytes(engine.mem_read(rdi, 128))
            engine.reg_write(reg.UC_X86_REG_RAX, source.index(0))
        elif rva == 0x2050F6E:
            size = engine.reg_read(reg.UC_X86_REG_RDX)
            if size > 128 or not (stop + 0x8000 <= rdi <= heap - size or stack - 0x1000 <= rdi <= stack - size):
                raise ValueError("Original emitter copy outside owned memory")
            engine.mem_write(rdi, bytes(engine.mem_read(rsi, size)))
            engine.reg_write(reg.UC_X86_REG_RAX, rdi)
        elif rva == 0x2050B90:
            bits = engine.reg_read(reg.UC_X86_REG_XMM0) & 0xFFFFFFFF
            (angle,) = struct.unpack("<f", struct.pack("<I", bits))
            engine.reg_write(
                reg.UC_X86_REG_XMM0,
                int.from_bytes(
                    struct.pack("<ff", math.sin(angle), math.cos(angle)),
                    "little",
                ),
            )
        elif rva == 0x14BC630:
            rng_samples.append(supplied_random)
            engine.reg_write(
                reg.UC_X86_REG_XMM0,
                struct.unpack(
                    "<I",
                    struct.pack("<f", supplied_random),
                )[0],
            )
        elif rva == 0x2050D8E:

            def argument(register):
                bits = engine.reg_read(register) & 0xFFFFFFFF
                return struct.unpack("<f", struct.pack("<I", bits))[0]

            value = math.fmod(argument(reg.UC_X86_REG_XMM0), argument(reg.UC_X86_REG_XMM1))
            engine.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", value))[0])
        rsp = engine.reg_read(reg.UC_X86_REG_RSP)
        (target,) = struct.unpack("<Q", engine.mem_read(rsp, 8))
        engine.reg_write(reg.UC_X86_REG_RSP, rsp + 8)
        engine.reg_write(reg.UC_X86_REG_RIP, target)

    def call(entry, rdi, rsi=0, time=None, end=stop):
        put(stack, "Q", stop)
        vm.reg_write(reg.UC_X86_REG_RSP, stack)
        vm.reg_write(reg.UC_X86_REG_RDI, rdi)
        vm.reg_write(reg.UC_X86_REG_RSI, rsi)
        if time is not None:
            vm.reg_write(reg.UC_X86_REG_XMM0, struct.unpack("<I", struct.pack("<f", time))[0])
        vm.emu_start(image.base + entry, end, count=30000)
        result = vm.reg_read(reg.UC_X86_REG_RIP)
        if result != end:
            raise ValueError(f"Native emitter {entry:#x} did not complete: {result - image.base:#x}")
        return vm.reg_read(reg.UC_X86_REG_RAX)

    # Class registrations 0x1727d37 and 0x17e5067 identify these in-place
    # constructors. The rate and single-particle bindings are in the same
    # registration at 0x1727d90 and 0x1727e22.
    heap = stop + 0x8000
    hooks = [
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
        for rva in (0x14A0300, 0x14A2030, 0x2051310, 0x2050F6E)
    ]
    call(0x14D501F, definition, end=image.base + 0x14D523E)
    call(0x17BDC20, definition)
    for hook in hooks:
        vm.hook_del(hook)
    # The emitter constructor initially places CameraQuad in this link.
    # The class registration for 4beb81fd provides the original placement
    # constructor at 0x17d6740 for the authored ArbitraryQuad.
    primitive = stop + 0x7A00
    call(0x17D6740, primitive)
    assert vm.mem_read(primitive + 8, 1) == b"\x01"
    for field, at in (("particleLifetime", 0xF8), ("particleLinger", 0x118), ("bindWeight", 0x3A0)):
        (authored[field],) = struct.unpack("<f", vm.mem_read(definition + at, 4))
    (period_bits,) = struct.unpack("<I", vm.mem_read(definition + 0x224, 4))
    if period_bits != 0x7F7FFFFF:
        raise ValueError("Unexpected native emitter period")

    put(definition + 0x1F0, "f", authored["rate"])
    (flags,) = struct.unpack("<I", vm.mem_read(definition + 0x2D0, 4))
    put(definition + 0x2D0, "I", flags | 0x100000)
    put(definition + 0x60, "Q", primitive)
    put(actor, "QQ", system, link)
    put(link + 0x10, "Q", definition)
    put(image.base + 0x24E8660, "Q", quality)
    put(quality + 0x284, "6f", *([1] * 6))

    resource, resource_settings, pool, attachment = (stop + offset for offset in (0x7100, 0x7300, 0x7500, 0x7700))
    put(link + 8, "Q", resource)
    put(resource + 0x38, "Q", resource_settings)
    put(link + 0x1C, "i", -1)
    put(link + 0x30, "i", -1)
    put(link + 0xE0, "ii", -1, -1)
    put(actor + 0x20, "f", authored["lifetime"])
    put(actor + 0x38, "Q", attachment)
    put(actor + 0xA0, "Q", pool)
    # Owned empty pool and its emitter, enclosing actor, and resource links.
    put(pool + 0xD8, "QQ", link, actor)
    put(system + 0x1E8, "Q", resource)
    put(resource_settings + 0x38, "Q", pool + 0x100)
    call(0x14B4E00, system + 0x248)
    pos = event["descriptor"]["positions"][0]
    for at in [0xFC, 0x108, 0x278]:
        put(system + at, "3f", *pos)
    put(definition + 0xF8, "f", lifetime)
    put(definition + 0x108, "f", authored["lifetime"])
    put(definition + 0x3E8, "3f", *v(constant("f0eb7084")))
    put(definition + 0x3D0, "3f", *v(constant("5932ff9c")))
    if bind is not None:
        put(definition + 0x3A0, "f", bind)
    shape = stop + 0x7900
    call(0x17C59D0, shape)
    put(definition + 0x238, "Q", shape)
    put(shape + 8, "3f", *offset)
    put(system + 0x150, "2f", 1, 1)
    put(system + 0x1B0, "8f", *([1] * 8))
    put(system + 0x1D0, "f", 1)
    put(system + 0x1F0, "2f", 1, 1)
    vm.mem_write(actor + 0x24, bytes(image.image[0x2140974:0x2140978]))
    put(actor + 0x18, "B", 0)
    for rva in (0x2050D8E, 0x2050B90, 0x14BC630, 0x14C5B20, 0x14C5B80):
        vm.hook_add(unicorn.UC_HOOK_CODE, host_boundary, begin=image.base + rva, end=image.base + rva)
    births = []

    def capture(_engine, _address, _size, _data):
        p = vm.reg_read(reg.UC_X86_REG_RSI)
        births.append([time, struct.unpack("<f", vm.mem_read(p + 0xCC, 4))[0]])

    addr = image.base + 0x1789DF0
    vm.hook_add(unicorn.UC_HOOK_CODE, capture, begin=addr, end=addr)
    f32_bits = struct.unpack("<I", struct.pack("<f", lifetime))[0]
    next_age = struct.unpack("<f", struct.pack("<I", f32_bits + 1))[0]
    check_ticks = range(math.ceil((lifetime + authored["lifetime"] + 1) * cadence))
    ages = sorted({lifetime, next_age, *(tick / cadence for tick in check_ticks)})
    for time in ages:
        call(0x1786280, actor, time=time)
        count = struct.unpack("<I", vm.mem_read(pool + 0x10, 4))[0]
        if count != (time <= lifetime):
            raise ValueError(f"Unexpected particle pool count {count} at age {time}")
    if births != [[0, lifetime]]:
        raise ValueError(f"Expected one birth with the authored lifetime: {births}")
    return {
        "cadence": cadence,
        "suppliedRandomSample": supplied_random,
        "rngCalls": len(rng_samples),
        "authored": authored,
        "births": births,
        "lastLiveAge": lifetime,
        "firstEmptyFloat32Age": next_age,
    }


def checked(path, digest):
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != digest:
        raise ValueError(f"Reviewed input digest differs: {path}")
    return json.loads(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "assets", "creations", "stops"):
        parser.add_argument(name, type=Path)
    for name in ("assets", "creations", "stops"):
        parser.add_argument(f"--{name}-sha256", required=True)
    parser.add_argument("--pick", action="append", required=True, help="hex key:emitter:handle")
    args = parser.parse_args()
    if not __debug__:
        raise RuntimeError("Run this probe with Python assertions enabled")
    archive = args.archive.read_bytes()
    decoder = hashlib.sha256(archive).hexdigest()
    image = read_replication_image(archive, CURRENT_BUILD)
    assets = checked(args.assets, args.assets_sha256)
    creations = checked(args.creations, args.creations_sha256)
    stops = checked(args.stops, args.stops_sha256)
    keys = ("build", "protocol", "replaySha256", "executableSha256")
    if (
        any(creations[key] != stops[key] for key in keys)
        or creations["build"] != CURRENT_BUILD
        or creations["executableSha256"] != decoder
        or stops["kind"] != "recorded-particle-stop-requests"
        or stops["opcode"] != 1164
    ):
        raise ValueError("Incompatible native creation and stop provenance")

    out = []
    for picked in args.pick:
        key, name, handle = picked.split(":")
        [asset] = [row for row in assets if row["key"] == key]
        [event] = [row for row in creations["events"] if row["handle"] == int(handle)]
        if (
            event["status"] != "detached-placement-confirmed"
            or event["parent"] != 0
            or event["descriptor"]["resourceKey"] != int(key, 16)
            or event["descriptor"]["flags"] not in (32, 48)
            or event["descriptor"]["scaleRate"][1] != 1
            or not any(stamp == event["stamp"] and source == event["handle"] for stamp, _, source in asset["entries"])
        ):
            raise ValueError("Authored definition lacks a matching detached event")
        if not (stops["window"][0] <= event["stamp"] < stops["window"][1]):
            raise ValueError("Detached event is outside the native stop window")
        [fields] = [
            emitter["fields"]
            for emitter in asset["object"]["fields"]["868eb76a"]["elements"]
            if emitter["fields"]["3d25b8ce"]["value"] == name
        ]
        cases = [run(image, event, fields, cadence, random) for cadence in (60, 120) for random in (0.125, 0.875)]
        last_age = max(case["firstEmptyFloat32Age"] for case in cases)
        if event["stamp"] + last_age >= stops["window"][1]:
            raise ValueError("Native stop receipt does not cover natural cutoff")
        fail_stop = any(
            row["target"] == event["handle"]
            and row["sequence"] > event["sequence"]
            and row["stamp"] <= event["stamp"] + last_age
            for row in stops["events"]
        )
        if fail_stop:
            raise ValueError("Recorded stop precedes the natural cutoff")
        out.append(
            {
                "resourceKey": key,
                "definition": asset["name"],
                "emitter": name,
                "sourceSha256": asset["sourceSha256"],
                "event": event,
                "cases": cases,
            }
        )
    print(
        json.dumps(
            {
                "kind": "offline-detached-arbitrary-quad-natural-retirement",
                **{key: creations[key] for key in keys},
                "assetsSha256": args.assets_sha256,
                "creationSha256": args.creations_sha256,
                "stopsSha256": args.stops_sha256,
                "systems": out,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
