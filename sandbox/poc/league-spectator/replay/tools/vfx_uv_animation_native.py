"""Original UV birth fragment and complete base/mult matrix functions.

Flex channels and cached UV scale modifiers are not assembled here. Ordinary
curves use original objects; integrated values run their original post-load.
"""
import ctypes
import json
import math
import struct

from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES as A, sha
from vfx_uv_native import NativeUv, FIELDS, registrations


EXTRA = {"pool": 0x10028000, "mult": 0x10027000,
         "initialBase": 0x10031000, "initialMult": 0x10032000,
         "outputBase": 0x10033000, "outputMult": 0x10034000}
BLOCKS = [(0x175abce, 0x175b011), (0x175fae0, 0x175feb7), (0x175fec0, 0x1760311),
          (0x1488e40, 0x1488e71), (0x1488e80, 0x1488ed7), (0x1488f60, 0x1488fd1),
          (0x177f5b0, 0x177f5dd), (0x177f6e0, 0x177f70d),
          (0x17acaf4, 0x17acb51), (0x17acc25, 0x17acc82)]
INTEGRATED_POSTLOAD = {1: 0x177f5b0, 2: 0x177f6e0}
NORMAL = {group: {name: (offset, width) for name, (offset, width, kind, _) in fields.items()
                  if width > 0 and not kind.startswith("Integrated")} for group, fields in FIELDS.items()}
INTEGRATED = {group: {name: (offset, width) for name, (offset, width, kind, _) in fields.items()
                      if kind.startswith("Integrated")} for group, fields in FIELDS.items()}
EXTRA_FIELDS = {
    "base": {"uvScrollClamp": (0x2d0, -1, "boolean", 0x200), "uvTransformCenter": (0x460, 2, "Vector2", 0)},
    "mult": {"uvScrollAlphaMult": (0x19, -1, "boolean", 1), "uvScrollClampMult": (0x19, -1, "boolean", 2),
             "uvTransformCenterMult": (0x1c, 2, "Vector2", 0)},
}


class UvAdmissionError(ValueError):
    """Unsupported authored UV input, distinct from a failed native execution."""


def finite(value):
    try:
        return type(value) in [float, int] and math.isfinite(struct.unpack("<f", struct.pack("<f", value))[0])
    except (OverflowError, struct.error):
        return False


def validate_value(field, width, integrated=False):
    kind = ("IntegratedValue" if integrated else "Value") + ("Float" if width == 1 else "Vector2")
    if not isinstance(field, dict) or field.get("__type") != kind or set(field)-{"__type", "constantValue", "dynamics"}:
        raise UvAdmissionError("value-shape")
    def vector(value):
        return finite(value) if width == 1 else isinstance(value, list) and len(value) == width and all(map(finite, value))
    if "constantValue" in field and not vector(field["constantValue"]):
        raise UvAdmissionError("value-constant")
    if "dynamics" not in field:
        return
    curve = field["dynamics"]
    if (not isinstance(curve, dict) or curve.get("__type") != ("VfxAnimatedFloatVariableData" if width == 1 else "VfxAnimatedVector2fVariableData")
        or set(curve)-{"__type", "times", "values", "probabilityTables"}):
        raise UvAdmissionError("curve-shape")
    times, values = curve.get("times", []), curve.get("values", [])
    if (not isinstance(times, list) or not isinstance(values, list) or len(times) != len(values)
        or not all(map(finite, times)) or not all(map(vector, values)) or any(a >= b for a, b in zip(times, times[1:]))):
        raise UvAdmissionError("curve-keys")
    tables = curve.get("probabilityTables", [])
    if not isinstance(tables, list) or len(tables) not in [0, width]:
        raise UvAdmissionError("probability-width")
    for table in tables:
        if (not isinstance(table, dict) or table.get("__type") != "VfxProbabilityTableData"
            or set(table)-{"__type", "keyTimes", "keyValues", "singleValue"}):
            raise UvAdmissionError("probability-shape")
        tt, vv = table.get("keyTimes", []), table.get("keyValues", [])
        if (not isinstance(tt, list) or not isinstance(vv, list) or len(tt) != len(vv)
            or not all(map(finite, [*tt, *vv, table.get("singleValue", 1)])) or any(a >= b for a, b in zip(tt, tt[1:]))):
            raise UvAdmissionError("probability-keys")


def project(emitter):
    fields = dict(FIELDS["base"])
    fields.update({"uvScrollClamp": None, "uvTransformCenter": None})
    result = {name: value for name, value in emitter.items() if name in fields}
    if "textureMult" in emitter:
        fields = dict(FIELDS["mult"])
        fields.update({"uvScrollAlphaMult": None, "uvScrollClampMult": None, "uvTransformCenterMult": None})
        result["textureMult"] = {name: value for name, value in emitter["textureMult"].items() if name in fields or name == "__type"}
    return result


def controlled_inputs():
    yield "defaults", {}
    for group in ["base", "mult"]:
        for name, (_, width) in {**NORMAL[group], **INTEGRATED[group]}.items():
            kind = ("IntegratedValue" if name in INTEGRATED[group] else "Value") + ("Float" if width == 1 else "Vector2")
            for variant, value in [
                ("constant", {"__type": kind, "constantValue": 90 if width == 1 else [.25, -.5]}),
                ("curve", {"__type": kind, "dynamics": {"__type": "VfxAnimatedFloatVariableData" if width == 1 else "VfxAnimatedVector2fVariableData",
                 "times": [0, .25, 1], "values": [0, 90, -45] if width == 1 else [[0, 0], [1, -.5], [.25, .75]],
                 "probabilityTables": [{"__type": "VfxProbabilityTableData", "keyTimes": [0, 1], "keyValues": [.5, 1.5]}]*width}}),
            ]:
                obj = {name: value}
                if group == "mult":
                    obj = {"textureMult": {"__type": "VfxTextureMultDefinitionData", **obj}}
                yield f"{group}/{name}/{variant}", obj
        for clamp in [False, True]:
            for flip in [False, True]:
                if group == "base":
                    obj = {"birthUVOffset": {"__type": "ValueVector2", "constantValue": [-1.25, 1.5]},
                           "birthUvScrollRate": {"__type": "ValueVector2", "constantValue": [-.7, .9]},
                           "birthUvRotateRate": {"__type": "ValueFloat", "constantValue": 72},
                           "uvScale": {"__type": "ValueVector2", "constantValue": [2, -.5]},
                           "uvScrollClamp": clamp, "TextureFlipU": flip, "TextureFlipV": flip, "uvTransformCenter": [.25, .75]}
                else:
                    obj = {"textureMult": {"__type": "VfxTextureMultDefinitionData",
                           "birthUVOffsetMult": {"__type": "ValueVector2", "constantValue": [-1.25, 1.5]},
                           "birthUvScrollRateMult": {"__type": "ValueVector2", "constantValue": [-.7, .9]},
                           "birthUvRotateRateMult": {"__type": "ValueFloat", "constantValue": 72},
                           "uvScaleMult": {"__type": "ValueVector2", "constantValue": [2, -.5]},
                           "uvScrollClampMult": clamp, "TextureMultFilpU": flip, "TextureMultFilpV": flip, "uvTransformCenterMult": [.25, .75]}}
                yield f"{group}/combined/clamp{int(clamp)}/flip{int(flip)}", obj


class NativeUvAnimation(NativeUv):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("UV animation code differs from pristine client")
        self.math_calls = []
        self.preparing = False
        self.extra_layout = {
            "base": registrations(self.image, 0x16fe700, 0x16ff3f0, EXTRA_FIELDS["base"]),
            "mult": registrations(self.image, 0x1701310, 0x1701528, EXTRA_FIELDS["mult"]),
        }
        for at, next_rva, expected in [(0x17acaf7, 0x17acafb, 0x177f5b0), (0x17acc28, 0x17acc2c, 0x177f6e0)]:
            if next_rva+struct.unpack_from("<i", self.image, at)[0] != expected:
                raise ValueError("Integrated UV type post-load registration changed")

    def imported(self, uc, address, size, user):
        name = self.source.imports[address-self.base]
        if name == "___bzero":
            if not self.preparing:
                raise ValueError("UV bzero is only admitted during static preparation")
            dest, count = self.u.reg_read(r.UC_X86_REG_RDI), self.u.reg_read(r.UC_X86_REG_RSI)
            if count > 0x100000 or not any(at <= dest and dest+count <= at+size for at, size in self.allocations.items()):
                raise ValueError("UV preparation bzero outside owned allocation")
            if count:
                self.u.mem_write(dest, bytes(count))
            self.services[name] = self.services.get(name, 0)+1
            self.ret()
            return
        if name != "_modff":
            return super().imported(uc, address, size, user)
        value = struct.unpack("<f", struct.pack("<I", self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
        fn = self.crt.modff
        fn.argtypes = [ctypes.c_float, ctypes.POINTER(ctypes.c_float)]
        fn.restype = ctypes.c_float
        integer = ctypes.c_float()
        fraction = fn(value, ctypes.byref(integer))
        target = self.u.reg_read(r.UC_X86_REG_RDI)
        if not A["stack"]-0x8000 <= target <= A["stack"]-4:
            raise ValueError("UV modff result outside owned stack")
        self.put(target, "f", integer.value)
        self.u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<f", fraction), "little"))
        self.math_calls.append({"name": name, "x": value, "integer": integer.value, "result": [fraction]})
        self.ret()

    def reject(self, uc, address, size, user):
        # The base component independently guards prepared-image service
        # patches. This added preparation-only import has already executed its
        # bounded adapter above; its patched instruction must never execute.
        if self.preparing and self.source.imports.get(address-self.base) == "___bzero":
            return
        return super().reject(uc, address, size, user)

    def assemble(self, input_value):
        self.next_heap, self.allocations = 0x10400000, {}
        self.u.mem_write(A["definition"], self.default_definition)
        self.u.mem_write(A["link"], bytes(0xf0))
        self.u.mem_write(A["actor"], bytes(0x128))
        self.u.mem_write(EXTRA["pool"], bytes(0xf0))
        self.put(A["link"]+0x10, "Q", A["definition"])
        self.put(A["actor"]+8, "Q", A["link"])
        self.put(EXTRA["pool"]+0xd8, "Q", A["link"])
        self.put(EXTRA["pool"]+0xe0, "Q", A["actor"])
        if "textureMult" in input_value:
            if input_value["textureMult"].get("__type") != "VfxTextureMultDefinitionData":
                raise UvAdmissionError("mult-type")
            self.u.mem_write(EXTRA["mult"], self.default_mult)
            self.put(A["definition"]+0x230, "Q", EXTRA["mult"])
        for group, obj, at in [("base", input_value, A["definition"]), ("mult", input_value.get("textureMult", {}), EXTRA["mult"])]:
            flex_names = [name for name, (_, width, _, _) in FIELDS[group].items() if width == 0]
            if any(name in obj for name in flex_names):
                raise UvAdmissionError("flex-channel")
            for name, (offset, width) in NORMAL[group].items():
                if name in obj:
                    validate_value(obj[name], width)
                    self.value(at+offset, obj[name], width)
            for name, (offset, width) in INTEGRATED[group].items():
                if name in obj:
                    validate_value(obj[name], width, True)
                    self.value(at+offset, obj[name], width)
                    self.preparing = True
                    try:
                        self.call(INTEGRATED_POSTLOAD[width], {r.UC_X86_REG_RDI: at+offset})
                    finally:
                        self.preparing = False
            flags = [(name, offset, mask) for name, (offset, width, _, mask) in FIELDS[group].items() if width == -1]
            flags += [("uvScrollClamp", 0x2d1, 2)] if group == "base" else [("uvScrollAlphaMult", 0x19, 1), ("uvScrollClampMult", 0x19, 2)]
            for name, offset, mask in flags:
                if name in obj:
                    value = obj[name]
                    if not (type(value) is bool or type(value) is int and value in [0, 1]):
                        raise UvAdmissionError("flag-value")
                    old = self.u.mem_read(at+offset, 1)[0]
                    self.put(at+offset, "B", old | mask if value else old & ~mask)
            name, offset = ("uvTransformCenter", 0x460) if group == "base" else ("uvTransformCenterMult", 0x1c)
            if name in obj:
                lanes = obj[name]
                if not isinstance(lanes, list) or len(lanes) != 2 or not all(map(finite, lanes)):
                    raise UvAdmissionError("pivot-value")
                self.put(at+offset, "ff", *lanes)
        frame = A["stack"]-0x100
        self.put(frame-0x150, "Q", A["link"])
        self.call(0x16e1d6d, {r.UC_X86_REG_RAX: A["definition"], r.UC_X86_REG_R15: A["link"], r.UC_X86_REG_RBP: frame}, 0x16e1dbe)
        flags = bytes(self.u.mem_read(A["link"]+0xe8, 2))
        self.flags = {"base": bool(flags[0]), "mult": bool(flags[1])}
        segments = [(A["definition"], 0x470), (A["link"], 0xf0), (A["actor"], 0x128), (EXTRA["pool"], 0xf0)]
        if "textureMult" in input_value:
            segments.append((EXTRA["mult"], 0xa8))
        if self.next_heap > 0x10400000:
            segments.append((0x10400000, self.next_heap-0x10400000))
        self.graph = {"schema": 1, "input": input_value, "flags": self.flags,
                      "segments": [{"address": at, "bytesHex": bytes(self.u.mem_read(at, count)).hex()} for at, count in segments]}
        return self.graph

    def restore_graph(self, graph):
        self.graph, self.flags = graph, graph["flags"]
        for segment in graph["segments"]:
            self.u.mem_write(segment["address"], bytes.fromhex(segment["bytesHex"]))

    def birth(self, value):
        self.restore_graph(self.graph)
        self.math_calls.clear()
        frame = A["stack"]-0x100
        self.u.mem_write(A["stack"]-0x8000, bytes(0x8000))
        self.put(frame-0x30, "ff", value["chance"], value["emitterAge"])
        self.call(0x175abce, {r.UC_X86_REG_RBX: A["actor"], r.UC_X86_REG_R14: frame-0x38,
                              r.UC_X86_REG_RBP: frame}, 0x175affb)
        records = {"base": bytes(self.u.mem_read(frame-0x70, 0x20)).hex() if self.flags["base"] else None,
                   "mult": bytes(self.u.mem_read(frame-0x270, 0x18)).hex() if self.flags["mult"] else None}
        return {"records": records, "mathCalls": list(self.math_calls)}

    def sample(self, records, value):
        self.restore_graph(self.graph)
        self.math_calls.clear()
        outputs = {}
        for group, entry in [("base", 0x175fae0), ("mult", 0x175fec0)]:
            if records[group] is None:
                outputs[group] = None
                continue
            self.u.mem_write(EXTRA["initial"+group.title()], bytes.fromhex(records[group]))
            output = EXTRA["output"+group.title()]
            self.u.mem_write(output, bytes([0xa5])*0x18)
            self.call(entry, {r.UC_X86_REG_RDI: EXTRA["pool"], r.UC_X86_REG_RSI: EXTRA["initial"+group.title()],
                              r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: output,
                              **{getattr(r, "UC_X86_REG_XMM"+str(index)): int.from_bytes(struct.pack("<f", value[name]), "little")
                                 for index, name in enumerate(["age", "normalizedAge", "lifetime", "chance"])}})
            outputs[group] = bytes(self.u.mem_read(output, 0x18)).hex()
        return {"matrices": outputs, "mathCalls": list(self.math_calls)}
