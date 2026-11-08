"""Point-shape arbitrary quads using the shared strict geometry projection."""
import copy
import math

from unicorn import x86_const as r
from vfx_legacy_quad_native import NativeLegacyQuad, QuadProjectionError
from vfx_spawn_native import ADDRESSES as A


class NativePointQuad(NativeLegacyQuad):
    def prepare_point_quad(self, emitter):
        shape = emitter.get("SpawnShape", {})
        if shape.get("__type") != "{ee39916f}" or set(shape)-{"__type", "emitOffset"}:
            raise QuadProjectionError("Unadmitted point shape")
        offset = shape.get("emitOffset", [0,0,0])
        if not isinstance(offset,list) or len(offset)!=3 or any(type(v) not in [int,float] or not math.isfinite(v) for v in offset):
            raise QuadProjectionError("Invalid point offset")
        # Reuse the same strict field validation, native value preparation and
        # original arbitrary-quad constructor. Its transient legacy shape is
        # replaced before this graph is serialized or any particle is born.
        projected = copy.deepcopy(emitter)
        projected["SpawnShape"] = {"__type":"VfxShapeLegacy", "emitOffset":{"constantValue":offset,"__type":"ValueVector3"}}
        graph = self.prepare_quad(projected)
        self.u.mem_write(A["point"],bytes(0x100))
        self.call(0x179556e,{r.UC_X86_REG_RAX:A["point"]},0x179558c)
        self.put(A["point"]+8,"fff",*offset)
        graph["segments"] = [{"address":at,"bytesHex":bytes(self.u.mem_read(at,size)).hex()}
            for at,size in [(0x10020000,0x10000),(0x10400000,self.next_heap-0x10400000)]]
        graph["shapeType"] = "{ee39916f}"
        graph["ownedInputs"] = "Original point shape, arbitrary-quad birth/update/removal/writer. Shared strict geometry fields. Supplied actor/system basis, clock, root scales, quality and seed. UV/materials separate. No full effect creation."
        return graph
