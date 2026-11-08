"""Whole-parent native ray and arbitrary-trail geometry, preserving all actors.

The original ray writer uses the same packed 28-byte vertex ABI as quads and
writes one four-vertex/six-index quad per live particle. Arbitrary trails use
the same original ribbon writer as camera trails, with their authored primitive
data intact. Mesh/animated primitives remain explicit admission boundaries.
This extends, without editing, the frozen original parent-frame component.
"""
import math
import struct
import unicorn
from unicorn import x86_const as r
from parent_placement_native import NativeParentPlacement
from vfx_parent_frames_native import WRITERS
from vfx_camera_quad_native import CAMERA_CACHE,CAMERA_INPUT
from vfx_emitter_native import GEOMETRY as G
from vfx_spawn_native import ADDRESSES as A

RAY_WRITERS={**WRITERS,0x23f26e0:('ray',0x1734a30),
    0x23f6678:('arbitrary-trail',0x1737570)}
TRAIL_KINDS={'camera-trail','arbitrary-trail'}


class NativeRayParentFrames(NativeParentPlacement):
    def render_parent(self,camera):
        for name in ['position','right','up','axis']:
            vector=camera.get(name)
            if (not isinstance(vector,list) or len(vector)!=3 or
                    any(type(v) not in [int,float] or not math.isfinite(v) for v in vector)):
                raise ValueError('Ray parent geometry requires explicit finite camera inputs')
        axes=[camera[k] for k in ['right','up','axis']]
        if any(abs(sum(v*v for v in a)-1)>2e-5 for a in axes) or any(
                abs(sum(x*y for x,y in zip(axes[a],axes[b])))>2e-5 for a,b in [(0,1),(0,2),(1,2)]):
            raise ValueError('Ray parent camera axes must be unit and orthogonal')
        state=self.parent_state()
        for actor in state['actors']:
            if actor['kind']!='complex' or actor['primitiveVtableRva'] not in RAY_WRITERS:
                raise ValueError('Ray parent requires another whole-root primitive/animated writer')
            if actor['vectors']['life']['count']>1024:
                raise ValueError('Ray parent geometry exceeds its particle bound')
            if self.q(self.base+actor['primitiveVtableRva']+0x28)-self.base!=RAY_WRITERS[actor['primitiveVtableRva']][1]:
                raise ValueError('Original ray parent writer method differs')
        self.put(G['view'],'fff',*camera['position']);self.put(G['view']+0x24,'fff',*camera['axis'])
        self.put(CAMERA_INPUT,'fff',*camera['up']);self.put(CAMERA_INPUT+0x10,'fff',*camera['right'])
        self.call(0x1746290,{r.UC_X86_REG_RDI:CAMERA_CACHE+0x158,r.UC_X86_REG_RSI:CAMERA_INPUT,r.UC_X86_REG_RDX:CAMERA_INPUT+0x10})
        self.put(CAMERA_CACHE,'Q',G['view']);self.put(A['manager']+0x338,'QI',CAMERA_CACHE,1)
        draws=[]
        for actor in state['actors']:
            kind,writer=RAY_WRITERS[actor['primitiveVtableRva']];count=actor['vectors']['life']['count']
            trail=kind in TRAIL_KINDS
            max_vertices=count*(56 if trail else 112)
            max_indices=max(0,count-1)*12 if trail else count*12
            self.u.mem_write(G['context'],bytes(0x3000))
            self.put(G['view'],'fff',*camera['position']);self.put(G['view']+0x24,'fff',*camera['axis'])
            for offset,value in [(0,G['indices']),(8,G['vertices']),(0x10,G['draw']),
                    (0x18,actor['pointer']),(0x20,G['view'])]:self.put(G['context']+offset,'Q',value)
            def guard(uc,access,address,size,value,user):
                if not ((G['indices']<=address<address+size<=G['indices']+max_indices) or
                        (G['vertices']<=address<address+size<=G['vertices']+max_vertices)):
                    raise ValueError('Ray parent writer exceeded its owned output')
            hook=self.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,guard,begin=G['indices'],end=0x100affff)
            try:self.call(writer,{r.UC_X86_REG_RDI:actor['primitive'],r.UC_X86_REG_RSI:G['context']})
            finally:self.u.hook_del(hook)
            nv=self.q(G['context']+8)-G['vertices'];ni=self.q(G['context'])-G['indices']
            if not (0<=nv<=max_vertices and 0<=ni<=max_indices and nv%28==0 and ni%2==0):
                raise ValueError('Ray parent geometry output cursor differs')
            if not trail and (nv!=max_vertices or ni!=max_indices):
                raise ValueError('Ray/quad geometry omitted live particles')
            indices=bytes(self.u.mem_read(G['indices'],ni));vertices=bytes(self.u.mem_read(G['vertices'],nv))
            if any(index>=nv//28 for index in struct.unpack('<'+'H'*(ni//2),indices)):
                raise ValueError('Ray parent geometry index exceeds its vertices')
            draws.append({'emitterIndex':actor['emitterIndex'],'actor':actor['pointer'],'kind':kind,
                'particleCount':count,'verticesHex':vertices.hex(),'indicesHex':indices.hex(),
                'drawHex':bytes(self.u.mem_read(G['draw'],16)).hex()})
        return draws
