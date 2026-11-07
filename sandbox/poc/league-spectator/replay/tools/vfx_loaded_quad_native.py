"""Native quad simulation from complete post-loaded asset objects.

The owned unit-scale environment remains supplied. No authored emitter fields
are projected or discarded. Terrain queries and child effect factories require
additional engine context and are rejected before simulation.
"""
import struct

from unicorn import x86_const as r
from vfx_legacy_quad_native import NativeLegacyQuad
from vfx_spawn_native import ADDRESSES as A
from vfx_emitter_native import GEOMETRY as G


class LoadedQuadAdmissionError(ValueError):
    pass


class NativeLoadedQuad(NativeLegacyQuad):
    def __init__(self,*args):
        self.library_inputs=[]
        super().__init__(*args)

    def imported(self,uc,address,size,user):
        name=self.source.imports[address-self.base]
        names={"___sincosf_stret","_sinf","_cosf","_sqrtf","_acosf","_atan2f","_fmodf","_powf","_expf","_modff"}
        if name not in names:return super().imported(uc,address,size,user)
        args=[struct.unpack("<f",struct.pack("<I",self.u.reg_read(reg)&0xffffffff))[0]
              for reg in [r.UC_X86_REG_XMM0,r.UC_X86_REG_XMM1]]
        if name not in ["_atan2f","_fmodf","_powf"]:args=args[:1]
        before=len(self.math_calls)
        super().imported(uc,address,size,user)
        if len(self.math_calls)!=before+1:raise ValueError("Loaded quad library observation missing")
        result=self.math_calls[-1]
        self.library_inputs.append({"name":name,"args":args,"result":result["result"],
            **({"integer":result["integer"]} if "integer" in result else {})})

    def frame_quad(self,value):
        self.library_inputs=[]
        return super().frame_quad(value)

    def prepare_loaded(self,state):
        if state["phase"]!="native-postload-callbacks-executed" or state["pendingLinkFixups"] or state["mathCalls"]:
            raise ValueError("Unprepared native emitter state")
        obj,heap=bytes.fromhex(state["objectHex"]),bytes.fromhex(state["heapHex"])
        start=state["heapStart"];end=start+len(heap)
        if len(obj)!=0x470 or not 0x10400000<=start<=end<0x12000000 or end%16:
            raise ValueError("Loaded quad asset ownership bound")
        primitive=struct.unpack_from("<Q",obj,0x60)[0]
        if not any(v["object"]==primitive and v["type"]==0x4beb81fd for v in state["visits"]):
            raise LoadedQuadAdmissionError("Primitive is not an authored arbitrary quad")
        if obj[0x2d1]&8:
            raise LoadedQuadAdmissionError("Following terrain requires the original height-query context")
        if struct.unpack_from("<Q",obj,0x3c8)[0]:
            raise LoadedQuadAdmissionError("Child particle sets require the original effect factory")
        # Reuse only the existing explicit owned scene environment. Its spare
        # definition/shape/primitive are replaced or unused. Copy the complete
        # loaded root and heap unchanged; this is not a field projection.
        graph=self.prepare_quad({"__type":"VfxEmitterDefinitionData",
            "SpawnShape":{"__type":"VfxShapeLegacy"},"primitive":{"__type":"VfxPrimitiveArbitraryQuad"}})
        self.u.mem_write(A["definition"],obj)
        self.u.mem_write(0x10400000,bytes(end-0x10400000))
        self.u.mem_write(start,heap)
        if self.q(primitive)!=self.base+0x23f20c8:
            raise ValueError("Loaded quad primitive vtable changed")
        graph.update({"allocations":[],"nextHeap":end,
            "segments":[{"address":A["definition"],"bytesHex":bytes(self.u.mem_read(A["definition"],0x10000)).hex()},
                        {"address":start,"bytesHex":heap.hex()}],
            "assetHeapStart":start,"assetHeapBytes":len(heap),"assetObjectHex":obj.hex(),
            "primitiveAddress":primitive,"authoredFields":[],"presentationMetadataOnly":[],
            "ownedInputs":"Complete unchanged native post-loaded emitter state. Unit root/system scales and colors; no flex input channels; supplied pose/basis, clock, quality and RNG seed. Constructor stops before original material acquisition. Link UV flags remain unbound; UV/materials/shaders and whole effect creation are separate. Terrain following and child effects rejected."})
        return graph

    def render_quad(self,view_position):
        self.u.mem_write(G["context"],bytes(0x3000))
        for offset,pointer in [(0,G["indices"]),(8,G["vertices"]),(0x10,G["draw"]),(0x18,A["actor"]),(0x20,G["view"])]:
            self.put(G["context"]+offset,"Q",pointer)
        self.put(G["view"],"fff",*view_position)
        primitive=self.q(A["definition"]+0x60)
        if self.q(primitive)!=self.base+0x23f20c8:
            raise ValueError("Loaded primitive changed")
        self.math_calls.clear()
        self.call(0x1730410,{r.UC_X86_REG_RDI:primitive,r.UC_X86_REG_RSI:G["context"]})
        nv,ni=self.q(G["context"]+8)-G["vertices"],self.q(G["context"])-G["indices"]
        count=struct.unpack("<I",self.u.mem_read(self.q(A["actor"]+0xa0)+0x10,4))[0]
        if count>1024 or nv!=count*112 or ni!=count*12:
            raise ValueError("Loaded quad output bound")
        return {"verticesHex":bytes(self.u.mem_read(G["vertices"],nv)).hex(),
                "indicesHex":bytes(self.u.mem_read(G["indices"],ni)).hex(),
                "drawHex":bytes(self.u.mem_read(G["draw"],16)).hex(),"mathCalls":list(self.math_calls)}
