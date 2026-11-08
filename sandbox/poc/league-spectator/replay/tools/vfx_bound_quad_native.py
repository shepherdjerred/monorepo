"""Full native quad simulation with original UV classification, birth and updates.

Texture presence is an explicit CPU-writer input, not resource acquisition.
Its opaque marker is unmapped: any attempted dereference fails immediately.
"""
import struct

from unicorn import x86_const as r
from vfx_camera_quad_native import NativeCameraQuad,CAMERA_CACHE,CAMERA_INPUT
from vfx_loaded_quad_native import NativeLoadedQuad,LoadedQuadAdmissionError
from vfx_spawn_native import ADDRESSES as A
from vfx_emitter_native import GEOMETRY as G

TEXTURE_PRESENCE=0x20000000
DEFAULT_MULT=0x253d218


class NativeBoundQuad(NativeCameraQuad):
    def __init__(self,*args):
        super().__init__(*args)
        # Execute the original lazy default-mult initialization before any
        # asset runtime is restored; its immutable bytes are packaged explicitly.
        self.prepare_quad({"__type":"VfxEmitterDefinitionData","SpawnShape":{"__type":"VfxShapeLegacy"},
            "primitive":{"__type":"VfxPrimitiveArbitraryQuad"}})
        self.classify_uv()
        if self.u.mem_read(self.base+DEFAULT_MULT+0xa8,1)!=b"\1":
            raise ValueError("Original default mult-UV object was not initialized")

    def classify_uv(self):
        frame=A["stack"]-0x100
        self.put(frame-0x150,"Q",A["link"])
        self.call(0x16e1d6d,{r.UC_X86_REG_RAX:A["definition"],r.UC_X86_REG_R15:A["link"],r.UC_X86_REG_RBP:frame},0x16e1dbe)
        flags=bytes(self.u.mem_read(A["link"]+0xe8,2))
        if any(v not in [0,1] for v in flags):raise ValueError("Native UV predicate returned invalid flags")
        return {"base":bool(flags[0]),"mult":bool(flags[1])}

    def prepare_bound(self,state):
        obj=bytes.fromhex(state["objectHex"])
        primitive=struct.unpack_from("<Q",obj,0x60)[0]
        types={v["type"] for v in state["visits"] if v["object"]==primitive}
        if 0x96ddbc74 in types:
            graph=super().prepare_camera(state);kind="camera"
        elif 0x4beb81fd in types:
            graph=NativeLoadedQuad.prepare_loaded(self,state);kind="arbitrary"
        else:raise LoadedQuadAdmissionError("Primitive is not a native camera or arbitrary quad")
        flags=self.classify_uv()
        if bytes(self.u.mem_read(A["definition"],0x470))!=obj:raise ValueError("UV classification mutated the authored root")
        graph.update({"primitiveKind":kind,"uvFlags":flags,
            "hasMultDefinition":bool(struct.unpack_from("<Q",obj,0x230)[0]),
            "segments":[{"address":A["definition"],"bytesHex":bytes(self.u.mem_read(A["definition"],0x10000)).hex()},graph["segments"][1]],
            "ownedInputs":"Complete unchanged post-loaded camera/arbitrary quad assets. Original UV classification, whole birth RNG order, pool updates and vertex writers. Unit scene scales/colors, absent flex channels and cached scale modifiers, supplied clock/basis/seed/quality/camera. Mult-texture presence is a supplied CPU predicate with an unmapped opaque marker; no texture resource object or GPU material acquisition is implied. Terrain following and child factories rejected. Original shaders, camera controller and match integration unimplemented."})
        return graph

    def reset_bound(self,graph,seed,quality,metadata):
        self.reset_quad(graph,seed,quality)
        for value in metadata["initializedGlobals"]:
            self.u.mem_write(self.base+value["rva"],bytes.fromhex(value["bytesHex"]))

    def frame_bound(self,value):
        if type(value["multTexturePresent"]) is not bool:raise ValueError("Explicit mult-texture presence required")
        self.put(A["link"]+0x58,"Q",TEXTURE_PRESENCE if value["multTexturePresent"] else 0)
        return self.frame_camera(value)

    def render_quad(self,view_position):
        self.u.mem_write(G["context"],bytes(0x3000))
        for offset,pointer in [(0,G["indices"]),(8,G["vertices"]),(0x10,G["draw"]),(0x18,A["actor"]),(0x20,G["view"])]:
            self.put(G["context"]+offset,"Q",pointer)
        self.put(G["view"],"fff",*view_position);self.put(G["view"]+0x24,"fff",*self.view_axis)
        self.put(CAMERA_INPUT,"fff",*self.camera_up);self.put(CAMERA_INPUT+0x10,"fff",*self.camera_right)
        self.call(0x1746290,{r.UC_X86_REG_RDI:CAMERA_CACHE+0x158,r.UC_X86_REG_RSI:CAMERA_INPUT,r.UC_X86_REG_RDX:CAMERA_INPUT+0x10})
        self.put(CAMERA_CACHE,"Q",G["view"]);self.put(A["manager"]+0x338,"QI",CAMERA_CACHE,1)
        primitive=self.q(A["definition"]+0x60);vtable=self.q(primitive)-self.base
        writers={0x23f23b0:0x1733290,0x23f20c8:0x1730410}
        if vtable not in writers:raise ValueError("Bound quad primitive changed")
        self.math_calls.clear()
        self.call(writers[vtable],{r.UC_X86_REG_RDI:primitive,r.UC_X86_REG_RSI:G["context"]})
        nv,ni=self.q(G["context"]+8)-G["vertices"],self.q(G["context"])-G["indices"]
        count=struct.unpack("<I",self.u.mem_read(self.q(A["actor"]+0xa0)+0x10,4))[0]
        if count>1024 or nv!=count*112 or ni!=count*12:raise ValueError("Bound quad output bound")
        return {"verticesHex":bytes(self.u.mem_read(G["vertices"],nv)).hex(),"indicesHex":bytes(self.u.mem_read(G["indices"],ni)).hex(),
            "drawHex":bytes(self.u.mem_read(G["draw"],16)).hex(),"mathCalls":list(self.math_calls)}
