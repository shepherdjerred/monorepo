"""Complete loaded camera quads and the original camera rotation-cache builder."""
import math
import struct

from unicorn import x86_const as r
from vfx_loaded_quad_native import NativeLoadedQuad,LoadedQuadAdmissionError
from vfx_spawn_native import ADDRESSES as A
from vfx_emitter_native import GEOMETRY as G

CAMERA_CACHE=0x100e0000
CAMERA_INPUT=0x100e3000


class NativeCameraQuad(NativeLoadedQuad):
    def prepare_camera(self,state):
        if state["phase"]!="native-postload-callbacks-executed" or state["pendingLinkFixups"] or state["mathCalls"]:
            raise ValueError("Unprepared native camera emitter state")
        obj,heap=bytes.fromhex(state["objectHex"]),bytes.fromhex(state["heapHex"])
        start=state["heapStart"];end=start+len(heap)
        if len(obj)!=0x470 or not 0x10400000<=start<=end<0x12000000 or end%16:
            raise ValueError("Camera quad asset ownership bound")
        primitive=struct.unpack_from("<Q",obj,0x60)[0]
        if not any(v["object"]==primitive and v["type"]==0x96ddbc74 for v in state["visits"]):
            raise LoadedQuadAdmissionError("Primitive is not a native camera quad")
        if obj[0x2d1]&8:
            raise LoadedQuadAdmissionError("Following terrain requires the original height-query context")
        if struct.unpack_from("<Q",obj,0x3c8)[0]:
            raise LoadedQuadAdmissionError("Child particle sets require the original effect factory")
        graph=self.prepare_quad({"__type":"VfxEmitterDefinitionData",
            "SpawnShape":{"__type":"VfxShapeLegacy"},"primitive":{"__type":"VfxPrimitiveArbitraryQuad"}})
        self.u.mem_write(A["definition"],obj)
        self.u.mem_write(0x10400000,bytes(end-0x10400000))
        self.u.mem_write(start,heap)
        if self.q(primitive)!=self.base+0x23f23b0:raise ValueError("Native camera quad vtable changed")
        graph.update({"allocations":[],"nextHeap":end,
            "segments":[{"address":A["definition"],"bytesHex":bytes(self.u.mem_read(A["definition"],0x10000)).hex()},
                        {"address":start,"bytesHex":heap.hex()}],
            "assetHeapStart":start,"assetHeapBytes":len(heap),"assetObjectHex":obj.hex(),
            "primitiveAddress":primitive,"authoredFields":[],"presentationMetadataOnly":[],
            "ownedInputs":"Complete unchanged native post-loaded camera-quad emitter. Unit root/system scales and colors; absent flex input channels; supplied actor pose/basis, clock, quality and RNG seed. Camera position, cache input right/up axes and view axis are supplied. Original 360-entry camera rotation cache and embedded degree-trig table execute unchanged. Material acquisition, link UV binding, original shaders, full effect factories and original camera-controller policy are unimplemented. Terrain following and child effects rejected."})
        return graph

    def frame_camera(self,value):
        for key in ["cameraRight","cameraUp","viewAxis"]:
            v=value[key]
            if not isinstance(v,list) or len(v)!=3 or any(type(n) not in [int,float] or not math.isfinite(n) for n in v):
                raise ValueError("Camera quad requires explicit finite camera axes")
            if abs(sum(n*n for n in v)-1)>0.00002:raise ValueError("Camera axis must be supplied at unit length")
        axes=[value[k] for k in ["cameraRight","cameraUp","viewAxis"]]
        if any(abs(sum(x*y for x,y in zip(axes[a],axes[b])))>0.00002 for a,b in [(0,1),(0,2),(1,2)]):
            raise ValueError("Camera axes must be supplied orthogonally")
        self.camera_right,self.camera_up,self.view_axis=axes
        return self.frame_quad(value)

    def render_quad(self,view_position):
        self.u.mem_write(G["context"],bytes(0x3000))
        for offset,pointer in [(0,G["indices"]),(8,G["vertices"]),(0x10,G["draw"]),(0x18,A["actor"]),(0x20,G["view"])]:
            self.put(G["context"]+offset,"Q",pointer)
        self.put(G["view"],"fff",*view_position)
        self.put(G["view"]+0x24,"fff",*self.view_axis)
        # The original caller passes inverse-view row 1 then row 0. Keep the
        # supplied camera inputs explicit and execute its complete cache builder.
        self.put(CAMERA_INPUT,"fff",*self.camera_up)
        self.put(CAMERA_INPUT+0x10,"fff",*self.camera_right)
        self.call(0x1746290,{r.UC_X86_REG_RDI:CAMERA_CACHE+0x158,
            r.UC_X86_REG_RSI:CAMERA_INPUT,r.UC_X86_REG_RDX:CAMERA_INPUT+0x10})
        self.put(CAMERA_CACHE,"Q",G["view"])
        self.put(A["manager"]+0x338,"QI",CAMERA_CACHE,1)
        primitive=self.q(A["definition"]+0x60)
        if self.q(primitive)!=self.base+0x23f23b0:raise ValueError("Loaded camera primitive changed")
        self.math_calls.clear()
        self.call(0x1733290,{r.UC_X86_REG_RDI:primitive,r.UC_X86_REG_RSI:G["context"]})
        nv,ni=self.q(G["context"]+8)-G["vertices"],self.q(G["context"])-G["indices"]
        count=struct.unpack("<I",self.u.mem_read(self.q(A["actor"]+0xa0)+0x10,4))[0]
        if count>1024 or nv!=count*112 or ni!=count*12:raise ValueError("Camera quad output bound")
        return {"verticesHex":bytes(self.u.mem_read(G["vertices"],nv)).hex(),
                "indicesHex":bytes(self.u.mem_read(G["indices"],ni)).hex(),
                "drawHex":bytes(self.u.mem_read(G["draw"],16)).hex(),"mathCalls":list(self.math_calls)}
