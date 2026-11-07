"""Prepare exact-build missile phase/stop metadata from the matching client.

Reads no replay. Only allocation-free constructor tails execute; original bytes
and field registration hashes/offsets are checked against the pinned Mach-O.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as reg
from macho import MachImage


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fnv(name):
    value = 2166136261
    for byte in name.lower().encode("ascii"):
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("client", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    source = MachImage(args.client.read_bytes())
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(source.binary) != profile["sliceSha256"] or sha(image) != profile["decoderImageSha256"]):
        raise ValueError("Missile actor source mismatch")
    base = profile["imageBase"]
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    scratch = 0x10000000
    engine.mem_map(scratch, 0x1000)

    def fragment(start, end, registers):
        engine.mem_write(scratch, b"\xa5" * 0x1000)
        for register, value in registers.items():
            engine.reg_write(register, value)
        engine.emu_start(base + start, base + end, count=1000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != base + end:
            raise ValueError("Missile actor constructor instruction limit")

    fragment(0x8639bb, 0x863a3b, {reg.UC_X86_REG_RBX: scratch})
    actor_defaults = {name: bytes(engine.mem_read(scratch + offset, 1))[0] for name, offset in
        [("renderParticlesAfterDestroy", 0x350), ("phase", 0x368), ("deferredPhase", 0x369),
         ("pendingChildren", 0x36a), ("phaseCount", 0x36b), ("phaseLatch", 0x36d), ("stopped", 0x3c8)]}
    fragment(0x8704ae, 0x8704c3, {reg.UC_X86_REG_RAX: scratch})
    destroy_vtable = struct.unpack("<Q", bytes(engine.mem_read(scratch, 8)))[0] - base
    delay = struct.unpack("<i", bytes(engine.mem_read(scratch + 8, 4)))[0]
    render = bytes(engine.mem_read(scratch + 12, 1))[0]
    fragment(0x8705ae, 0x8705bc, {reg.UC_X86_REG_RAX: scratch})
    hit_vtable = struct.unpack("<Q", bytes(engine.mem_read(scratch, 8)))[0] - base
    roll = bytes(engine.mem_read(scratch + 8, 1))[0]
    if render not in [0, 1] or roll not in [0, 1]:
        raise ValueError("Native behavior default is not boolean")
    fields = {"mDelay": {"offset": 8, "type": "i32", "default": delay},
              "RenderParticlesAfterDestroy": {"offset": 12, "type": "bool", "default": bool(render)},
              "RollForCriticalHitResult": {"offset": 8, "type": "bool", "default": bool(roll)}}
    for name, field in fields.items():
        first, last = (0x872012, 0x87203f) if name == "RollForCriticalHitResult" else (0x871ed0, 0x871f18)
        at = image.find(struct.pack("<I", fnv(name)), first, last)
        if at < 0 or image[at + 4] != 0xba or struct.unpack_from("<I", image, at + 5)[0] != field["offset"]:
            raise ValueError("Missile behavior field registration mismatch")
        field["hash"] = fnv(name)
    for name, at in [("CastOnHit", 0x872009), ("DestroyOnMovementComplete", 0x871ec7)]:
        if struct.unpack_from("<I", image, at)[0] != fnv(name):
            raise ValueError("Missile behavior type registration mismatch")
    blocks = [(0x8639bb, 0x863a3b), (0x8704ae, 0x8704c3), (0x8705ae, 0x8705bc),
        (0x871ea3, 0x871f18), (0x871fe5, 0x87203f), (0x864a60, 0x864b00),
        (0x865150, 0x8651d0), (0x869860, 0x869a00), (0x869b90, 0x869d30),
        (0x86cc70, 0x86d0e0), (0x875640, 0x875870), (0x875870, 0x8758a0),
        (0x8758a0, 0x875940), (0x875940, 0x8759c0), (0x8759c0, 0x8759d0),
        (0x876450, 0x876490), (0x876290, 0x8762b0), (0x8838b0, 0x883910),
        (0x884120, 0x884130), (0x87b6e0, 0x87b780), (0x87a930, 0x87a950),
        (0x878dc1, 0x878e59), (0x86544d, 0x865530), (0x8647be, 0x8649eb),
        (0x86a520, 0x86a540), (0x87bb30, 0x87bbe5)]
    result = {"schema": 1, "build": profile["clientVersion"], "sliceSha256": profile["sliceSha256"],
        "decoderImageSha256": profile["decoderImageSha256"], "actorDefaults": actor_defaults,
        "phaseAdvanceRva": 0x864a60, "phaseNotificationRva": 0x87b6e0,
        "stopRva": 0x865150, "stopNotificationRva": 0x87a930,
        "replicationPhaseBlock": [0x878dc1, 0x878e59], "childAttachedPhaseBlock": [0x86544d, 0x865527],
        "actorMovementPhaseBlock": [0x8647be, 0x8649e2],
        "behaviors": {
            "DestroyOnMovementComplete": {"specVtableRva": destroy_vtable, "factoryRva": 0x869860,
                "runtimeVtableRva": 0x235c300, "phaseRva": 0x8758a0, "frameRva": 0x875940,
                "delayRva": 0x8759c0, "fields": {name: fields[name] for name in ["mDelay", "RenderParticlesAfterDestroy"]}},
            "CastOnHit": {"specVtableRva": hit_vtable, "factoryRva": 0x869b90,
                "runtimeVtableRva": 0x235df20, "phaseRva": 0x8838b0, "frameRva": 0x8838e0,
                "delayRva": 0x883900, "fields": {"RollForCriticalHitResult": fields["RollForCriticalHitResult"]},
                "scope": "Phase/frame callbacks are native no-ops; hit/cast dispatch is not translated"}},
        "sourceBlocks": [],
        "scope": "Phase/deferred-child and stop operations with two component phase/frame callbacks; this is not actor registration, collision/hit dispatch, renderer or particle lifetime"}
    for a, b in blocks:
        if image[a:b] != source.image[a:b]:
            raise ValueError("Actor instructions differ from original client")
        result["sourceBlocks"].append({"startRva": a, "endRva": b, "sha256": sha(image[a:b])})
    destination = args.package / "missile-actors.json"
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["missileActorsSha256"] = sha(destination.read_bytes())
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["missileActorsSha256"], "defaults": actor_defaults, "fields": fields}))


if __name__ == "__main__":
    main()
