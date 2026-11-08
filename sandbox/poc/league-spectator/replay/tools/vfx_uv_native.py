"""Recover UV record admission, independently of texture loading or sampling.

The original complex-emitter link predicate reads constants and pointer presence.
Curves are represented by an owned non-null marker; their contents are never
dereferenced by this component. This does not evaluate or render UV transforms.
"""
import math
import struct

import capstone
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES as A, name_hash


FIELDS = {
    "base": {
        "birthUVOffset": (0x1d8, 2, "ValueVector2", 0),
        "birthUvScrollRate": (0x2e0, 2, "ValueVector2", 0),
        "birthUvRotateRate": (0x2f0, 1, "ValueFloat", 0),
        "uvRotation": (0x300, 1, "ValueFloat", 0),
        "particleUVScrollRate": (0x310, 2, "IntegratedValueVector2", 0),
        "particleUVRotateRate": (0x320, 1, "IntegratedValueFloat", 0),
        "uvScale": (0x450, 2, "ValueVector2", 1),
        "flexBirthUVScrollRate": (0x148, 0, "FlexValueVector2", 0),
        "flexBirthUVOffset": (0x1e8, 0, "FlexValueVector2", 0),
        "TextureFlipU": (0xca, -1, "boolean", 1),
        "TextureFlipV": (0xca, -1, "boolean", 2),
    },
    "mult": {
        "birthUVOffsetMult": (0x98, 2, "ValueVector2", 0),
        "birthUvScrollRateMult": (0x48, 2, "ValueVector2", 0),
        "birthUvRotateRateMult": (0x88, 1, "ValueFloat", 0),
        "UvRotationMult": (0x28, 1, "ValueFloat", 0),
        "ParticleIntegratedUvScrollMult": (0x60, 2, "IntegratedValueVector2", 0),
        "ParticleIntegratedUvRotateMult": (0x78, 1, "IntegratedValueFloat", 0),
        "uvScaleMult": (0x38, 2, "ValueVector2", 1),
        "flexBirthUVScrollRateMult": (0x70, 0, "FlexValueVector2", 0),
        "TextureMultFilpU": (0x19, -1, "boolean", 4),
        "TextureMultFilpV": (0x19, -1, "boolean", 8),
    },
}
BLOCKS = [(0x14aa3bf, 0x14aa516), (0x16ffef0, 0x17012d0),
          (0x178e120, 0x178e1bc), (0x16e1d6d, 0x16e2391),
          (0x16fe700, 0x16ff3f0), (0x1701310, 0x1701528)]


def registrations(image, start, end, fields):
    names = {name_hash(n): n for n in fields}
    values, result = {}, {}
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    for inst in decoder.disasm(image[start:end], start):
        ops = inst.op_str.split(", ")
        if inst.mnemonic == "mov" and len(ops) == 2 and ops[0] in ["esi", "edx", "ecx"]:
            try:
                values[ops[0]] = int(ops[1], 0)
            except ValueError:
                values.pop(ops[0], None)
        elif inst.mnemonic == "xor" and len(ops) == 2 and ops[0] == ops[1]:
            values[ops[0]] = 0
        elif inst.mnemonic == "call" and values.get("esi") in names and "edx" in values:
            name = names[values["esi"]]
            offset, width, kind, default = fields[name]
            mask = values.get("ecx", 0) if width == -1 else 0
            if values["edx"] != offset or width == -1 and mask != default:
                raise ValueError(f"Native UV field registration changed: {name}")
            result[name] = {"offset": offset, "width": width, "type": kind,
                            "defaultOrMask": default, "registrationRva": inst.address,
                            "helperRva": int(inst.op_str, 0)}
    if set(result) != set(fields):
        raise ValueError(f"Missing native UV fields: {set(fields)-set(result)}")
    return result


class NativeUv(NativeSpawn):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("UV code differs from pristine client")
        self.layout = {
            "base": registrations(self.image, 0x16fe700, 0x16ff3f0, FIELDS["base"]),
            "mult": registrations(self.image, 0x1701310, 0x1701528, FIELDS["mult"]),
        }
        self.call(0x14aa3bf, {}, 0x14aa516)
        self.call(0x16ffef0, {r.UC_X86_REG_RDI: A["definition"]})
        self.default_definition = bytes(self.u.mem_read(A["definition"], 0x470))
        self.call(0x178e120, {})
        self.default_mult = bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RAX), 0xa8))

    def write_fields(self, at, obj, group):
        for name, (offset, width, kind, default) in FIELDS[group].items():
            if name not in obj:
                continue
            value = obj[name]
            if width == -1:
                # CDTB preserves BIN FLAG as the serialized byte, unlike BOOL.
                if not (type(value) is bool or type(value) is int and value in [0, 1]):
                    raise ValueError(f"Invalid UV boolean {name}: {value!r}")
                byte = self.u.mem_read(at+offset, 1)[0]
                self.put(at+offset, "B", byte | default if value else byte & ~default)
                continue
            if not isinstance(value, dict) or value.get("__type") != kind:
                raise ValueError(f"Invalid UV value type {name}")
            if width == 0:
                flex = 0x10027800
                self.u.mem_write(flex, bytes(0x20))
                self.put(at+offset, "Q", flex)
                if group == "mult":
                    # FlexValueVector2 owns its ValueVector2 at +8; this
                    # predicate checks its constant lanes and dynamic pointer.
                    field = value.get("mValue", {"__type": "ValueVector2"})
                    if field.get("__type") != "ValueVector2":
                        raise ValueError("Invalid mult flex value")
                    lanes = field.get("constantValue", [0, 0])
                    self.validate_value(field, lanes, 2)
                    self.put(flex+8, "ff", *lanes)
                    self.put(flex+0x10, "Q", 0x10027c00 if "dynamics" in field else 0)
                continue
            lanes = value.get("constantValue", default if width == 1 else [default]*width)
            lanes = [lanes] if width == 1 else lanes
            if not isinstance(lanes, list) or len(lanes) != width:
                raise ValueError(f"Invalid UV width {name}")
            self.validate_value(value, lanes, width)
            self.put(at+offset, "f"*width, *lanes)
            self.put(at+offset+8, "Q", 0x10027c00 if "dynamics" in value else 0)

    def validate_value(self, value, lanes, width):
        if not isinstance(lanes, list) or len(lanes) != width or any(type(n) not in [int, float] or not math.isfinite(n) for n in lanes):
            raise ValueError("Invalid UV constant")
        try:
            finite = all(math.isfinite(n) for n in struct.unpack("<"+"f"*width, struct.pack("<"+"f"*width, *lanes)))
        except (OverflowError, struct.error):
            finite = False
        if not finite:
            raise ValueError("Invalid UV float32 constant")
        if "dynamics" in value:
            kind = "VfxAnimatedFloatVariableData" if width == 1 else "VfxAnimatedVector2fVariableData"
            if not isinstance(value["dynamics"], dict) or value["dynamics"].get("__type") != kind:
                raise ValueError("Invalid UV dynamics type")

    def evaluate(self, emitter):
        self.u.mem_write(A["definition"], self.default_definition)
        self.u.mem_write(A["link"], bytes(0xf0))
        self.put(A["link"]+0x10, "Q", A["definition"])
        self.write_fields(A["definition"], emitter, "base")
        if "textureMult" in emitter:
            mult = emitter["textureMult"]
            if not isinstance(mult, dict) or mult.get("__type") != "VfxTextureMultDefinitionData":
                raise ValueError("Invalid UV mult definition")
            self.u.mem_write(0x10027000, self.default_mult)
            self.put(A["definition"]+0x230, "Q", 0x10027000)
            self.write_fields(0x10027000, mult, "mult")
        frame = A["stack"]-0x100
        self.put(frame-0x150, "Q", A["link"])
        self.call(0x16e1d6d, {r.UC_X86_REG_RAX: A["definition"], r.UC_X86_REG_R15: A["link"],
                              r.UC_X86_REG_RBP: frame}, 0x16e1dbe)
        flags = bytes(self.u.mem_read(A["link"]+0xe8, 2))
        if any(n not in [0, 1] for n in flags):
            raise ValueError("Invalid native UV result")
        return {"base": bool(flags[0]), "mult": bool(flags[1])}
