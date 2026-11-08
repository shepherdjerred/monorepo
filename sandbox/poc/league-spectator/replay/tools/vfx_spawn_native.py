"""Owned native particle birth/pool component, not a League process or frame loop.

Static emitter graphs are prepared offline. Per-match clocks, poses and seeds
remain caller inputs. The runtime constructor stops before material acquisition;
the complete birth and pool insertion functions subsequently execute unchanged.
"""
import ctypes
import hashlib
import json
import math
from pathlib import Path
import struct

import capstone
import unicorn
from unicorn import x86_const as r
from macho import MachImage


def sha(data):
    return hashlib.sha256(data).hexdigest()


ADDRESSES = {name: 0x10000000 + offset for name, offset in {
    "stop": 0, "stack": 0x10008, "definition": 0x20000, "link": 0x21000,
    "actor": 0x22000, "system": 0x23000, "point": 0x24000, "primitive": 0x25000,
    "context": 0x26000, "tls": 0x28000, "stream": 0x29000, "seedReady": 0x2a000,
    "objectReady": 0x2b000, "manager": 0x2c000, "resource": 0x2d000, "systemDefinition": 0x2e000,
}.items()}
SERVICES = [0x1474a30, 0x149a2f0, 0x14766c0, 0x1474970, 0x149a350,
            0x1fee65a, 0x1fee660, 0x1feea44, 0x1feea4a, 0x1fee666, 0x1feea50,
            0x1fee624, 0x1fee62a, 0x1fee606]
VECTORS = {name: (offset, stride) for name, offset, stride in [
    ("life", 8, 8), ("initial", 0x18, 0x70), ("matrices", 0x28, 0x40),
    ("particle", 0x38, 0xac), ("motion", 0x48, 0x24), ("uv", 0x58, 0x20),
    ("multUv", 0x68, 0x18), ("unknown78", 0x78, 0x18), ("unknown88", 0x88, 0x18),
    ("attributes", 0x98, 0x2c), ("tiling", 0xa8, 8), ("odometer", 0xb8, 4), ("ordinal", 0xc8, 4),
]}
VALUE_WIDTHS = {"rate": 1, "particleLifetime": 1, "birthColor": 4, "Color": 4,
                "birthScale0": 3, "scale0": 3, "birthRotation0": 3, "bindWeight": 1, "birthUVOffset": 2}
FLAGS = ["particleIsLocalOrientation", "isLocalOrientation", "isRandomStartFrame"]
ALLOWED = set(VALUE_WIDTHS) | set(FLAGS) | {"__type", "particleLinger", "lifetime", "emitterName",
    "SpawnShape", "primitive", "blendMode", "pass", "texture", "numFrames", "texDiv"}


def name_hash(name):
    result = 0x811c9dc5
    for byte in name.lower().encode():
        result = ((result ^ byte) * 0x1000193) & 0xffffffff
    return result


def field_layout(image):
    """Recover registrations from original code; never infer an adjacent layout."""
    hashes = {name_hash(name): name for name in ALLOWED}
    result, values = {}, {}
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for inst in decoder.disasm(image[0x16fe700:0x16ff3f0], 0x16fe700):
        operands = inst.op_str.split(", ")
        if inst.mnemonic == "mov" and len(operands) == 2 and operands[0] in ["esi", "edx", "ecx"]:
            try:
                values[operands[0]] = int(operands[1], 0)
            except ValueError:
                values.pop(operands[0], None)
        elif inst.mnemonic == "xor" and len(operands) == 2 and operands[0] == operands[1]:
            values[operands[0]] = 0
        elif inst.mnemonic == "call" and values.get("esi") in hashes and "edx" in values:
            name = hashes[values["esi"]]
            result[name] = {"offset": values["edx"], "helperRva": int(inst.op_str, 0),
                            "mask": values.get("ecx", 0), "registrationRva": inst.address,
                            "hash": f'{values["esi"]:08x}'}
    needed = set(VALUE_WIDTHS) | set(FLAGS) | {"lifetime", "particleLinger", "texDiv", "numFrames", "blendMode"}
    if not needed <= result.keys():
        raise ValueError(f"Missing native emitter registrations: {needed-result.keys()}")
    return result


def admissible(emitter):
    if emitter.get("__type") != "VfxEmitterDefinitionData" or set(emitter) - ALLOWED:
        return False
    def numeric(value):
        try:
            return type(value) in [int, float] and math.isfinite(struct.unpack("<f", struct.pack("<f", value))[0])
        except (OverflowError, struct.error):
            return False
    def vector(value, width):
        return numeric(value) if width == 1 else isinstance(value, list) and len(value) == width and all(numeric(v) for v in value)
    shape, primitive = emitter.get("SpawnShape", {}), emitter.get("primitive", {})
    if shape.get("__type") != "{ee39916f}" or set(shape) - {"__type", "emitOffset"}:
        return False
    if "emitOffset" in shape and not vector(shape["emitOffset"], 3):
        return False
    if primitive.get("__type") != "VfxPrimitiveCameraTrail" or set(primitive) - {"__type", "mTrail"}:
        return False
    trail = primitive.get("mTrail", {})
    if trail and trail.get("__type") != "VfxTrailDefinitionData":
        return False
    if set(trail) - {"__type", "mMode", "mCutoff", "mBirthTilingSize", "mSmoothingMode", "mMaxAddedPerFrame"}:
        return False
    for name, width in [*VALUE_WIDTHS.items(), ("tiling", 3)]:
        field = trail.get("mBirthTilingSize", {}) if name == "tiling" else emitter.get(name, {})
        if set(field) - {"__type", "constantValue", "dynamics"}:
            return False
        types = {1: ("ValueFloat", "VfxAnimatedFloatVariableData"), 2: ("ValueVector2", "VfxAnimatedVector2fVariableData"),
                 3: ("ValueVector3", "VfxAnimatedVector3fVariableData"), 4: ("ValueColor", "VfxAnimatedColorVariableData")}
        if field and field.get("__type") != types[width][0]:
            return False
        if "constantValue" in field and not vector(field["constantValue"], width):
            return False
        curve = field.get("dynamics", {})
        if set(curve) - {"__type", "times", "values", "probabilityTables"}:
            return False
        if curve and curve.get("__type") != types[width][1]:
            return False
        times, values = curve.get("times", []), curve.get("values", [])
        if (len(times) != len(values) or not all(numeric(t) for t in times)
            or not all(vector(v, width) for v in values) or any(a >= b for a, b in zip(times, times[1:]))):
            return False
        tables = curve.get("probabilityTables", [])
        if len(tables) not in [0, width]:
            return False
        for table in tables:
            if set(table) - {"__type", "keyTimes", "keyValues", "singleValue"}:
                return False
            if table.get("__type") != "VfxProbabilityTableData":
                return False
            tt, tv = table.get("keyTimes", []), table.get("keyValues", [])
            if (len(tt) != len(tv) or not all(numeric(v) for v in [*tt, *tv, table.get("singleValue", 1)])
                or any(a >= b for a, b in zip(tt, tt[1:]))):
                return False
    return True


class NativeSpawn:
    def __init__(self, package, client):
        self.package = package
        self.profile = json.loads((package / "profile.json").read_bytes())
        self.image = (package / "image.bin").read_bytes()
        self.source = MachImage(client.read_bytes())
        if (self.profile["clientVersion"] != "16.21.829.8620"
            or self.profile["protocolDigest"] != "20e09df23c66b85e"
            or sha(self.image) != self.profile["decoderImageSha256"]
            or sha(self.source.binary) != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"):
            raise ValueError("Native spawn source mismatch")
        self.birth_meta = self.checked_json("vfx-birth.json", "vfxBirthSha256")
        self.value_meta = self.checked_json("vfx-values.json", "vfxValuesSha256")
        self.base = self.profile["imageBase"]
        self.u = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
        self.u.mem_map(self.base, len(self.image)); self.u.mem_write(self.base, self.image)
        self.u.mem_map(0x10000000, 0x2000000)
        self.initial = self.u.context_save()
        self.blocks, self.allocations, self.services, self.births, self.math_calls = {}, {}, {}, [], []
        self.next_heap = 0x10400000
        self.crt = ctypes.CDLL("ucrtbase.dll")
        for name in ["sinf", "cosf", "sqrtf", "acosf", "atan2f", "fmodf", "powf"]:
            fn = getattr(self.crt, name)
            fn.argtypes = [ctypes.c_float] * (2 if name in ["atan2f", "fmodf", "powf"] else 1)
            fn.restype = ctypes.c_float
        self.u.mem_write(ADDRESSES["tls"], b"\xc3")
        self.slots = {self.base + self.birth_meta["random"]["tls"][name]: ADDRESSES[name]
                      for name in ["stream", "seedReady", "objectReady"]}
        for descriptor in self.slots:
            self.put(descriptor, "Q", ADDRESSES["tls"])
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.tls, begin=ADDRESSES["tls"], end=ADDRESSES["tls"])
        for at in SERVICES:
            self.u.hook_add(unicorn.UC_HOOK_CODE, self.service, begin=self.base+at, end=self.base+at)
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.capture_birth, begin=self.base+0x175bac0, end=self.base+0x175bac0)
        for at in self.source.imports:
            if at not in SERVICES:
                self.u.hook_add(unicorn.UC_HOOK_CODE, self.imported, begin=self.base+at, end=self.base+at)
        for patch in self.profile["modeledServices"]:
            if patch["rva"] not in SERVICES:
                self.u.hook_add(unicorn.UC_HOOK_CODE, self.reject, begin=self.base+patch["rva"],
                                end=self.base+patch["rva"]+len(bytes.fromhex(patch["bytesHex"]))-1)
        self.u.hook_add(unicorn.UC_HOOK_BLOCK, self.check_block, begin=self.base, end=self.base+len(self.image)-1)

    def checked_json(self, name, key):
        raw = (self.package / name).read_bytes()
        if sha(raw) != self.profile[key]:
            raise ValueError(f"Stale {name}")
        return json.loads(raw)

    def put(self, address, fmt, *values):
        self.u.mem_write(address, struct.pack("<"+fmt, *values))

    def q(self, address):
        return struct.unpack("<Q", self.u.mem_read(address, 8))[0]

    def allocate(self, size, fill=0):
        if not 0 < size < 0x100000 or self.next_heap + size > 0x12000000:
            raise ValueError("Native spawn allocation bound")
        address = self.next_heap
        self.next_heap = (address+size+15) & ~15
        self.allocations[address] = size
        self.u.mem_write(address, bytes([fill])*size)
        return address

    def ret(self):
        sp = self.u.reg_read(r.UC_X86_REG_RSP)
        self.u.reg_write(r.UC_X86_REG_RIP, self.q(sp)); self.u.reg_write(r.UC_X86_REG_RSP, sp+8)

    def service(self, uc, address, size, user):
        at = address-self.base
        self.services[hex(at)] = self.services.get(hex(at), 0)+1
        dest = self.u.reg_read(r.UC_X86_REG_RDI)
        if at in [0x1474a30, 0x149a2f0, 0x14766c0]:
            self.u.reg_write(r.UC_X86_REG_RAX, self.allocate(dest, 0xa5))
        elif at in [0x1474970, 0x149a350]:
            if dest and dest not in self.allocations:
                raise ValueError("Unowned native spawn free")
        elif at in [0x1fee65a, 0x1fee660, 0x1feea44, 0x1feea4a, 0x1fee666, 0x1feea50]:
            src, n = self.u.reg_read(r.UC_X86_REG_RSI), self.u.reg_read(r.UC_X86_REG_RDX)
            if not 0x10000000 <= dest <= 0x12000000-n:
                raise ValueError("Native spawn copy/set bound")
            if n:
                self.u.mem_write(dest, bytes([src & 255])*n if at in [0x1fee666, 0x1feea50] else bytes(self.u.mem_read(src, n)))
            self.u.reg_write(r.UC_X86_REG_RAX, dest)
        elif at == 0x1fee624:
            self.u.reg_write(r.UC_X86_REG_RAX, 1)
        elif at == 0x1fee62a:
            self.u.mem_write(dest, b"\1")
        elif at == 0x1fee606:
            self.u.reg_write(r.UC_X86_REG_RAX, 0)
        else:
            raise ValueError("Unadmitted native spawn service")
        self.ret()

    def tls(self, uc, address, size, user):
        self.u.reg_write(r.UC_X86_REG_RAX, self.slots[self.u.reg_read(r.UC_X86_REG_RDI)])

    def imported(self, uc, address, size, user):
        name = self.source.imports[address-self.base]
        scalar = lambda reg: struct.unpack("<f", struct.pack("<I", self.u.reg_read(reg) & 0xffffffff))[0]
        x, y = scalar(r.UC_X86_REG_XMM0), scalar(r.UC_X86_REG_XMM1)
        if name == "___sincosf_stret":
            result = [self.crt.sinf(x), self.crt.cosf(x)]
        elif name[1:] in ["sinf", "cosf", "sqrtf", "acosf", "atan2f", "fmodf", "powf"]:
            args = [x, y] if name[1:] in ["atan2f", "fmodf", "powf"] else [x]
            result = [getattr(self.crt, name[1:])(*args)]
        else:
            raise ValueError(f"Unadmitted native spawn import {name}")
        self.u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<"+"f"*len(result), *result), "little"))
        self.math_calls.append({"name": name, "x": x, "result": result})
        self.ret()

    def reject(self, uc, address, size, user):
        raise ValueError(f"Unadmitted modeled spawn service {address-self.base:x}")

    def check_block(self, uc, address, size, user):
        at = address-self.base
        if at in SERVICES or at in self.source.imports:
            return
        if self.image[at:at+size] != self.source.image[at:at+size]:
            raise ValueError(f"Spawn block differs from pristine client {at:x}")
        self.blocks[at] = {"rva": at, "size": size, "sha256": sha(self.image[at:at+size])}

    def capture_birth(self, uc, address, size, user):
        pointers = {"birth": (r.UC_X86_REG_RSI, 0xdc), "uv": (r.UC_X86_REG_RDX, 0x20), "multUv": (r.UC_X86_REG_RCX, 0x20)}
        self.births.append({name+"Hex": bytes(self.u.mem_read(pointer, n)).hex() if pointer else None
                            for name, (register, n) in pointers.items() if (pointer := self.u.reg_read(register)) is not None})
        # Observation only: the original pool insertion executes after this hook.

    def call(self, entry, regs, end=None):
        self.u.context_restore(self.initial)
        self.put(ADDRESSES["stack"], "Q", ADDRESSES["stop"])
        self.u.reg_write(r.UC_X86_REG_RSP, ADDRESSES["stack"])
        for register, value in regs.items():
            self.u.reg_write(register, value)
        expected = self.base+end if end else ADDRESSES["stop"]
        if end:
            self.u.ctl_remove_cache(self.base+entry, expected)
        self.u.emu_start(self.base+entry, expected, count=5000000)
        if self.u.reg_read(r.UC_X86_REG_RIP) != expected:
            raise ValueError("Native spawn instruction bound")

    def array(self, values):
        at = self.allocate(max(4, len(values)*4))
        self.put(at, "f"*len(values), *values)
        return at

    def value(self, at, field, width):
        if "constantValue" in field:
            self.put(at, "f"*width, *([field["constantValue"]] if width == 1 else field["constantValue"]))
        if "dynamics" not in field:
            return
        meta = self.birth_meta["randomizedValues"][str(width)]
        dynamic = self.allocate(0x100)
        start, end = meta["constructorBlock"]
        self.call(start, {r.UC_X86_REG_RAX: dynamic}, end)
        curve = field["dynamics"]
        times, values = curve.get("times", []), curve.get("values", [])
        self.put(dynamic+meta["timeOffset"], "QI", self.array(times), len(times))
        self.put(dynamic+meta["valueOffset"], "QI", self.array(values if width == 1 else [v for row in values for v in row]), len(values))
        for lane, table in enumerate(curve.get("probabilityTables", [])):
            target = self.allocate(0x40)
            start, end = self.value_meta["probability"]["constructorBlock"]
            self.call(start, {r.UC_X86_REG_RAX: target}, end)
            tt, tv = table.get("keyTimes", []), table.get("keyValues", [])
            self.put(target, "QI", self.array(tt), len(tt)); self.put(target+0x10, "QI", self.array(tv), len(tv))
            self.put(target+0x20, "f", table.get("singleValue", 1))
            self.call(self.value_meta["probability"]["postLoadRva"], {r.UC_X86_REG_RDI: target})
            self.put(dynamic+8+lane*8, "Q", target)
        self.call(meta["postLoadRva"], {r.UC_X86_REG_RDI: dynamic})
        self.put(at+(0x10 if width >= 3 else 8), "Q", dynamic)

    def prepare(self, emitter):
        if not admissible(emitter):
            raise ValueError("Unsupported emitter graph")
        a, b = ADDRESSES, self.base
        self.u.mem_write(0x10020000, bytes(0x10000))
        self.next_heap, self.allocations = 0x10400000, {}
        self.call(0x14aa3bf, {}, 0x14aa516)
        self.call(0x16ffef0, {r.UC_X86_REG_RDI: a["definition"]})
        self.call(0x179556e, {r.UC_X86_REG_RAX: a["point"]}, 0x179558c)
        self.put(a["point"]+8, "fff", *emitter["SpawnShape"].get("emitOffset", [0, 0, 0]))
        self.call(0x17a7584, {r.UC_X86_REG_RDI: a["primitive"]}, 0x17a75bd)
        trail = emitter["primitive"].get("mTrail", {})
        self.value(a["primitive"]+0x10, trail.get("mBirthTilingSize", {}), 3)
        for field, offset, fmt in [("mCutoff", 0x28, "f"), ("mMaxAddedPerFrame", 0x2c, "i"),
                                   ("mMode", 0x30, "B"), ("mSmoothingMode", 0x31, "B")]:
            if field in trail:
                self.put(a["primitive"]+offset, fmt, trail[field])
        self.put(a["definition"]+0x60, "Q", a["primitive"]); self.put(a["definition"]+0x238, "Q", a["point"])
        layout = field_layout(self.source.image)
        for name, width in VALUE_WIDTHS.items():
            if name in emitter:
                self.value(a["definition"]+layout[name]["offset"], emitter[name], width)
        for name in ["lifetime", "particleLinger"]:
            if name in emitter:
                self.put(a["definition"]+layout[name]["offset"], "f", emitter[name])
        for name in FLAGS:
            if name in emitter:
                field = layout[name]; at = a["definition"]+field["offset"]
                word = struct.unpack("<I", self.u.mem_read(at, 4))[0]
                self.put(at, "I", word | field["mask"] if emitter[name] else word & ~field["mask"])
        for name, fmt, default in [("numFrames", "H", 1), ("blendMode", "B", 1)]:
            if name in emitter:
                self.put(a["definition"]+layout[name]["offset"], fmt, emitter.get(name, default))
        if "texDiv" in emitter:
            self.put(a["definition"]+layout["texDiv"]["offset"], "ff", *emitter["texDiv"])
        self.put(a["link"]+0x10, "Q", a["definition"])
        self.put(a["link"]+0x1c, "II", 0xffffffff, 0xffffffff)
        self.put(a["link"]+0xe0, "II", 0xffffffff, 0xffffffff)
        self.put(a["link"]+0xe8, "B", int("birthUVOffset" in emitter))
        for offset in [0x150, 0x1b0]:
            self.put(a["system"]+offset, "ff", 1, 1)
        self.put(a["system"]+0x1b8, "ffff", 1, 1, 1, 1)
        self.put(a["system"]+0x1cc, "f", 1)
        self.call(0x14896f0, {r.UC_X86_REG_RDI: a["system"]+0x1e0})
        self.put(a["system"]+0x1d8, "Q", a["resource"])
        self.put(a["resource"]+0x38, "Q", a["systemDefinition"])
        return {"schema": 1, "addresses": a, "allocations": list(self.allocations.items()), "nextHeap": self.next_heap,
                "segments": [{"address": start, "bytesHex": bytes(self.u.mem_read(start, size)).hex()} for start, size in
                             [(0x10020000, 0x10000), (0x10400000, self.next_heap-0x10400000)]],
                "globals": [{"rva": 0x256c9c0, "bytesHex": bytes(self.u.mem_read(b+0x256c9c0, 0x180)).hex()}],
                "authoredFields": sorted(set(emitter)-{"__type"}),
                "presentationMetadataOnly": [name for name in ["emitterName", "texture", "pass"] if name in emitter],
                "ownedInputs": "No mesh/bone/attachment, no system acceleration flag, unit scales, UV presence supplied from authored field; original material acquisition and its binding predicate are not executed"}

    def reset(self, graph, seed):
        a, b = ADDRESSES, self.base
        for segment in graph["segments"]:
            self.u.mem_write(segment["address"], bytes.fromhex(segment["bytesHex"]))
        for segment in graph["globals"]:
            self.u.mem_write(b+segment["rva"], bytes.fromhex(segment["bytesHex"]))
        self.next_heap, self.allocations = graph["nextHeap"], dict(graph["allocations"])
        self.u.mem_write(a["tls"], b"\xc3")
        self.put(b+0x246dfd0, "Q", a["manager"])
        self.put(a["stream"], "QQIB", b+0x234b720, 1, 0, 0); self.put(a["objectReady"], "B", 1)
        self.call(0x1756780, {r.UC_X86_REG_RDI: a["actor"], r.UC_X86_REG_RSI: a["system"], r.UC_X86_REG_RDX: a["link"]}, 0x1756a26)
        self.call(0x14910e0, {r.UC_X86_REG_RDI: seed})

    def step(self, input_value):
        a = ADDRESSES
        if not 0 <= input_value["count"] <= 1000:
            raise ValueError("Birth count must already be capped by the caller")
        self.births.clear(); self.services.clear(); self.math_calls.clear()
        self.put(a["system"]+0xfc, "fff", *input_value["previous"])
        self.put(a["system"]+0x108, "fff", *input_value["current"])
        self.put(a["context"]+0x18, "ffff", input_value["time"], input_value["normalizedAge"], 1, input_value["dt"])
        self.u.mem_write(a["stack"]-0x8000, bytes(0x8000))
        self.call(0x1758a70, {r.UC_X86_REG_RDI: a["actor"], r.UC_X86_REG_RSI: a["context"], r.UC_X86_REG_RDX: input_value["count"]})
        pool = self.q(a["actor"]+0xa0)
        vectors = {}
        for name, (offset, stride) in VECTORS.items():
            pointer = self.q(pool+offset)
            count = struct.unpack("<I", self.u.mem_read(pool+offset+8, 4))[0]
            if count > 4096 or pointer and not 0x10400000 <= pointer <= self.next_heap-count*stride:
                raise ValueError("Native pool output bound")
            vectors[name] = {"count": count, "hex": bytes(self.u.mem_read(pointer, count*stride)).hex() if count else ""}
        return {"births": list(self.births), "vectors": vectors, "rngHex": bytes(self.u.mem_read(a["stream"]+8, 12)).hex(),
                "actorHex": bytes(self.u.mem_read(a["actor"], 0x128)).hex(),
                "poolHex": bytes(self.u.mem_read(pool, 0xf0)).hex(), "services": dict(self.services), "mathCalls": list(self.math_calls)}
