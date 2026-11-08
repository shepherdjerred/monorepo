"""Prepare isolated decoder functions from the exact 16.21 macOS release.

Static preparation only: reads no replay and launches no game. Requires keystone-
engine 0.9.2 to assemble bounded allocator and memory-service models. Semantic
compatibility with Windows replay events remains a separate validation layer.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from keystone import Ks, KS_ARCH_X86, KS_MODE_64
from macho import MachImage
import unicorn
from unicorn import x86_const as registers

BINARY_SHA256 = "0414ccc2ddfd3ba209c75d9c8f6ee6611ff1de11426afdf54007df12df219fab"
THIN_SHA256 = "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
WINDOWS_SHA256 = "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    binary = args.binary.read_bytes()
    if hashlib.sha256(binary).hexdigest() != BINARY_SHA256:
        raise ValueError("Unsupported macOS executable hash")
    macho = MachImage(binary)
    if hashlib.sha256(macho.binary).hexdigest() != THIN_SHA256:
        raise ValueError("Unexpected x86-64 slice hash")
    image = macho.image
    storage = len(image)
    image.extend(bytes(4096))
    # This exact reader checks the object at +0x70 before accepting wire fields.
    # +8 is initialized to 4 at RVA 0x66d1d8 in this exact executable.
    struct.pack_into("<Q", image, 0x246d4f0, macho.base + storage)
    image[storage + 0x70] = 1
    image[storage + 8] = 4
    # Isolated stack-canary storage replaces the loader's external data binding.
    # It is constant only inside this packet-function sandbox, never in the game.
    canary_slots = [rva for rva, name in macho.data_imports.items() if name == "___stack_chk_guard"]
    if canary_slots != [0x22e0310]:
        raise ValueError("Unexpected exact-build stack-canary import")
    for rva in canary_slots:
        struct.pack_into("<Q", image, rva, macho.base + storage + 0x100)
    struct.pack_into("<Q", image, storage + 0x100, 0x72d4c6315b8a0900)
    assembler = Ks(KS_ARCH_X86, KS_MODE_64)
    patches = []

    def patch(rva, label, assembly, import_stub=False):
        code = bytes(assembler.asm(assembly)[0])
        if import_stub or len(code) > 6:
            # Import slots and small allocation wrappers branch to owned helper
            # storage. Never overwrite neighboring original functions.
            helper = len(image)
            image.extend(code)
            displacement = helper - (rva + 5)
            code = b"\xe9" + struct.pack("<i", displacement) + b"\x90"
            patches.append({"rva": helper, "service": label, "bytesHex": bytes(image[helper:]).hex()})
        if rva < 0 or rva + len(code) > len(image):
            raise ValueError("Modeled service exceeds image")
        image[rva:rva + len(code)] = code
        patches.append({"rva": rva, "service": label, "bytesHex": code.hex()})

    def allocator(register):
        return f"""
            mov r10, 0x103ff000; mov eax, dword ptr [r10]; mov rcx, {register};
            add rcx, 15; and rcx, -16; cmp rcx, 16; jae aligned;
            mov ecx, 16; aligned: add rcx, rax; cmp rcx, 0x1ff000;
            ja invalid; mov dword ptr [r10], ecx; add rax, 0x10200000; ret;
            invalid: ud2
        """

    memcpy = """
        cmp rdx, 0x1ff000; ja invalid; mov rax, rdi; mov rcx, rdx;
        cmp rdi, rsi; jbe forward; lea r8, [rsi+rdx]; cmp rdi, r8; jae forward;
        lea rsi, [rsi+rdx-1]; lea rdi, [rdi+rdx-1]; std; rep movsb; cld; ret;
        forward: cld; rep movsb; ret; invalid: ud2
    """
    memset = """
        cmp rdx, 0x1ff000; ja invalid; mov r8, rdi; mov rax, rsi;
        mov rcx, rdx; cld; rep stosb; mov rax, r8; ret; invalid: ud2
    """
    bzero = """
        cmp rsi, 0x1ff000; ja invalid; mov rcx, rsi; xor eax, eax;
        cld; rep stosb; ret; invalid: ud2
    """
    # ROFL carries the packet object-context varuint in its framing `param`.
    # Supply that context separately rather than consuming it twice in the body.
    patch(0x1614300, "ROFL object-context already extracted", "mov al, 1; ret")
    for rva in [0x1474a30, 0x14766c0, 0x149a2f0, 0x149a460, 0x149a4c0]:
        patch(rva, "bounded byte allocation in RDI", allocator("rdi"))
    patch(0x1499f00, "bounded pool allocation in RSI", allocator("rsi"))
    patch(0x149a390, "bounded aligned allocation", """
        mov r10, 0x103ff000; mov eax, dword ptr [r10]; mov rcx, rsi;
        cmp rcx, 8; jae alignment; mov ecx, 8;
        alignment: cmp rcx, 0x10000; ja invalid; lea rdx, [rcx-1];
        test rcx, rdx; jne invalid; add rax, 0x10200008; add rax, rdx;
        not rdx; and rax, rdx; lea r8, [rax+rdi]; sub r8, 0x10200000;
        add r8, 15; and r8, -16; cmp r8, 0x1ff000; ja invalid;
        mov dword ptr [r10], r8d; ret; invalid: ud2
    """)
    for rva in [0x1474970, 0x149a350, 0x149a0f0, 0x149a420, 0x149a520]:
        patch(rva, "isolated arena free", "ret")
    services = {"_malloc": allocator("rdi"), "_free": "ret", "_memcpy": memcpy,
                "_memmove": memcpy, "___memcpy_chk": memcpy, "___memmove_chk": memcpy,
                "_memset": memset, "___memset_chk": memset, "___bzero": bzero,
                "___cxa_guard_acquire": "xor eax, eax; test byte ptr [rdi], 1; sete al; ret",
                "___cxa_guard_release": "or byte ptr [rdi], 1; ret",
                "___cxa_atexit": "xor eax, eax; ret"}
    for rva, name in macho.imports.items():
        if name in services:
            patch(rva, name, services[name], import_stub=True)
    image.extend(bytes((-len(image)) % 4096))
    # Execute constructors offline for every factory opcode. Browser payload
    # decoding starts from their exact arena snapshots; no match is read here.
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(macho.base, len(image))
    engine.mem_write(macho.base, bytes(image))
    engine.mem_map(0x10000000, 0x400000)
    engine.mem_map(0x20000000, 0x200000)
    initial = engine.context_save()
    dirty_pages = set()

    def image_write(uc, access, address, size, value, _):
        start = address - macho.base
        dirty_pages.update(range(start & ~4095, start + size, 4096))

    engine.hook_add(unicorn.UC_HOOK_MEM_WRITE, image_write, begin=macho.base, end=macho.base + len(image) - 1)

    def call(address, first=0, second=0):
        engine.reg_write(registers.UC_X86_REG_RSP, 0x201ff008)
        engine.mem_write(0x201ff008, struct.pack("<Q", 0x10009000))
        engine.reg_write(registers.UC_X86_REG_RDI, first)
        engine.reg_write(registers.UC_X86_REG_RSI, second)
        engine.emu_start(address, 0x10009000, count=1000000)
        if engine.reg_read(registers.UC_X86_REG_RIP) != 0x10009000:
            raise ValueError("Constructor instruction limit")

    constructors = bytearray()
    packets, unavailable = {}, {}
    for opcode in range(0x4f2):
        engine.context_restore(initial)
        for page in dirty_pages:
            engine.mem_write(macho.base + page, bytes(image[page:page + 4096]))
        dirty_pages.clear()
        engine.mem_write(0x201f0000, bytes(0x10000))
        engine.mem_write(0x10200000, bytes(0x1ff000))
        engine.mem_write(0x103ff000, bytes(8))
        engine.mem_write(0x10000000, bytes(8))
        try:
            call(macho.base + 0xfecbb0, 0x10000000, opcode)
            obj = struct.unpack("<Q", engine.mem_read(0x10000000, 8))[0]
            if obj == 0:
                unavailable[opcode] = "no packet factory"
                continue
            if obj != 0x10200000:
                raise ValueError("Unexpected constructor arena object")
            table = struct.unpack("<Q", engine.mem_read(obj, 8))[0]
            if not macho.base <= table < macho.base + len(image) - 24:
                raise ValueError("Invalid constructor vtable")
            _, entry, size_entry = struct.unpack("<3Q", engine.mem_read(table, 24))
            call(size_entry, obj)
            object_size = engine.reg_read(registers.UC_X86_REG_RAX)
            used = struct.unpack("<I", engine.mem_read(0x103ff000, 4))[0]
            if not 16 <= object_size <= used <= 0x1ff000:
                raise ValueError("Invalid constructor arena size")
            packets[opcode] = {"entryRva": entry - macho.base, "objectSize": object_size,
                               "offset": len(constructors), "length": used}
            constructors.extend(engine.mem_read(0x10200000, used))
        except (unicorn.UcError, ValueError) as error:
            unavailable[opcode] = str(error)
    profile = {
        "schema": 1, "status": "structural-candidate", "callingConvention": "sysv-x86_64",
        "clientVersion": "16.21.829.8620", "protocolDigest": "20e09df23c66b85e",
        "clientSha256": BINARY_SHA256, "sliceSha256": THIN_SHA256,
        "sourcePlatform": "macos-x64", "replayPlatform": "windows-x64",
        "windowsClientSha256": WINDOWS_SHA256, "imageBase": macho.base,
        "sizeOfImage": len(image), "decoderImageSha256": hashlib.sha256(image).hexdigest(),
        "factoryRva": 0xfecbb0, "factoryTableRva": 0xff99e4, "maxOpcode": 0x4f1,
        "decoders": {}, "modeledServices": patches,
        "runtimeObjects": [{"pointerRva": 0x246d4f0, "storageRva": storage, "byteValues": {"0x08": 4, "0x70": 1}}],
        "semanticFieldsVerified": False, "staticInitializersExecuted": False,
        "modeledDataImports": [{"name": "___stack_chk_guard", "rva": rva} for rva in canary_slots],
        "packets": packets, "unavailableOpcodes": unavailable,
        "constructorImageBytes": len(constructors),
        "constructorImageSha256": hashlib.sha256(constructors).hexdigest(),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "image.bin").write_bytes(image)
    (args.output / "constructors.bin").write_bytes(constructors)
    (args.output / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "imageBytes": len(image), "status": profile["status"],
                      "constructors": len(packets), "unavailable": len(unavailable)}))


if __name__ == "__main__":
    main()
