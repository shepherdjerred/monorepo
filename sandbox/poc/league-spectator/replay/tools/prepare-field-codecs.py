"""Extract exact field-storage byte permutations from pinned packet reader code.

This prepares static tables without reading any replay. The original game-code
blocks are executed on known inputs, with bijection and mixed-byte checks.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random

import unicorn
from unicorn import x86_const as registers

SLICE_SHA256 = "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
BLOCKS = {
    "heroNetworkId": (0x10c019a, 0x10c0217, 4, 0, "memory"),
    "heroSlot": (0x103fa09, 0x103fa2e, 1, 16, "al"),
    "heroCreationPosition": (0x10c1f08, 0x10c1f4a, 12, 0, "memory"),
    "rosterScalar136": (0x1297003, 0x12970d8, 4, 0, "r9d"),
    "heroScalar104": (0x1041409, 0x104142a, 4, 0, "r8d"),
    "animationScalar20": (0x100fc58, 0x100fcc6, 4, 0, "eax"),
    "animationScalar52": (0x107128d, 0x1071319, 4, 0, "eax"),
    "attackScalar8": (0x13b38f4, 0x13b39ce, 4, 0, "r8d"),
    "attackNetId12": (0x13bb20c, 0x13bb28c, 4, 0, "memory"),
    "attackByte16": (0x114d7d, 0x114da4, 1, 0, "al"),
    "attackByte17": (0x114e54, 0x114e74, 1, 0, "al"),
    "attackTargetPosition": (0x13bb8a2, 0x13bb9f1, 12, 0, "memory"),
    "attackNetId48": (0x13b3f2c, 0x13b3fab, 4, 0, "memory"),
    "castNetId48": (0x82a053, 0x82a122, 4, 0x168, "eax"),
    "castSequence": (0x82a129, 0x82a1c8, 4, 0x8c, "eax"),
    "castLevel": (0x82a1d0, 0x82a22e, 2, 0x90, "eax"),
    "castAttackSpeedModifier": (0x82a232, 0x82a2e1, 4, 0x94, "eax"),
    "castOwnerId": (0x82a2ec, 0x82a360, 4, 0, "eax"),
    "castSpellHash": (0x829fef, 0x82a010, 4, 0, "edi-bytes"),
    "movementSyncId": (0x558a21, 0x558af3, 4, 0, "eax"),
    "movementCount": (0x5589d5, 0x558a0a, 2, 0, "ecx"),
    "laneSpawnNetworkId": (0xfc8a0d, 0xfc8ae2, 4, 0, "eax"),
    "laneSpawnType": (0xfc8942, 0xfc894c, 1, 32, "packet-rsi"),
    "npcNetworkId": (0x6edafe, 0x6edb98, 4, 0, "eax"),
    "npcCreationPosition": (0x6edcee, 0x6eddca, 12, 100, "packet-rsi"),
    "npcSkinId": (0x6edeaa, 0x6edf16, 4, 68, "packet-rsi"),
    "deathKillerId": (0x6e8508, 0x6e8596, 4, 0, "eax"),
    "deathRespawnSeconds": (0xc6421, 0xc64c4, 4, 0, "eax"),
    "heroDeathKillerId": (0xc5f1e, 0xc5fac, 4, 0, "eax"),
    "heroDeathRespawnSeconds": (0xc6051, 0xc60f4, 4, 0, "eax"),
    "respawnTimer": (0xf59f7, 0xf5a39, 4, 0, "eax"),
    "respawnPosition": (0x15c901, 0x15ca70, 8, 20, "packet-rsi"),
    "missileElapsedSeconds": (0x8795fd, 0x8796a3, 4, 0x228, "packet-rbx"),
    "missileRecordedPosition": (0x8796dc, 0x879996, 12, 0x21c, "packet-rbx"),
    "missileCreationPosition": (0x874ec9, 0x874f3a, 12, 0x20, "packet-rsi"),
    "castTargetPosition": (0x82a5ad, 0x82a72f, 12, 0x30, "packet-r14"),
    "missileSpeed": (0x88b172, 0x88b241, 4, 0x54, "packet-r14"),
    "castNetworkId": (0x82a509, 0x82a5a7, 4, 0xdc, "packet-r14"),
    "missilePhaseTarget": (0x87b6ea, 0x87b719, 1, 16, "packet-rsi"),
    "missilePresentationByte": (0x87b8b4, 0x87b8db, 1, 16, "packet-rsi"),
    "castSourcePosition": (0x82b619, 0x82b825, 12, 0x20, "packet-r14"),
    "castSourceFlags": (0x82b319, 0x82b323, 1, 0xd8, "packet-r14"),
    "castOverrideFlag14d": (0x82c6f8, 0x82c70e, 1, 0x44, "packet-r14"),
    "castOverrideScalar134": (0x82c718, 0x82c803, 4, 0xd0, "packet-r14"),
    "missileControllerScalarB4": (0x88b247, 0x88b2e6, 4, 0x2c, "packet-r14"),
    "missileControllerScalarB0": (0x88b2e6, 0x88b3c3, 4, 0x1f4, "packet-r14"),
    "missilePendingChildren": (0x878dc1, 0x878ddf, 1, 0x210, "packet-rbx"),
    "missileReplicationPhase": (0x878e28, 0x878e50, 1, 0x25c, "packet-rbx"),
    "missileInitialPresentationByte": (0x87a8f2, 0x87a90c, 1, 0x9c, "packet-rbx"),
}
DIRECT_BLOCKS = {"castNetId48", "castSequence", "castLevel", "castAttackSpeedModifier", "castOwnerId", "castSpellHash", "attackByte16", "attackByte17", "movementSyncId", "movementCount", "laneSpawnNetworkId", "laneSpawnType", "npcNetworkId", "npcCreationPosition", "npcSkinId", "deathKillerId", "deathRespawnSeconds", "heroDeathKillerId", "heroDeathRespawnSeconds", "respawnTimer", "respawnPosition"}
REGISTER_OUTPUTS = {"castOwnerId":registers.UC_X86_REG_ESI,"attackByte16":registers.UC_X86_REG_EAX,"attackByte17":registers.UC_X86_REG_R13D,"movementSyncId":registers.UC_X86_REG_EDX,"movementCount":registers.UC_X86_REG_EDX,"laneSpawnNetworkId":registers.UC_X86_REG_ESI,"laneSpawnType":registers.UC_X86_REG_EAX,"npcNetworkId":registers.UC_X86_REG_ESI,"npcSkinId":registers.UC_X86_REG_EDX,"deathKillerId":registers.UC_X86_REG_ESI,"deathRespawnSeconds":registers.UC_X86_REG_EAX,"heroDeathKillerId":registers.UC_X86_REG_ESI,"heroDeathRespawnSeconds":registers.UC_X86_REG_EAX,"respawnTimer":registers.UC_X86_REG_ESI}
DIRECT_TABLES = {"attackByte17":0x20cb570,"movementSyncId":0x20d1630,"movementCount":0x20d1630}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_text())
    image = (args.package / "image.bin").read_bytes()
    if profile["sliceSha256"] != SLICE_SHA256 or hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"]:
        raise ValueError("Field-codec source mismatch")
    DIRECT_BLOCKS.update({"missileElapsedSeconds", "missileRecordedPosition", "missileCreationPosition", "castTargetPosition", "missileSpeed", "castNetworkId", "missilePhaseTarget", "missilePresentationByte", "castSourcePosition", "castSourceFlags", "castOverrideFlag14d", "castOverrideScalar134"})
    REGISTER_OUTPUTS["missileElapsedSeconds"] = registers.UC_X86_REG_EAX
    REGISTER_OUTPUTS["missileSpeed"] = registers.UC_X86_REG_EAX
    REGISTER_OUTPUTS["castNetworkId"] = registers.UC_X86_REG_EAX
    REGISTER_OUTPUTS["missilePhaseTarget"] = registers.UC_X86_REG_EAX
    REGISTER_OUTPUTS["missilePresentationByte"] = registers.UC_X86_REG_ESI
    REGISTER_OUTPUTS["castSourceFlags"] = registers.UC_X86_REG_ECX
    REGISTER_OUTPUTS["castOverrideFlag14d"] = registers.UC_X86_REG_EAX
    REGISTER_OUTPUTS["castOverrideScalar134"] = registers.UC_X86_REG_EAX
    DIRECT_BLOCKS.update({"missileControllerScalarB4", "missileControllerScalarB0"})
    REGISTER_OUTPUTS["missileControllerScalarB4"] = registers.UC_X86_REG_EAX
    REGISTER_OUTPUTS["missileControllerScalarB0"] = registers.UC_X86_REG_EAX
    DIRECT_BLOCKS.update({"missilePendingChildren", "missileReplicationPhase", "missileInitialPresentationByte"})
    for name in ["missilePendingChildren", "missileReplicationPhase", "missileInitialPresentationByte"]:
        REGISTER_OUTPUTS[name] = registers.UC_X86_REG_EAX
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x10000)
    initial = engine.context_save()
    codecs = {}
    for name, (start, end, size, offset, mode) in BLOCKS.items():
        def encode(data):
            if mode == 'edi-bytes':
                output=[]
                for value in data:
                    engine.context_restore(initial)
                    engine.reg_write(registers.UC_X86_REG_RBP,0x10008000)
                    engine.reg_write(registers.UC_X86_REG_EDI,value)
                    engine.emu_start(base+start,base+end,count=10000)
                    if engine.reg_read(registers.UC_X86_REG_RIP)!=base+end:raise ValueError('Byte decoder instruction limit')
                    output.append(engine.reg_read(registers.UC_X86_REG_EDI)&255)
                return bytes(output)
            engine.context_restore(initial)
            engine.mem_write(0x10000000, bytes(1024))
            engine.mem_write(0x10000000 + (offset if mode in ['packet-rsi', 'packet-rbx', 'packet-r14'] else 0), data)
            engine.reg_write(registers.UC_X86_REG_RDI, 0x10000000)
            engine.reg_write(registers.UC_X86_REG_RBX, 0x10000000)
            engine.reg_write(registers.UC_X86_REG_RSI, 0x10000000)
            if name in DIRECT_BLOCKS:
                engine.reg_write(registers.UC_X86_REG_R15, base+DIRECT_TABLES.get(name,0x20d7800))
            if name == "npcSkinId":
                # Established by LEA R13 at 0x6edb17 in the same handler.
                engine.reg_write(registers.UC_X86_REG_R13, base+0x20d6660)
            if mode == "packet-rbx":
                # S-box loaded into R14 at 0x878dd1 in the same handler.
                engine.reg_write(registers.UC_X86_REG_R14, base+0x20d8080)
            if mode == "packet-r14":
                engine.reg_write(registers.UC_X86_REG_R14, 0x10000000)
            if name in ["missileSpeed", "missileControllerScalarB0"]:
                engine.reg_write(registers.UC_X86_REG_R12, base+0x20d8440)
            if name in ["castSourcePosition", "castOverrideFlag14d", "castOverrideScalar134"]:
                # R9 at 0x82ad3c, copied to RBX at 0x82b3af.
                engine.reg_write(registers.UC_X86_REG_RBX, base+0x20d7800)
            engine.reg_write(registers.UC_X86_REG_RAX, data[0] if mode == "al" else 0)
            if mode == "cl":
                engine.reg_write(registers.UC_X86_REG_RCX, data[0])
            if mode in ["r9d", "r8d", "eax", "ecx"]:
                register = {"r9d": registers.UC_X86_REG_R9D, "r8d": registers.UC_X86_REG_R8D, "eax": registers.UC_X86_REG_EAX,"ecx":registers.UC_X86_REG_ECX}[mode]
                engine.reg_write(register, int.from_bytes(data, "little"))
            engine.emu_start(base + start, base + end, count=10000)
            if engine.reg_read(registers.UC_X86_REG_RIP) != base + end:
                raise ValueError("Field-codec instruction limit")
            if name == "respawnPosition":
                return b"".join((engine.reg_read(reg)&0xffffffff).to_bytes(4,"little")
                                for reg in [registers.UC_X86_REG_XMM0, registers.UC_X86_REG_XMM2])
            if name in REGISTER_OUTPUTS:
                return (engine.reg_read(REGISTER_OUTPUTS[name])&((1<<(size*8))-1)).to_bytes(size,"little")
            # This original block writes its decoded vector to the RDI output,
            # separate from the packet at RSI+0x20.
            output_offset = {"missileCreationPosition": 0, "castTargetPosition": 0xd4}.get(name, offset)
            return bytes(engine.mem_read(0x10000000 + output_offset, size))

        columns = [[] for _ in range(size)]
        for value in range(256):
            for lane, encoded in enumerate(encode(bytes([value]) * size)):
                columns[lane].append(encoded)
        if any(len(set(column)) != 256 for column in columns):
            raise ValueError(f"Non-bijective field codec {name}")
        rng = random.Random(0x1621)
        for _ in range(256):
            data = bytes(rng.randrange(256) for _ in range(size))
            if encode(data) != bytes(columns[lane][value] for lane, value in enumerate(data)):
                raise ValueError(f"Cross-byte dependency in {name}")
        codecs[name] = {"entryRva": start, "endRva": end, "bytes": size, "inputMode": mode,
                        "nativeDirection": "decode" if name in DIRECT_BLOCKS else "encode",
                        "decode": columns if name in DIRECT_BLOCKS else [[column.index(value) for value in range(256)] for column in columns]}
    # The packet initializer reads the same scalar through another native getter.
    # Establish byte-wise equivalence before sharing the decoded cast field.
    rng = random.Random(0x134178)
    inputs = [bytes([v]) * 4 for v in range(256)] + [bytes(rng.randrange(256) for _ in range(4)) for _ in range(256)]
    for data in inputs:
        engine.context_restore(initial)
        engine.mem_write(0x10000000, bytes(0x10000))
        engine.mem_write(0x10000178, data)
        engine.reg_write(registers.UC_X86_REG_R14, 0x10000000)
        engine.reg_write(registers.UC_X86_REG_RBX, 0x10000800)
        engine.reg_write(registers.UC_X86_REG_R12, base + 0x20d8440)
        engine.emu_start(base + 0x88afce, base + 0x88b0ed, count=10000)
        actual = engine.reg_read(registers.UC_X86_REG_ECX).to_bytes(4, "little")
        expected = bytes(codecs["castOverrideScalar134"]["decode"][lane][v] for lane, v in enumerate(data))
        if engine.reg_read(registers.UC_X86_REG_RIP) != base + 0x88b0ed or actual != expected:
            raise ValueError("Cast and packet override getters disagree")
    result = {"schema": 1, "status": "field-candidate", "clientVersion": profile["clientVersion"],
              "protocolDigest": profile["protocolDigest"], "sliceSha256": SLICE_SHA256,
              "decoderImageSha256": profile["decoderImageSha256"], "codecs": codecs,
              "gameplayMeaningsVerified": False,
              "equivalentGetters": [{"field": "castOverrideScalar134", "entryRva": 0x88afce,
                  "endRva": 0x88b0ed, "inputOffset": 0x178, "probes": len(inputs)}]}
    output = args.package / "field-codecs.json"
    output.write_text(json.dumps(result), encoding="utf-8")
    profile["fieldCodecsSha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "codecs": list(codecs), "mixedInputsPerCodec": 256,
                      "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
