"""Complete loaded attached emitter particle-pool updates, without mesh drawing.

Actual type-11 assets and common native emitter functions execute unchanged.
Scene scale/color, clock, quality, root basis and random seed remain supplied.
Owner pose binding and mesh GPU submission are not part of this component.
"""
import math,struct
from unicorn import x86_const as r
from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import ADDRESSES as A

class AttachedParticleAdmissionError(ValueError):
    pass

class NativeAttachedParticles(NativeBoundQuad):
    def prepare_attached_particles(self,state):
        obj,heap=bytes.fromhex(state['objectHex']),bytes.fromhex(state['heapHex']);start=state['heapStart'];end=start+len(heap)
        if state['phase']!='native-postload-callbacks-executed' or state['pendingLinkFixups'] or state['mathCalls'] or len(obj)!=0x470 or not 0x10400000<=start<=end<0x12000000 or end%16:raise ValueError('Invalid complete attached particle asset')
        primitive=struct.unpack_from('<Q',obj,0x60)[0]
        if not any(v['object']==primitive and v['type']==0xa4aea2a5 for v in state['visits']):raise ValueError('Particle primitive is not an authored attached mesh')
        if obj[0x2d1]&8:raise AttachedParticleAdmissionError('Terrain-following attached emitter requires the native height context')
        if struct.unpack_from('<Q',obj,0x3c8)[0]:raise AttachedParticleAdmissionError('Child attached effects require the native effect factory')
        # Reuse the declared owned scene inputs only. Replace the entire spare
        # emitter/heap with the actual post-loaded asset before constructing it.
        graph=self.prepare_quad({'__type':'VfxEmitterDefinitionData','SpawnShape':{'__type':'VfxShapeLegacy'},'primitive':{'__type':'VfxPrimitiveArbitraryQuad'}})
        self.u.mem_write(A['definition'],obj);self.u.mem_write(0x10400000,bytes(end-0x10400000));self.u.mem_write(start,heap)
        if self.q(primitive)!=self.base+0x23f6d30:raise ValueError('Attached particle primitive vtable differs')
        uv=self.classify_uv()
        # A real owned system context with an explicitly absent owner exercises
        # the client's identity fallback. No owner callback is replaced.
        self.put(A['system']+0x38,'Q',A['context']);self.put(A['context']+0x170,'Q',0)
        graph.update({'allocations':[],'nextHeap':end,'globals':graph['globals'],
            'segments':[{'address':A['definition'],'bytesHex':bytes(self.u.mem_read(A['definition'],0x10000)).hex()},{'address':start,'bytesHex':heap.hex()}],
            'assetHeapStart':start,'assetHeapBytes':len(heap),'assetObjectHex':obj.hex(),'primitiveAddress':primitive,'uvFlags':uv,
            'authoredFields':[],'presentationMetadataOnly':[],
            'ownedInputs':'Complete unchanged type-11 post-loaded asset. Supplied unit system/root scales/colors, clock, basis, quality and RNG seed; absent flex channels, owner and bound textures. Original absent-owner identity fallback and complete emitter pool updates. Constructor stops before material/owner-pose acquisition. Terrain and child factories rejected. No mesh writer or graphics submission.'})
        return graph

    def frame_attached(self,value):
        time=value['time']
        if not math.isfinite(time) or not self.last_time<=time<=30 or time<0:raise ValueError('Attached particle clock must advance')
        self.last_time=time;self.births.clear();self.math_calls.clear();self.services.clear();self.library_inputs=[]
        self.put(A['system']+0xfc,'fff',*value['previous']);self.put(A['system']+0x108,'fff',*value['current']);self.put(A['system']+0x1e0,'f'*16,*value['basis'])
        self.u.mem_write(A['stack']-0x8000,bytes(0x8000))
        self.call(0x1757f10,{r.UC_X86_REG_RDI:A['actor'],r.UC_X86_REG_XMM0:int.from_bytes(struct.pack('<f',time),'little')})
        return self.snapshot()

    def draw_values(self):
        pool=self.q(A['actor']+0xa0);count=struct.unpack('<I',self.u.mem_read(pool+0x10,4))[0]
        if count>1024 or struct.unpack('<I',self.u.mem_read(pool+0xa0,4))[0]!=count:raise ValueError('Attached particle draw attributes differ from live pool')
        attributes=self.q(pool+0x98);frame=0x10018000;result=[]
        for index in range(count):
            offset=index*0x2c
            # Original erosion-input load, ending before its material callback.
            self.call(0x173e143,{r.UC_X86_REG_R14:attributes,r.UC_X86_REG_R15:offset},0x173e14a)
            erosion=(self.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff).to_bytes(4,'little')
            self.put(frame-0x38,'Q',A['link'])
            # Original caller loads RG/BA into XMM0/XMM1 and calls the complete
            # native color/premultiply computation. Stop before material access.
            self.call(0x173e153,{r.UC_X86_REG_R14:attributes,r.UC_X86_REG_R15:offset,r.UC_X86_REG_RBP:frame},0x173f031)
            color=bytes(self.u.mem_read(self.u.reg_read(r.UC_X86_REG_RBP)-0x50,16))
            result.append({'colorFactor':{'bytesHex':color.hex(),'value':list(struct.unpack('<4f',color))},'erosionDriveHex':erosion.hex(),'erosionDrive':struct.unpack('<f',erosion)[0]})
        return result
