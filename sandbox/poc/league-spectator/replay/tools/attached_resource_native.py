"""Original attached-mesh resource initialization/routing.

Complete post-loaded assets remain unchanged. Empty authored mesh paths execute
the complete original mesh-resource prefix. External mesh acquisition stops at
the original factory call; it is neither skipped nor replaced by a stub.
"""
import struct
from unicorn import x86_const as r
from attached_material_native import NativeAttachedMaterial
from vfx_material_native import FRAME
from vfx_spawn_native import ADDRESSES as A

BLOCKS=[(0x16e96ed,0x16e9779),(0x16e1860,0x16e1c0e),(0x16e2420,0x16e25a0),
        (0x177ac40,0x177ac60),(0x14ca280,0x14ca2c0)]


class NativeAttachedResource(NativeAttachedMaterial):
    def resolve_mesh(self,state):
        self.prepare_attached(state)
        # Run the original link initializer, including all invalid handle values,
        # the zero resolved pointer, native vtable and enabled material flag.
        self.call(0x16e96ed,{r.UC_X86_REG_RAX:A['definition'],r.UC_X86_REG_R14:A['link'],
            r.UC_X86_REG_RBX:A['resource']},0x16e9779)
        if self.q(A['link'])!=self.base+0x23ef5c0:raise ValueError('Attached native link vtable differs')
        initial=self.handles()
        primitive=self.q(A['definition']+0x60);mesh=primitive+0x10
        path_counts=[self.u32(mesh+offset+8)for offset in [0,0x10,0x20]]
        # All admitted authored attached states have no SKN/SKL names. The two
        # SCB paths use the external mesh factory and stay explicit boundaries.
        if any(path_counts[:2]):raise ValueError('Unprepared attached SKN/SKL resource path')
        end=0x16e1acd if path_counts[2] else 0x16e1c0e
        self.put(FRAME-0x158,'Q',A['manager'])
        self.call(0x16e1860,{r.UC_X86_REG_RAX:A['definition'],r.UC_X86_REG_R15:A['link'],r.UC_X86_REG_RBP:FRAME},end)
        result=self.handles()
        if path_counts[2]:
            requested=self.u.reg_read(r.UC_X86_REG_RDX)
            if requested!=mesh+0x20:raise ValueError('External mesh factory request used a different name')
            count=self.u32(requested+8)
            if not 16<count<4096:raise ValueError('Unsupported external mesh string representation')
            path=bytes(self.u.mem_read(self.q(requested),count)).decode('utf-8')
            if not path.lower().endswith('.scb'):raise ValueError('Unadmitted external mesh factory route')
            status='external-mesh-factory-required'
        else:
            path=None;status='no-authored-mesh-resource'
            if initial!=result or result!={'sknHandle':0xffffffff,'skeletonHandle':0xffffffff,'resolvedMesh':False,'meshHandle':0xffffffff}:raise ValueError('Empty authored mesh acquired a resource')
        self.finish()
        self.initial_resolution=status
        return {'initial':initial,'output':result,'status':status,'externalMeshPath':path,'originalEndRva':end}

    def initial_material(self,values):
        if self.initial_resolution!='no-authored-mesh-resource':raise ValueError('External mesh factory must resolve before selecting its material')
        # Shader selection mutates the original intern pool. Keep its image
        # changes in the restoration journal just as in the material compiler.
        self.loading=self.record_material=True
        result=self.select(values)
        self.finish()
        return result

    def handles(self):
        return {'sknHandle':self.u32(A['link']+0x1c),'skeletonHandle':self.u32(A['link']+0x20),
                'resolvedMesh':bool(self.q(A['link']+0x28)),'meshHandle':self.u32(A['link']+0x30)}
