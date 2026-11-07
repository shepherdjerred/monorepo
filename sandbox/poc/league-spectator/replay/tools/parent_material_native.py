"""Read original activated parent material passes, aliases and GPU bindings.

No material is created or substituted here. Complete effect activation produces
the material objects, passes, programs, pipelines and binding resources first.
The original read-only pass lookup is executed for every observed query.
"""
from unicorn import x86_const as r
from vfx_ray_frames_native import NativeRayParentFrames
from vfx_spawn_native import sha

PASS_TABLE_RVA=0x256d830
PASS_LOOKUP_RVA=0x17c2100
PASS_NAME_HASH_RVA=0x144b580


class NativeParentMaterials(NativeRayParentFrames):
    def material_passes(self):
        if self.frame_parent is None:
            raise ValueError('Activated owned parent required for material observation')
        registered=[]
        for index in range(7):
            address=self.base+PASS_TABLE_RVA+index*48
            code=self.u.mem_read(address,1)[0]
            pointer=self.q(address+8)
            if code!=index or not self.library_pointer(pointer,1):
                raise ValueError('Original registered material pass table differs')
            name=self.cstring(pointer).decode('ascii')
            self.call(PASS_NAME_HASH_RVA,{r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:0x811c9dc5})
            registered.append({'code':code,'name':name,'hash':self.u.reg_read(r.UC_X86_REG_RAX)&0xffffffff})
        result=[]
        for actor in self.frame_actors:
            if actor['kind']!='complex':
                raise ValueError('Another parent actor material contract required')
            material=self.q(actor['link']+0x88)
            if self.allocations.get(material)!=0x90:
                raise ValueError('Original owned material header size differs')
            table,count,capacity=self.q(material),self.u32(material+8),self.u32(material+12)
            if count>64 or count>capacity&0x7fffffff or count and self.allocations.get(table,0)<count*32:
                raise ValueError('Original material pass rows exceed owned bounds')
            rows=[]
            for index in range(count):
                row=table+index*32
                name_pointer=self.q(row)
                name=self.cstring(name_pointer).decode('ascii')
                identity=self.u32(row+8)
                self.call(PASS_NAME_HASH_RVA,{r.UC_X86_REG_RDI:name_pointer,r.UC_X86_REG_RSI:0x811c9dc5})
                if self.u.reg_read(r.UC_X86_REG_RAX)&0xffffffff!=identity:
                    raise ValueError('Original material pass name/hash differs')
                variants=self.q(row+0x10);variant_count=self.u32(row+0x18)
                if (not 0<variant_count<=32 or variant_count>self.u32(row+0x1c)&0x7fffffff or
                        self.allocations.get(variants,0)<variant_count*128):
                    raise ValueError('Original material pass variants exceed owned bounds')
                values=[]
                for variant in range(variant_count):
                    at=variants+variant*128
                    compiled,binding=self.q(at+0x70),self.q(at+0x78)
                    if self.allocations.get(compiled)!=32:
                        raise ValueError('Original compiled material pipeline wrapper differs')
                    # The draw caller loads pass+0x70, then its +8 backend
                    # pipeline (17c2de9..17c2ded). The wrapper is not itself
                    # the backend pipeline resource.
                    pipeline=self.q(compiled+8)
                    if pipeline not in self.native_pipelines or binding not in self.native_bindings:
                        raise ValueError('Original material variant lacks actual GPU-backed resources')
                    state=self.native_pipelines[pipeline]
                    program=state['nativeProgram']
                    if program not in self.native_programs or self.native_bindings[binding]['glProgram']!=state['glProgram']:
                        raise ValueError('Original material variant program/pipeline/binding disagree')
                    values.append({'index':variant,'address':at,
                        'bytesHex':bytes(self.u.mem_read(at,128)).hex(),
                        'compiledPipeline':compiled,'compiledPipelineHex':bytes(self.u.mem_read(compiled,32)).hex(),
                        'nativePipeline':pipeline,'nativeBinding':binding,'nativeProgram':program,
                        'vertexPath':self.cstring(self.q(at+0x30)).decode('ascii'),
                        'pixelPath':self.cstring(self.q(at+0x38)).decode('ascii')})
                rows.append({'index':index,'address':row,'name':name,'hash':identity,
                    'bytesHex':bytes(self.u.mem_read(row,32)).hex(),'variants':values})
            aliases_at=self.q(material+0x40);alias_count=self.u32(material+0x48)
            if alias_count>64 or alias_count and self.allocations.get(aliases_at,0)<alias_count*8:
                raise ValueError('Original material aliases exceed owned bounds')
            aliases=[{'sourceHash':self.u32(aliases_at+i*8),'queryHash':self.u32(aliases_at+i*8+4)} for i in range(alias_count)]
            queries={v['hash']:v['name'] for v in registered}
            queries.update({v['hash']:v['name'] for v in rows})
            queries.update({v['queryHash']:None for v in aliases})
            before=bytes(self.u.mem_read(0x10400000,self.next_heap-0x10400000))
            lookups=[]
            for identity,name in sorted(queries.items()):
                self.call(PASS_LOOKUP_RVA,{r.UC_X86_REG_RDI:material,r.UC_X86_REG_RSI:identity})
                selected=self.u.reg_read(r.UC_X86_REG_RAX)
                matches=[v for v in rows if v['address']==selected]
                if selected and len(matches)!=1:
                    raise ValueError('Original material pass lookup selected an unowned row')
                lookups.append({'name':name,'hash':identity,'selectedRow':matches[0]['index'] if selected else None})
            if before!=bytes(self.u.mem_read(0x10400000,len(before))):
                raise ValueError('Original material pass lookup mutated owned resources')
            result.append({'emitterIndex':actor['emitterIndex'],'link':actor['link'],'material':material,
                'headerHex':bytes(self.u.mem_read(material,0x90)).hex(),'rows':rows,'aliases':aliases,'lookups':lookups})
        return {'registeredPasses':registered,'actors':result,'lookupRva':PASS_LOOKUP_RVA,
            'nameHashRva':PASS_NAME_HASH_RVA,'passTableRva':PASS_TABLE_RVA,
            'lookupReadOnly':True}
