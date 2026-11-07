"""Original recursive VFX post-load callbacks on native-deserialized objects."""
import unicorn
from unicorn import x86_const as r

from vfx_asset_native import NativeVfxAssets, OBJECT, ROOT_TYPE, CONTEXT
from vfx_spawn_native import SERVICES


class NativeVfxPostload(NativeVfxAssets):
    def __init__(self,package,client):
        self.postloading = False
        self.postload_blocks = {}
        self.heap_high_water = 0x10400000
        self.arena_before = None
        super().__init__(package,client)
        self.visits = []
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.visit,begin=self.base+0x14bc490,end=self.base+0x14bc490)

    def allocate(self,size,fill=0):
        if self.postloading and self.arena_before is not None:
            if not 0<size<0x100000 or self.next_heap+size>0x12000000:
                raise ValueError("Post-load allocation exceeds owned arena")
            end=(self.next_heap+size+15)&~15
            old_end=0x10400000+len(self.arena_before)
            if end>old_end:
                self.arena_before += bytes(self.u.mem_read(old_end,end-old_end))
        result=super().allocate(size,fill)
        if not self.postloading:self.heap_high_water=max(self.heap_high_water,self.next_heap)
        return result

    def check_block(self,uc,address,size,user):
        super().check_block(uc,address,size,user)
        at=address-self.base
        if self.postloading and at not in SERVICES and at not in self.source.imports and at!=0x1478f10:
            self.postload_blocks[at] = self.blocks[at]

    def visit(self,uc,address,size,user):
        if not self.postloading:return
        obj,descriptor = self.u.reg_read(r.UC_X86_REG_RDI),self.u.reg_read(r.UC_X86_REG_RSI)
        identity=self.u32(descriptor+8)
        if self.types.get(identity)!=descriptor:
            raise ValueError("Post-load visited an unregistered type")
        size=self.q(descriptor+0x40)
        if not (OBJECT<=obj and obj+size<=OBJECT+0x470 or self.baseline_heap<=obj and obj+size<=self.next_heap):
            raise ValueError("Post-load visited an unowned object")
        self.visits.append({"type":identity,"object":obj,"bytes":size,
                            "callbackRva":self.q(descriptor+0x30)-self.base if self.q(descriptor+0x30) else None})

    def postload(self):
        if self.arena_before is not None:raise ValueError("Prior post-load arena must be restored")
        self.arena_before=bytes(self.u.mem_read(0x10400000,self.heap_high_water-0x10400000))
        self.object_before=bytes(self.u.mem_read(OBJECT,0x470))
        self.heap_before,self.allocations_before=self.next_heap,dict(self.allocations)
        self.visits=[]
        self.math_calls.clear()
        self.postloading=self.loading=True
        try:
            self.call(0x14bc490,{r.UC_X86_REG_RDI:OBJECT,r.UC_X86_REG_RSI:self.types[ROOT_TYPE]})
        except Exception as error:
            raise ValueError(f"Original post-load failed at {self.u.reg_read(r.UC_X86_REG_RIP)-self.base:x}: {error}") from error
        finally:
            self.postloading=self.loading=False
        return {"objectHex":bytes(self.u.mem_read(OBJECT,0x470)).hex(),
                "heapHex":bytes(self.u.mem_read(self.baseline_heap,self.next_heap-self.baseline_heap)).hex(),
                "heapStart":self.baseline_heap,"visits":list(self.visits),"mathCalls":list(self.math_calls),
                "pendingLinkFixups":self.u32(CONTEXT+0x10)}

    def restore_preload_arena(self):
        # Preserve the serialized loader's allocation/padding history while
        # observing a separate post-load branch. This is an offline arena
        # transaction, not a general runtime checkpoint or a callback no-op.
        if self.arena_before is None:raise ValueError("No post-load arena transaction")
        self.u.mem_write(0x10400000,self.arena_before)
        self.u.mem_write(OBJECT,self.object_before)
        self.next_heap,self.allocations=self.heap_before,dict(self.allocations_before)
        self.arena_before=None
