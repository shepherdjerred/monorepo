"""Bounded original authored parent/child prerequisite observation.

Installed static resources and explicit clock/seed/pose are component controls.
No lookup success, resource context, provider or match acceptance is fabricated.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path

import unicorn
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from parent_placement_native import NativeParentPlacement
from vfx_spawn_native import ADDRESSES as A, name_hash, sha
from vfx_asset_native import CONTEXT,CACHE,WRAPPER


class ChildParentControl(NativeParentPlacement):
    def __init__(self,*args,**kwargs):
        self.child_reads=[]
        self.child_calls=[]
        self.variant='authored'
        self.typed_control=None
        super().__init__(*args,**kwargs)
        for rva in [0x1754e70,0x17556d0,0x1755884,0x17558b0,0x17558c5,0x1755c64]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_child_call,
                            begin=self.base+rva,end=self.base+rva)

    def observe_child_call(self,uc,address,size,user):
        if len(self.child_calls)>=4096:raise ValueError('Bounded child call trace exhausted')
        row={'rva':address-self.base,'rngHex':bytes(self.u.mem_read(A['stream']+8,12)).hex(),
            'registers':{name:uc.reg_read(reg) for name,reg in [('rdi',r.UC_X86_REG_RDI),('rsi',r.UC_X86_REG_RSI),('rdx',r.UC_X86_REG_RDX),('rax',r.UC_X86_REG_RAX),('rbx',r.UC_X86_REG_RBX),('r14',r.UC_X86_REG_R14)]}}
        if address-self.base==0x1755884:
            identifier=uc.reg_read(r.UC_X86_REG_RBX);source=uc.reg_read(r.UC_X86_REG_R15)
            row.update(requestedEffectKey=self.u32(identifier+8),sourceObject=source,resourceContext=self.q(source+0x50))
        self.child_calls.append(row)

    def load_prepared_system(self,graph):
        super().load_prepared_system(graph)
        field=next(p for p in self.type_catalog['45cd899f']['properties'] if p['hash']==name_hash('complexEmitterDefinitionData'))
        child=next(p for p in self.type_catalog['09cde442']['properties'] if p['hash']==name_hash('childParticleSetDefinition'))
        if child['offset']!=0x3c8:raise ValueError('Original child declaration offset differs')
        if self.variant=='typed-child-null':
            definition=self.q(self.q(A['definition']+field['offset']))
            original=self.q(definition+child['offset'])
            if not original:raise ValueError('Child-null control requires an authored declaration')
            payload=struct.pack('<IBI',child['hash'],0x82,0)
            self.input,self.cursor=payload,0;self.put(CACHE,'Q',0);self.loading=True
            try:self.call(0x14bc830,{r.UC_X86_REG_RDI:CONTEXT,r.UC_X86_REG_RSI:definition,
                                   r.UC_X86_REG_RDX:self.types[0x09cde442],r.UC_X86_REG_RCX:WRAPPER,r.UC_X86_REG_R8:CACHE})
            finally:self.loading=False
            if self.cursor!=len(payload) or self.q(definition+child['offset']):raise ValueError('Original typed child-null reader did not clear declaration')
            self.typed_control={'fieldHex':payload.hex(),'fieldReaderRva':0x14bc830,'originalChild':original,'definition':definition,'cursor':self.cursor}
        self.child_definitions=[]
        for i,row in enumerate(self.vector(A['definition']+field['offset'],8,4096)):
            definition=self.q(row)
            pointer=self.q(definition+child['offset'])
            self.child_definitions.append({'emitterIndex':i,'definition':definition,'child':pointer,
                'childHex':bytes(self.u.mem_read(pointer,0x40)).hex() if pointer else None,
                'identifiersHex':bytes(self.u.mem_read(self.q(pointer),self.u32(pointer+8)*0x20)).hex() if pointer and self.u32(pointer+8) else None})
            if pointer:
                self.u.hook_add(unicorn.UC_HOOK_MEM_READ,self.observe_child_read,
                                begin=definition+child['offset'],end=definition+child['offset']+7)
        self.u.hook_add(unicorn.UC_HOOK_MEM_READ,self.observe_child_read,
                        begin=A['definition']+0x148,end=A['definition']+0x14b)

    def observe_child_read(self,uc,access,address,size,value,user):
        if len(self.child_reads)>=4096:raise ValueError('Bounded child read trace exhausted')
        self.child_reads.append({'rva':uc.reg_read(r.UC_X86_REG_RIP)-self.base,'address':address,'bytes':size,
                                 'registers':{name:uc.reg_read(reg) for name,reg in [('rdi',r.UC_X86_REG_RDI),('rsi',r.UC_X86_REG_RSI),('rdx',r.UC_X86_REG_RDX),('rcx',r.UC_X86_REG_RCX)]}})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:parser.add_argument(name,type=Path)
    parser.add_argument('--frames',type=int,default=3)
    parser.add_argument('--variant',choices=['authored','typed-child-null'],default='authored')
    args=parser.parse_args()
    if not 1<=args.frames<=61:raise ValueError('Bounded frame count required')
    fixture=NativeVfxFixture(args.cache)
    effect_id='champions/jinx/2/3b1dfaaf'
    manifest=fixture.read(fixture.assets/'latest-effects/manifest.json')
    authored=fixture.read(fixture.assets/'latest-effects'/manifest['definitions'][effect_id]['file'])
    child_indices=[i for i,e in enumerate(authored['definition']['complexEmitterDefinitionData']) if 'childParticleSetDefinition' in e]
    if child_indices!=[0]:raise ValueError('Exact bounded authored child fixture differs')
    device=GraphicsTextureDevice(args.angle)
    n=None;shaders=None;stage='construct';frames=[];boundary=None;active=None;ownership=None
    try:
        n=ChildParentControl(fixture.assets/'decoder-16.21-macos',args.client,device=device)
        n.variant=args.variant
        shaders=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shaders
        stage='activate'
        active=fixture.activate(n,effect_id,12345,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
        ownership=n.own_parent(active['object'])
        stage='tick'
        for tick in range(args.frames):
            time=ownership['initialTime']+tick/60
            n.apply_placement(active['object'],{'position':[100+tick*2,40,200+tick]})
            n.synchronize_placement(active['object'])
            frame=n.tick_parent(time,20)
            frames.append({'time':frame['time'],'substeps':frame['substeps'],'state':frame['state'],
                           'managerParentCount':n.u32(A['manager']+0x188)})
        stage='complete'
    except Exception as error:
        boundary={'stage':stage,'error':str(error)}
        if n:
            boundary.update(rva=n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                            registers={name:n.u.reg_read(reg) for name,reg in [('rax',r.UC_X86_REG_RAX),('rbx',r.UC_X86_REG_RBX),('rcx',r.UC_X86_REG_RCX),('rdx',r.UC_X86_REG_RDX),('rdi',r.UC_X86_REG_RDI),('rsi',r.UC_X86_REG_RSI),('rsp',r.UC_X86_REG_RSP)]},
                            rngHex=bytes(n.u.mem_read(A['stream']+8,12)).hex())
    finally:
        paths={Path(__file__),Path(inspect.getfile(NativeVfxFixture)),Path(inspect.getfile(GraphicsShaderCatalog)),Path(inspect.getfile(GraphicsTextureDevice))}
        if n:paths.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
        if shaders:
            for path,digest in shaders.inputs.items():
                if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Shader input drift')
        out={'schema':1,'kind':'native-authored-child-parent-prerequisite-control','build':'16.21.829.8620','protocol':'20e09df23c66b85e',
             'effectId':effect_id,'variant':args.variant,'typedControl':n.typed_control if n else None,'requestedFrames':args.frames,'frames':frames,'boundary':boundary,'completed':stage=='complete',
             'childDefinitions':n.child_definitions if n and hasattr(n,'child_definitions') else [],
             'childReads':n.child_reads if n else [],'childCalls':n.child_calls if n else [],'ownership':ownership,
             'activation':{k:v for k,v in active.items() if k!='graph'} if active else None,
             'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
             'originalBlocks':list(n.blocks.values()) if n else [],
             'scope':{'unchangedCompleteAuthoredRoot':args.variant=='authored','onlyTypedChildNullOverride':args.variant=='typed-child-null','installedStaticResources':True,'suppliedClockSeedPose':True,
                      'forcedResourceLookupSuccess':False,'nativeMatchResourceContextRecovered':False,'nativeWorldAcceptance':None,
                      'childResourceAcceptanceRecovered':False,'childFreeSiblingIndependenceProven':False,'gpuSubmitted':False,'runtimeAdmissionChanged':False}}
        path=fixture.cache/('research/direct-child-parent-native.json' if args.variant=='authored' else 'research/direct-child-null-parent-native.json')
        path.write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
        print(json.dumps({'output':str(path),'completed':out['completed'],'frames':len(frames),'boundary':boundary,'childReads':len(out['childReads'])}))
        if n:
            if n.material_backend:n.material_backend.close()
            if n.mesh_backend:n.mesh_backend.close()
        if shaders:shaders.close()
        device.close()


if __name__=='__main__':main()
