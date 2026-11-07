"""Original batched-draw parameter updates with an owned shared registry.

Native parameter allocation, name hashing, map insertion/lookup, setters and
Metal CPU propagation execute unchanged. Only bounded C memcmp is modeled.
Scene matrix, pass and instance offset remain explicit caller inputs. Execution
stops before mesh selection, material application and the GPU draw instruction.
"""
import math
import struct
from unicorn import x86_const as r
from parent_material_native import NativeParentMaterials
from vfx_graphics_native import DEVICE

DRAW_PREFIX=(0x173d5f0,0x173d909)
PARAMETER_FACTORY=0x1928420
REGISTRY_INSERT=0x191a7d0
NAME_HASH=0x1ac6af0
SLOTS={'mProj':4,'mWorld':4,'mWorldInv':4,'PARTICLE_SYSTEM_POSITION':1,
    'PARTICLE_POSITION':1,'DYNAMIC_PARTICLE_IDX':1,'INSTANCE_FACING_DATA':1,
    'INSTANCE_UV_PARALLAX_SCALE':1,'USE_INSTANCE_DRAW':1,'INSTANCE_OFFSET':1}


class NativeParentDrawParameters(NativeParentMaterials):
    def __init__(self,*args,**kwargs):
        self.draw_parameter_slots={}
        self.draw_memcmp_calls=[]
        super().__init__(*args,**kwargs)
        if self.source.imports.get(0x1feea3e)!='_memcmp':
            raise ValueError('Draw parameter C memory comparison ABI differs')

    def imported(self,uc,address,size,user):
        if self.source.imports[address-self.base]!='_memcmp':
            return super().imported(uc,address,size,user)
        first,second,count=[uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        caller=self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
        if (count>64 or caller not in [0x1916fbf,0x19170f6,0x192c630] or
                not self.library_pointer(first,count) or not self.library_pointer(second,count)):
            raise ValueError('Unowned draw parameter C comparison')
        left,right=bytes(uc.mem_read(first,count)),bytes(uc.mem_read(second,count))
        result=next((a-b for a,b in zip(left,right) if a!=b),0)
        self.draw_memcmp_calls.append({'callerRva':caller,'bytes':count,'leftHex':left.hex(),
            'rightHex':right.hex(),'result':result})
        uc.reg_write(r.UC_X86_REG_RAX,result&0xffffffffffffffff)
        self.ret()

    def initialize_graphics_context(self,quality,graphics34b):
        state=super().initialize_graphics_context(quality,graphics34b)
        self.draw_parameter_slots={}
        for name,vectors in SLOTS.items():
            encoded=name.encode('ascii')
            text=self.allocate(len(encoded)+1);self.u.mem_write(text,encoded+b'\0')
            self.call(NAME_HASH,{r.UC_X86_REG_RDI:text,r.UC_X86_REG_RSI:len(encoded),r.UC_X86_REG_RDX:0})
            identity=self.u.reg_read(r.UC_X86_REG_RAX)&0xffffffff
            self.call(PARAMETER_FACTORY,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:identity,r.UC_X86_REG_RDX:vectors})
            pointer=self.u.reg_read(r.UC_X86_REG_RAX)
            if (self.allocations.get(pointer)!=0x38 or self.u32(pointer+0x10)!=vectors or
                    self.u32(pointer+0x14)!=identity or self.allocations.get(self.q(pointer+8))!=vectors*16 or
                    self.q(pointer)!=self.base+0x2408b98 or self.q(self.q(pointer)+0x20)!=self.base+0x192c5b0):
                raise ValueError('Original native shared parameter constructor differs')
            key=self.allocate(4);value=self.allocate(8)
            self.put(key,'I',identity);self.put(value,'Q',pointer)
            self.call(REGISTRY_INSERT,{r.UC_X86_REG_RDI:DEVICE+0x80,r.UC_X86_REG_RSI:key,
                r.UC_X86_REG_RDX:key,r.UC_X86_REG_RCX:value})
            self.call(0x1913b10,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:text})
            if self.u.reg_read(r.UC_X86_REG_RAX)!=pointer:
                raise ValueError('Original shared registry selected another parameter')
            self.draw_parameter_slots[name]={'pointer':pointer,'vectors':vectors,'hash':identity}
        self.draw_scene=self.allocate(0x300,0xa5)
        self.draw_wrapper=self.allocate(8)
        self.draw_command=self.allocate(16,0xa5)
        self.draw_material=self.allocate(8)
        return state

    def observe_shared_parameter(self,uc,address,size,user):
        super().observe_shared_parameter(uc,address,size,user)
        if address==self.base+0x1913c16:
            record=self.shared_parameter_queries[-1]
            record['sceneProviderPopulated']=bool(record['nativeResult'])

    def draw_parameters(self,emitter_index,projection_source,pass_hash,instance_offset):
        if (not self.draw_parameter_slots or type(emitter_index) is not int or
                type(pass_hash) is not int or not 0<=pass_hash<=0xffffffff or
                type(instance_offset) is not int or not 0<=instance_offset<=0xffffffff or
                not isinstance(projection_source,list) or len(projection_source)!=16 or
                any(type(v) not in [int,float] or not math.isfinite(v) or
                    not math.isfinite(struct.unpack('<f',struct.pack('<f',v))[0]) for v in projection_source)):
            raise ValueError('Explicit owned draw emitter, finite matrix, pass and offset required')
        actors=[a for a in self.frame_actors if a['kind']=='complex' and a['emitterIndex']==emitter_index]
        if len(actors)!=1:
            raise ValueError('Draw parameter emitter is not owned by the current parent')
        actor=actors[0]
        self.put(self.draw_wrapper,'Q',actor['pointer'])
        self.put(self.draw_command,'I',instance_offset)
        self.put(self.draw_material,'Q',self.q(actor['link']+0x88))
        self.put(self.draw_scene+0x264,'16f',*projection_source)
        before={name:bytes(self.u.mem_read(self.q(slot['pointer']+8),slot['vectors']*16)).hex()
            for name,slot in self.draw_parameter_slots.items()}
        start=len(self.draw_memcmp_calls)
        self.fragment(*DRAW_PREFIX,{r.UC_X86_REG_RDI:self.draw_wrapper,r.UC_X86_REG_RSI:self.draw_scene,
            r.UC_X86_REG_RDX:pass_hash,r.UC_X86_REG_RCX:self.draw_command,r.UC_X86_REG_R8:self.draw_material})
        values={name:bytes(self.u.mem_read(self.q(slot['pointer']+8),slot['vectors']*16)).hex()
            for name,slot in self.draw_parameter_slots.items()}
        return {'emitterIndex':emitter_index,'passHash':pass_hash,'instanceOffset':instance_offset,
            'projectionSource':projection_source,'values':values,
            'changed':[name for name in SLOTS if values[name]!=before[name]],
            'memcmpCalls':self.draw_memcmp_calls[start:]}
