"""Native structural oracle for an exact prepared profile and local packet samples.

This compares execution engines, not gameplay meanings or live League state.
All output stays in an ignored local research directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as registers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("samples", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--trace-scalars", action="store_true", help="Research-only host-order scalar observations before field storage encoding")
    parser.add_argument("--normalize-casts", action="store_true", help="Research-only exact-build cast conversion; never executes gameplay handlers")
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_text())
    image = (args.package / "image.bin").read_bytes()
    constructors = (args.package / "constructors.bin").read_bytes()
    if profile["schema"] != 1 or profile["status"] != "structural-candidate":
        raise ValueError("Unsupported structural profile")
    for data, expected in [(image, profile["decoderImageSha256"]),
                           (constructors, profile["constructorImageSha256"])]:
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("Prepared package hash mismatch")
    samples = json.loads(args.samples.read_text())
    if "packetSamples" in samples:
        if samples["executable"]["sha256"] != profile["windowsClientSha256"]:
            raise ValueError("Inspection executable mismatch")
        samples = {"build": samples["replay"]["build"], "protocol": samples["replay"]["protocol"],
                   "packets": samples["packetSamples"]}
    if (samples["build"] != profile["clientVersion"] or
            samples["protocol"] != profile["protocolDigest"]):
        raise ValueError("Sample build mismatch")
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    base = profile["imageBase"]
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x400000)
    engine.mem_map(0x20000000, 0x200000)
    initial = engine.context_save()
    invalid_access = []
    dirty_pages = set()

    def image_write(uc, access, address, size, value, _):
        start = address - base
        dirty_pages.update(range(start & ~4095, start + size, 4096))

    engine.hook_add(unicorn.UC_HOOK_MEM_WRITE, image_write, begin=base, end=base + len(image) - 1)

    def invalid_memory(uc, access, address, size, value, _):
        stack = uc.reg_read(registers.UC_X86_REG_RSP)
        invalid_access.append({"access": access, "address": hex(address), "size": size,
                               "stack": bytes(uc.mem_read(stack, 64)).hex()})
        return False

    engine.hook_add(unicorn.UC_HOOK_MEM_INVALID, invalid_memory)
    observations = {}
    scalar_trace = []
    conversion_writes = []
    conversion_active = False
    if args.normalize_casts:
        def conversion_write(uc, access, address, size, value, _):
            if conversion_active:
                conversion_writes.append({'offset':address-0x10004000,'size':size,'pc':uc.reg_read(registers.UC_X86_REG_RIP)-base})
        engine.hook_add(unicorn.UC_HOOK_MEM_WRITE,conversion_write,begin=0x10004000,end=0x100041ff)
    if args.trace_scalars:
        if profile['sliceSha256'] != '6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b':
            raise ValueError('Scalar observation entry does not match executable slice')
        def scalar_return(uc, address, size, _):
            destination = uc.reg_read(registers.UC_X86_REG_RBX)
            stack = uc.reg_read(registers.UC_X86_REG_RSP)
            caller = struct.unpack('<Q', uc.mem_read(stack, 8))[0]
            scalar_trace.append({'destination': destination, 'entryRva': caller-base,
                                 'bits': uc.reg_read(registers.UC_X86_REG_EAX)})
        engine.hook_add(unicorn.UC_HOOK_CODE, scalar_return, begin=base+0x1423509, end=base+0x1423509)
    for key, sample in samples["packets"].items():
        opcode = str(sample["opcode"]) if "opcode" in sample else key
        payload = bytes.fromhex(sample["payloadHex"])
        if not 0 <= int(opcode) <= profile["maxOpcode"] or len(payload) > 0x1f0000 or not 0 <= sample["param"] <= 0xffffffff:
            raise ValueError("Invalid native sample input")
        identity = {"opcode": int(opcode), "payloadSha256": hashlib.sha256(payload).hexdigest(), "param": sample["param"]}
        config = profile["packets"].get(opcode)
        if config is None:
            observations[key] = {"status": "unprepared", **identity}
            continue
        engine.context_restore(initial)
        for page in dirty_pages:
            engine.mem_write(base + page, image[page:page + 4096])
        dirty_pages.clear()
        invalid_access.clear()
        scalar_trace.clear()
        engine.mem_write(0x10000000, bytes(0x400000))
        engine.mem_write(0x201f0000, bytes(0x10000))
        offset, length = config["offset"], config["length"]
        engine.mem_write(0x10200000, constructors[offset:offset + length])
        engine.mem_write(0x103ff000, struct.pack("<Q", length))
        engine.mem_write(0x1020000c, struct.pack("<I", sample["param"]))
        engine.mem_write(0x10010000, payload)
        engine.mem_write(0x10008000, struct.pack("<Q", 0x10010000))
        engine.mem_write(0x201ff008, struct.pack("<Q", 0x10009000))
        for register, value in [(registers.UC_X86_REG_RDI, 0x10200000),
                                (registers.UC_X86_REG_RSI, 0x10008000),
                                (registers.UC_X86_REG_RDX, 0x10010000 + len(payload)),
                                (registers.UC_X86_REG_RSP, 0x201ff008)]:
            engine.reg_write(register, value)
        try:
            engine.emu_start(base + config["entryRva"], 0x10009000, count=5000000)
            if engine.reg_read(registers.UC_X86_REG_RIP) != 0x10009000:
                raise ValueError("Instruction limit")
            consumed = struct.unpack("<Q", engine.mem_read(0x10008000, 8))[0] - 0x10010000
            used = struct.unpack("<I", engine.mem_read(0x103ff000, 4))[0]
            accepted = engine.reg_read(registers.UC_X86_REG_RAX) & 255 == 1
            if not 0 <= consumed <= len(payload) or used > 0x1ff000:
                raise ValueError("Packet/arena bounds exceeded")
            observations[key] = {
                "status": "complete" if accepted and consumed == len(payload) else "incomplete",
                **identity,
                "accepted": accepted, "consumed": consumed, "input": len(payload),
                "object": bytes(engine.mem_read(0x10200000, config["objectSize"])).hex(),
                "heap": bytes(engine.mem_read(0x10200000, used)).hex(),
            }
            if args.trace_scalars:
                observations[key]['scalarTrace'] = scalar_trace.copy()
            if args.normalize_casts and int(opcode) == 1027:
                if profile['sliceSha256'] != '6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b':
                    raise ValueError('Cast conversion entries do not match executable slice')
                destination = 0x10004000
                engine.mem_write(destination, bytes(0x2000))
                conversion_writes.clear()
                conversion_active = True
                try:
                    # The game constructor reads a runtime catalog. Observe only
                    # conversion writes into owned zeroed scratch; unwritten bytes
                    # do not represent initialized game state.
                    for function, second in [(0x829fa0,0x10200018)]:
                        engine.mem_write(0x201ff008,struct.pack('<Q',0x10009000))
                        for register,value in [(registers.UC_X86_REG_RDI,destination),(registers.UC_X86_REG_RSI,second),(registers.UC_X86_REG_RSP,0x201ff008)]:
                            engine.reg_write(register,value)
                        engine.emu_start(base+function,0x10009000,count=5000000)
                        if engine.reg_read(registers.UC_X86_REG_RIP)!=0x10009000:raise ValueError('Cast conversion instruction limit')
                    normalized_used=struct.unpack('<I',engine.mem_read(0x103ff000,4))[0]
                    if normalized_used>0x1ff000:raise ValueError('Cast conversion arena overflow')
                    observations[key]['normalization']={'status':'complete','initialization':'zeroed research scratch; game constructor not executed; unwritten fields unknown','object':bytes(engine.mem_read(destination,512)).hex(),'writes':conversion_writes.copy(),'heap':bytes(engine.mem_read(0x10200000,normalized_used)).hex()}
                except(unicorn.UcError,ValueError)as error:
                    observations[key]['normalization']={'status':'error','error':str(error),'rip':hex(engine.reg_read(registers.UC_X86_REG_RIP)),'partialObject':bytes(engine.mem_read(destination,512)).hex(),'writes':conversion_writes.copy()}
                finally:
                    conversion_active=False
        except (unicorn.UcError, ValueError) as error:
            observations[key] = {"status": "error", "error": str(error), **identity,
                                    "rip": hex(engine.reg_read(registers.UC_X86_REG_RIP)),
                                    "invalidAccess": invalid_access.copy()}
    report = {"schema": 1, "clientVersion": profile["clientVersion"],
              "decoderImageSha256": profile["decoderImageSha256"],
              "constructorImageSha256": profile["constructorImageSha256"],
              "semanticFieldsVerified": False, "observations": observations}
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    counts = {status: sum(o["status"] == status for o in observations.values())
              for status in ["complete", "incomplete", "error", "unprepared"]}
    print(json.dumps({"samples": len(observations), **counts}))


if __name__ == "__main__":
    main()
