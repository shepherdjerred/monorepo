"""Original legacy-shape quad birth, emitter update and vertex assembly.

Geometry/lifecycle fields are projected explicitly from authored definitions.
Texture/UV/material fields remain separate; no full emitter admission is implied.
"""
import copy
import math
import struct

from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES as A, VALUE_WIDTHS, FLAGS, admissible
from vfx_emitter_native import NativeEmitter, GEOMETRY as G
from vfx_uv_native import registrations


FIELDS = {
    "isSingleParticle": (0x2d0, -1, "boolean", 0x100000),
    "isUniformScale": (0x2d0, -1, "boolean", 8),
    "importance": (0x17, 1, "byte", 0),
    "timeBeforeFirstEmission": (0x218, 1, "float", 0),
    "rotation0": (0x438, 3, "ValueVector3", 0),
}
PROJECTED = set(VALUE_WIDTHS) - {"birthUVOffset"} | set(FLAGS) | {
    "lifetime", "particleLinger", *FIELDS,
}
METADATA = {"__type", "emitterName", "primitive", "SpawnShape", "texture", "textureMult",
            "blendMode", "pass", "miscRenderFlags", "disableBackfaceCull", "texAddressModeBase"}


class QuadProjectionError(ValueError):
    pass


class NativeLegacyQuad(NativeEmitter):
    def __init__(self, package, client):
        super().__init__(package, client)
        self.layout = registrations(self.source.image, 0x16fe700, 0x16ff3f0, FIELDS)
        self.emitter_meta = self.checked_json("vfx-emitter.json", "vfxEmitterSha256")
        self.trails = self.checked_json("vfx-trails.json", "vfxTrailsSha256")

    def prepare_quad(self, emitter):
        if emitter.get("__type") != "VfxEmitterDefinitionData" or set(emitter) - PROJECTED - METADATA:
            raise QuadProjectionError("Unadmitted geometry/lifecycle field")
        shape = emitter.get("SpawnShape", {})
        if shape.get("__type") != "VfxShapeLegacy" or set(shape) - {"__type", "emitOffset"}:
            raise QuadProjectionError("Unadmitted legacy shape")
        if emitter.get("primitive") != {"__type": "VfxPrimitiveArbitraryQuad"}:
            raise QuadProjectionError("Unadmitted quad primitive")
        baseline = {k: copy.deepcopy(v) for k, v in emitter.items()
                    if k in (set(VALUE_WIDTHS)-{"birthUVOffset"}) | set(FLAGS) | {"lifetime", "particleLinger", "blendMode"}}
        baseline.update({"__type": "VfxEmitterDefinitionData", "SpawnShape": {"__type": "{ee39916f}"},
                         "primitive": {"__type": "VfxPrimitiveCameraTrail"}})
        if not admissible(baseline):
            raise QuadProjectionError("Invalid geometry value projection")
        for field in [shape.get("emitOffset", {}), emitter.get("rotation0", {})]:
            check = copy.deepcopy(baseline)
            check["birthScale0"] = field
            if not admissible(check):
                raise QuadProjectionError("Invalid legacy vector value")
        for name in [*FLAGS, *(n for n, f in FIELDS.items() if f[1] == -1)]:
            if name not in emitter:
                continue
            v = emitter[name]
            if not (type(v) is bool or type(v) is int and v in [0, 1]):
                raise QuadProjectionError("Invalid geometry flag")
        if "importance" in emitter and (type(emitter["importance"]) is not int or not 0 <= emitter["importance"] < 6):
            raise QuadProjectionError("Unadmitted importance")
        for name in ["timeBeforeFirstEmission", "lifetime", "particleLinger"]:
            if name in emitter:
                value = emitter[name]
                if type(value) not in [int, float] or not math.isfinite(value):
                    raise QuadProjectionError("Invalid scalar geometry field")
                try:
                    if not math.isfinite(struct.unpack("<f", struct.pack("<f", value))[0]):
                        raise QuadProjectionError("Geometry scalar outside float32")
                except (OverflowError, struct.error) as error:
                    raise QuadProjectionError("Geometry scalar outside float32") from error
        if "blendMode" in emitter and (type(emitter["blendMode"]) is not int or emitter["blendMode"] not in [0, 1, 2, 4]):
            raise QuadProjectionError("Unadmitted quad blend mode")
        graph = super().prepare(baseline)
        # Replace both baseline objects with the matching original constructors.
        self.call(0x17951d0, {r.UC_X86_REG_RDI: A["point"]})
        self.value(A["point"]+8, shape.get("emitOffset", {}), 3)
        self.call(0x17a6390, {r.UC_X86_REG_RDI: A["primitive"]})
        for name, (offset, width, _, mask) in FIELDS.items():
            if name not in emitter:
                continue
            at, v = A["definition"]+offset, emitter[name]
            if width == -1:
                word = struct.unpack("<I", self.u.mem_read(at, 4))[0]
                self.put(at, "I", word | mask if v else word & ~mask)
            elif name == "rotation0":
                self.value(at, v, 3)
            else:
                self.put(at, "B" if name == "importance" else "f", v)
        self.put(A["link"]+0xe8, "BB", 0, 0)
        graph.update({"allocations": list(self.allocations.items()), "nextHeap": self.next_heap,
                      "segments": [{"address": at, "bytesHex": bytes(self.u.mem_read(at, size)).hex()}
                                   for at, size in [(0x10020000, 0x10000), (0x10400000, self.next_heap-0x10400000)]],
                      "authoredFields": sorted(set(emitter) & PROJECTED),
                      "presentationMetadataOnly": sorted(set(emitter) & METADATA - {"__type", "primitive", "SpawnShape"}),
                      "ownedInputs": "Geometry/lifecycle projection; original legacy shape and arbitrary quad constructors. UV records disabled, textures/materials excluded. Unit system/root scale/color, supplied pose/basis/clock/seed; no attachments."})
        return graph

    def reset_quad(self, graph, seed, quality=0):
        self.reset_emitter(graph, seed, self.emitter_meta, quality)

    def frame_quad(self, value):
        time = value["time"]
        if not self.last_time <= time <= 30 or time < 0:
            raise ValueError("Quad emitter clock must advance")
        self.last_time = time
        self.births.clear(); self.math_calls.clear(); self.services.clear()
        self.put(A["system"]+0xfc, "fff", *value["previous"])
        self.put(A["system"]+0x108, "fff", *value["current"])
        self.put(A["system"]+0x1e0, "f"*16, *value["basis"])
        self.u.mem_write(A["stack"]-0x8000, bytes(0x8000))
        self.call(0x1757f10, {r.UC_X86_REG_RDI: A["actor"],
                             r.UC_X86_REG_XMM0: int.from_bytes(struct.pack("<f", time), "little")})
        state = self.snapshot()
        return {"state": state, "geometry": self.render_quad(value["viewPosition"])}

    def render_quad(self, view_position):
        self.u.mem_write(G["context"], bytes(0x3000))
        for offset, pointer in [(0, G["indices"]), (8, G["vertices"]), (0x10, G["draw"]),
                                (0x18, A["actor"]), (0x20, G["view"])]:
            self.put(G["context"]+offset, "Q", pointer)
        self.put(G["view"], "fff", *view_position)
        self.math_calls.clear()
        self.call(0x1730410, {r.UC_X86_REG_RDI: A["primitive"], r.UC_X86_REG_RSI: G["context"]})
        nv, ni = self.q(G["context"]+8)-G["vertices"], self.q(G["context"])-G["indices"]
        count = struct.unpack("<I", self.u.mem_read(self.q(A["actor"]+0xa0)+0x10, 4))[0]
        if nv != count*112 or ni != count*12:
            raise ValueError("Quad geometry output bound")
        return {"verticesHex": bytes(self.u.mem_read(G["vertices"], nv)).hex(),
                "indicesHex": bytes(self.u.mem_read(G["indices"], ni)).hex(),
                "drawHex": bytes(self.u.mem_read(G["draw"], 16)).hex(), "mathCalls": list(self.math_calls)}

    def render_with_uv(self, view_position, uv):
        pool, scratch = self.q(A["actor"]+0xa0), 0x1002f000
        if struct.unpack("<I", self.u.mem_read(pool+0x10, 4))[0] > 1:
            raise ValueError("Single-particle UV composition required")
        saved = [(scratch, bytes(self.u.mem_read(scratch, 64))),
                 (A["link"]+0xe8, bytes(self.u.mem_read(A["link"]+0xe8, 2))),
                 (A["link"]+0x58, bytes(self.u.mem_read(A["link"]+0x58, 8))),
                 (pool+0x78, bytes(self.u.mem_read(pool+0x78, 8))),
                 (pool+0x88, bytes(self.u.mem_read(pool+0x88, 8)))]
        try:
            for key, offset, flag, pointer in [("base", 0, 0xe8, 0x78), ("mult", 32, 0xe9, 0x88)]:
                if uv[key] is not None:
                    self.put(scratch+offset, "ffffff", *uv[key])
                self.put(pool+pointer, "Q", scratch+offset)
                self.put(A["link"]+flag, "B", int(uv[key] is not None))
            self.put(A["link"]+0x58, "Q", A["primitive"] if uv["multBound"] else 0)
            return self.render_quad(view_position)
        finally:
            for at, data in saved:
                self.u.mem_write(at, data)
