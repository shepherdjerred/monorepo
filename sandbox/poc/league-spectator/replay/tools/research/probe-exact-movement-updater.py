"""Exercise the 16.23.841.8428 movement updater and boolean clip selector."""

import argparse
import hashlib
import itertools
import json
import struct
import sys
from pathlib import Path

import unicorn
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    cache = (Path.cwd() / ".cache").resolve()
    if not args.output.parent.resolve().is_relative_to(cache) or args.output.exists():
        raise ValueError("Expected a fresh private .cache output")
    binary = args.executable.read_bytes()
    digest = hashlib.sha256(binary).hexdigest()
    if digest != "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7":
        raise ValueError("Expected the exact archived 16.23.841.8428 Mach-O")

    image = MachImage(binary)
    cpu = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    cpu.mem_map(image.base, len(image.image))
    cpu.mem_write(image.base, bytes(image.image))
    arena = 0x10000000
    cpu.mem_map(arena, 0x10000)
    updater, lookup_key, output, actor, actor_table, component_list, entries = (
        arena + offset for offset in (0x100, 0x200, 0x300, 0x1000, 0x5000, 0x5800, 0x5900)
    )
    alternate, link, wrapper, motion, motion_table, provider, provider_owner, provider_table = (
        arena + offset for offset in (0x6000, 0x6100, 0x6200, 0x7000, 0x8000, 0x9000, 0x9100, 0x9200)
    )
    registry, components_call, wrapper_call, provider_call, stack = (
        arena + offset for offset in (0x9300, 0x9400, 0x9500, 0x9600, 0xE008)
    )
    registered_type = image.base + 0x25DB040
    threshold = struct.unpack_from("<f", image.image, 0x2134B5C)[0]

    def write(address, fmt, *values):
        cpu.mem_write(address, struct.pack("<" + fmt, *values))

    def read(address, fmt):
        return struct.unpack("<" + fmt, cpu.mem_read(address, struct.calcsize("<" + fmt)))[0]

    def run(entry, *args):
        write(stack, "Q", arena)
        cpu.reg_write(r.UC_X86_REG_RSP, stack)
        registers = (r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX)
        for register, value in zip(registers[: len(args)], args, strict=True):
            cpu.reg_write(register, value)
        cpu.emu_start(entry, arena, count=1000)
        if cpu.reg_read(r.UC_X86_REG_RIP) != arena:
            raise ValueError(f"Original function did not return from {entry:#x}")
        return cpu.reg_read(r.UC_X86_REG_EAX)

    run(image.base + 0x137A20, updater)
    vtable = read(updater, "Q")
    update_entry = read(vtable + 5 * 8, "Q")
    if (vtable, update_entry) != (image.base + 0x2364F70, image.base + 0x11FBA0):
        raise ValueError("Unexpected original updater vtable or Update entry")
    if not 9.99e-10 < threshold < 1.001e-9:
        raise ValueError("Unexpected original alternate gate threshold")

    write(actor, "Q", actor_table)
    write(actor + 0x10, "Q", actor_table)
    write(actor_table + 0x18, "Q", components_call)
    write(actor_table + 0x688, "Q", wrapper_call)
    write(component_list, "Q", entries)
    write(entries, "Q", registered_type)
    write(entries + 0x10, "Q", link)
    write(link + 0x10, "Q", alternate)
    write(alternate + 0x10, "Q", actor)
    write(wrapper + 0x10, "Q", motion)
    write(motion, "Q", motion_table)
    write(provider + 0x18, "Q", lookup_key)
    write(provider + 0x20, "Q", provider_owner)
    write(provider_owner, "Q", provider_table)
    write(provider_table + 0x40, "Q", provider_call)

    # Invert only the dispatcher's pointer transform for this synthetic object.
    transformed = ((provider ^ 0xD4B0B976) - 0xB58D5B6D) & 0xFFFFFFFFFFFFFFFF
    rotated = transformed ^ 0xFF7815B1
    encoded_provider = (rotated >> 7) | ((rotated & 0x7F) << 57)
    write(actor + 0x3730, "Q", encoded_provider)

    calls = []
    actor_visible = False
    fallback_result = False

    def return_value(engine, _address, _size, specification):
        name, expected_regs, result = specification
        for register, expected in expected_regs:
            if engine.reg_read(register) != expected:
                raise ValueError(f"Unexpected register argument at {name}")
        calls.append(name)
        engine.reg_write(r.UC_X86_REG_RAX, result())
        sp = engine.reg_read(r.UC_X86_REG_RSP)
        engine.reg_write(r.UC_X86_REG_RSP, sp + 8)
        engine.reg_write(r.UC_X86_REG_RIP, read(sp, "Q"))

    for address, name, expected_regs, result in (
        (image.base + 0x162EC40, "registry", (), lambda: registry),
        (
            image.base + 0x14E1B70,
            "lookup",
            ((r.UC_X86_REG_RDI, registry), (r.UC_X86_REG_RSI, lookup_key), (r.UC_X86_REG_RDX, image.base + 0x2504F58)),
            lambda: actor if actor_visible else 0,
        ),
        (components_call, "components", ((r.UC_X86_REG_RDI, actor + 0x10),), lambda: component_list),
        (wrapper_call, "wrapper", ((r.UC_X86_REG_RDI, actor),), lambda: wrapper),
        (
            provider_call,
            "provider",
            ((r.UC_X86_REG_RDI, provider_owner), (r.UC_X86_REG_RSI, lookup_key)),
            lambda: int(fallback_result),
        ),
    ):
        cpu.hook_add(unicorn.UC_HOOK_CODE, return_value, (name, expected_regs, result), address, address)

    cases = []

    def check(name, key, value, expected_calls, **inputs):
        calls.clear()
        sentinel = bytes.fromhex("56789abcdef001230000f7423456789a")
        cpu.mem_write(output, sentinel)
        run(update_entry, updater, key, output)
        actual = bytes(cpu.mem_read(output, len(sentinel)))
        expected = sentinel if value is None else sentinel[:8] + struct.pack("<f", value) + sentinel[12:]
        if actual != expected or calls != expected_calls:
            raise ValueError(f"{name} inputs {inputs}: output={actual.hex()}, calls={calls}")
        cases.append(
            dict(
                case=name,
                inputs=inputs,
                output=read(output + 8, "f"),
                outputWritten=value is not None,
                modeledCalls=list(calls),
            )
        )

    check("null-update-input", 0, None, [])
    check("unresolved-actor", lookup_key, None, ["registry", "lookup"])
    actor_visible = True
    lookup_calls = ["registry", "lookup", "components"]
    for scenario in ("absent", "disabled", "null-alternate", "different-type"):
        write(component_list + 8, "I", int(scenario != "absent"))
        write(entries, "Q", registered_type + int(scenario == "different-type"))
        write(entries + 0x18, "Q", int(scenario != "disabled"))
        write(link + 0x10, "Q", alternate if scenario != "null-alternate" else 0)
        for fallback_result in (False, True):
            check(
                scenario, lookup_key, float(fallback_result), [*lookup_calls, "provider"], providerValue=fallback_result
            )
    write(entries, "Q", registered_type)
    for native_flag, motion_value, path_flag, actor_flag in itertools.product(
        (False, True), (-1.0, threshold, 1.0), (False, True), (False, True)
    ):
        write(motion + 0x260, "I", 0 if native_flag else 0x400)
        write(motion + 0x2AC, "f", motion_value)
        write(actor + 0xC88, "B", 4 if path_flag else 0)
        write(actor + 0x3B39, "B", 16 if actor_flag else 0)
        value = float(path_flag and actor_flag and not (native_flag and motion_value > threshold))
        check(
            "alternate",
            lookup_key,
            value,
            lookup_calls + ["wrapper"] * (1 + native_flag),
            nativeFlag=native_flag,
            motionValue=motion_value,
            pathFlag=path_flag,
            actorFlag=actor_flag,
        )

    definition, context, result, runtime = (arena + offset for offset in (0x9800, 0x9860, 0x9880, 0x9900))
    run(image.base + 0x15FB3C0, definition)
    definition_table = read(definition, "Q")
    factory = read(definition_table + 0x38, "Q")
    if factory != image.base + 0x15DAA00:
        raise ValueError("Unexpected original boolean clip factory")
    true_index, false_index = 17, 29
    write(definition + 0x50, "II", true_index, false_index)

    # Own only allocation and the first child activation handoff. The original
    # constructor, updater and desired-index selector execute in the archive.
    for address, specification in (
        (image.base + 0x14A0300, ("clip-allocation", ((r.UC_X86_REG_RDI, 0x60),), lambda: runtime)),
        (image.base + 0x15AD6F0, ("initial-child-activation", ((r.UC_X86_REG_RDI, runtime),), lambda: 0)),
    ):
        cpu.hook_add(unicorn.UC_HOOK_CODE, return_value, specification, address, address)

    condition_cases = []
    for mid_play, initial in itertools.product((False, True), repeat=2):
        write(definition + 0x40, "B", int(mid_play))
        calls.clear()
        run(factory, result, definition, context)
        if read(result, "Q") != runtime or calls != ["clip-allocation"]:
            raise ValueError("Original boolean clip runtime allocation differs")
        runtime_table = read(runtime, "Q")
        setter = read(runtime_table + 0x58, "Q")
        select = read(runtime_table + 0x1E0, "Q")
        if (setter, select) != (image.base + 0x15AD230, image.base + 0x15AD300):
            raise ValueError("Unexpected original boolean clip methods")
        for step, value in enumerate((initial, not initial, initial)):
            calls.clear()
            write(output + 8, "f", float(value))
            cpu.reg_write(r.UC_X86_REG_XMM0, read(output + 8, "I"))
            run(setter, runtime)
            index = run(select, runtime)
            moving = value if mid_play else initial
            expected = true_index if moving else false_index
            if index != expected or calls != (["initial-child-activation"] if step == 0 else []):
                raise ValueError("Original boolean clip selection differs")
            condition_cases.append(
                dict(
                    changeAnimationMidPlay=mid_play,
                    initial=initial,
                    step=step,
                    updaterValue=float(value),
                    desiredIndex=index,
                    modeledCalls=list(calls),
                )
            )

    receipt = dict(
        build="16.23.841.8428",
        executableSha256=digest,
        probeSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        constructorRva="0x137a20",
        vtableRva="0x2364f70",
        updaterRva="0x11fba0",
        alternatePredicateRva="0x41c930",
        fallbackDispatcherRva="0xb90c0",
        alternateMotionThreshold=threshold,
        inputSource="Synthetic memory and explicitly modeled provider calls",
        replayAdmission=False,
        replayRefusal=(
            "The replay-to-native actor construction, component selection and gate state are unbound. "
            "Recorded waypoint displacement alone cannot supply the original updater's inputs."
        ),
        cases=cases,
        booleanClip=dict(
            inputSource="Supplied boolean values, resolved child indices, and modeled initial activation",
            factoryRva="0x15daa00",
            setterRva="0x15ad230",
            selectorRva="0x15ad300",
            cases=condition_cases,
        ),
    )
    with args.output.open("x", encoding="utf-8") as output_file:
        json.dump(receipt, output_file, indent=2)
        output_file.write("\n")
    print(f"Verified {len(cases)} updater and {len(condition_cases)} boolean clip controls. Saved {args.output}")


if __name__ == "__main__":
    main()
