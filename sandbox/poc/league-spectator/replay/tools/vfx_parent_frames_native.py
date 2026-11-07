"""Complete admitted parent updates and owned quad/trail vertex output.

Resources and authored definitions come from the original activation path.
Clocks, camera and suspension remain explicit supplied inputs. No per-emitter
reset/projection replaces the parent's scheduler. Other primitives fail closed.
"""
import ctypes as C
import copy
import json
import math
import struct
import unicorn
from unicorn import x86_const as r
from vfx_mesh_native import NativeVfxMeshContext
from vfx_spawn_native import ADDRESSES as A,VECTORS,name_hash,sha
from vfx_emitter_native import GEOMETRY as G
from vfx_camera_quad_native import CAMERA_CACHE,CAMERA_INPUT

WRITERS={0x23f23b0:('camera-quad',0x1733290),0x23f20c8:('arbitrary-quad',0x1730410),
    0x23f6520:('camera-trail',0x1737570)}
PARENT_TICK=0x1763220
CHECKPOINT_FIELDS=['allocations','next_heap','heap_high_water','object_addresses','object_attrs','object_mutexes',
    'object_semaphores','resource_mutexes','file_mutex','clock_context','clock_timebase','random_seed',
    'thread_destructors','thread_destructor_calls','object_image_pages','dirty_pages',
    'frame_parent','frame_object','frame_actors','last_parent_time']


def float_bits(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]
def checkpoint_json(value):
    if isinstance(value,bytes):return {'bytesHex':value.hex()}
    raise TypeError('Unserializable native parent checkpoint state')


class NativeVfxParentFrames(NativeVfxMeshContext):
    def __init__(self,*args,**kwargs):
        self.frame_parent=None;self.frame_object=None;self.frame_actors=[];self.in_parent_tick=False
        self.parent_substeps=[];self.last_parent_time=None
        self.parent_generation=0;self.parent_checkpoints={}
        super().__init__(*args,**kwargs)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.capture_parent_substep,
            begin=self.base+0x1757f10,end=self.base+0x1757f10)

    def imported(self,uc,address,size,user):
        name=self.source.imports[address-self.base]
        if name not in ['_modff','_expf']:return super().imported(uc,address,size,user)
        x=struct.unpack('<f',struct.pack('<I',uc.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0]
        extra={}
        if name=='_modff':
            target=uc.reg_read(r.UC_X86_REG_RDI)
            if not A['stack']-0x8000<=target<=A['stack']-4:raise ValueError('Parent modff target outside owned stack')
            integer=C.c_float();fn=self.crt.modff;fn.argtypes=[C.c_float,C.POINTER(C.c_float)];fn.restype=C.c_float
            value=fn(x,C.byref(integer));self.put(target,'f',integer.value);extra['integer']=integer.value
        else:
            fn=self.crt.expf;fn.argtypes=[C.c_float];fn.restype=C.c_float;value=fn(x)
        self.math_calls.append({'name':name,'x':x,'result':[value],**extra})
        uc.reg_write(r.UC_X86_REG_XMM0,float_bits(value));self.ret()

    def load_prepared_system(self,graph):
        super().load_prepared_system(graph)
        self.frame_parent=None;self.frame_object=None;self.frame_actors=[];self.in_parent_tick=False
        self.parent_substeps=[];self.last_parent_time=None
        self.parent_generation+=1;self.parent_checkpoints={}

    def parent_resource_identity(self):
        maps=['native_textures','native_shaders','native_programs','native_pipelines','native_bindings','native_mesh_buffers','native_mesh_layouts']
        return (tuple((name,tuple(sorted((key,id(value)) for key,value in getattr(self,name).items()))) for name in maps),
            tuple((id(t),t.value) for t in self.device.textures),
            tuple(len(getattr(self,name)) for name in ['file_lookups','file_opens','file_reads','file_closes']))

    def parent_checkpoint_data(self):
        if self.frame_parent is None or self.in_parent_tick or self.owned_thread_finished:
            raise ValueError('Parent checkpoint requires a live idle owned context')
        if any(m['depth'] for m in [*self.object_mutexes.values(),*self.resource_mutexes.values(),self.file_mutex]):
            raise ValueError('Parent checkpoint cannot retain a locked mutex')
        regions=[(0x10000000,0x400000),(0x10400000,self.next_heap-0x10400000),
            (self.base+0x1fef000,len(self.image)-0x1fef000)]
        return {'generation':self.parent_generation,'resources':self.parent_resource_identity(),
            'memory':[(at,bytes(self.u.mem_read(at,size))) for at,size in regions],
            'host':{name:copy.deepcopy(getattr(self,name)) for name in CHECKPOINT_FIELDS}}

    @staticmethod
    def parent_checkpoint_digest(data):
        host=json.dumps(data['host'],sort_keys=True,separators=(',',':'),default=checkpoint_json).encode()
        return sha(b''.join(raw for _,raw in data['memory'])+host)

    def checkpoint_parent(self):
        token=object();data=self.parent_checkpoint_data();data['digest']=self.parent_checkpoint_digest(data)
        self.parent_checkpoints[token]=data;return token

    def restore_parent(self,token):
        data=self.parent_checkpoints.get(token)
        if (data is None or data['generation']!=self.parent_generation or self.in_parent_tick or self.owned_thread_finished or
                data['resources']!=self.parent_resource_identity()):
            raise ValueError('Stale/unowned parent checkpoint or changed GPU/file resources')
        for at,raw in data['memory']:self.u.mem_write(at,raw)
        for name,value in data['host'].items():setattr(self,name,copy.deepcopy(value))
        self.parent_substeps=[];self.math_calls.clear();self.births.clear()
        if self.parent_checkpoint_digest(self.parent_checkpoint_data())!=data['digest']:
            raise ValueError('Parent checkpoint restoration differs from captured CPU world')

    def release_parent_checkpoint(self,token):
        if token not in self.parent_checkpoints:raise ValueError('Unowned parent checkpoint release')
        del self.parent_checkpoints[token]

    def parent_memory_digest(self):return self.parent_checkpoint_digest(self.parent_checkpoint_data())

    def own_parent(self,obj):
        if obj not in self.object_addresses or self.in_parent_tick:raise ValueError('Parent object is unowned or an update is active')
        parent=self.q(obj+0x28)
        if self.allocations.get(parent)!=0x2c0:raise ValueError('Parent allocation differs')
        properties=self.type_catalog['45cd899f']['properties']
        field=next(p for p in properties if p['hash']==name_hash('complexEmitterDefinitionData'))
        definitions=[self.q(row) for row in self.vector(A['definition']+field['offset'],8,4096)]
        disabled_field=next(p for p in self.type_catalog['09cde442']['properties'] if p['hash']==name_hash('disabled'))
        if disabled_field['offset']!=0x10 or disabled_field['type']!=1 or disabled_field['mask']!=0:
            raise ValueError('Original disabled-emitter byte contract differs')
        disabled=[]
        for i,definition in enumerate(definitions):
            value=self.u.mem_read(definition+disabled_field['offset'],1)[0]
            if value not in [0,1]:raise ValueError('Native authored disabled field is not boolean')
            if value:disabled.append(i)
        actors=[]
        for off,kind,size in [(0x40,'complex',0x120),(0x60,'animated',0x280)]:
            for row in self.vector(parent+off,8,4096):
                actor=self.q(row)
                if self.allocations.get(actor)!=size or (kind=='complex' and self.q(actor)!=parent):raise ValueError('Parent actor allocation/owner differs')
                record={'kind':kind,'pointer':actor,'allocationBytes':size}
                if kind=='complex':
                    link=self.q(actor+8);definition=self.q(link+0x10)
                    if definitions.count(definition)!=1:raise ValueError('Parent actor does not identify one authored emitter')
                    primitive=self.q(definition+0x60)
                    if not self.library_pointer(primitive,8):raise ValueError('Parent actor primitive is outside owned memory')
                    vtable=self.q(primitive)-self.base
                    record.update(link=link,linkAllocationBytes=self.allocations.get(link),definition=definition,
                        emitterIndex=definitions.index(definition),primitive=primitive,primitiveVtableRva=vtable)
                actors.append(record)
        self.frame_parent=parent;self.frame_object=obj;self.frame_actors=actors
        self.last_parent_time=f32(sum(struct.unpack('<2f',self.u.mem_read(parent+0x130,8))))
        if not math.isfinite(self.last_parent_time):raise ValueError('Parent initial clock is not finite')
        return {'object':obj,'parent':parent,'actors':actors,'initialTime':self.last_parent_time,
            'nativeDefinitionFieldOffset':field['offset'],'disabledEmitters':disabled,
            'nativeDisabledField':disabled_field,'disabledResourceSkipRva':0x16e9191}

    def capture_parent_substep(self,uc,address,size,user):
        if not self.in_parent_tick:return
        actor=uc.reg_read(r.UC_X86_REG_RDI)
        if actor not in {a['pointer'] for a in self.frame_actors if a['kind']=='complex'}:
            raise ValueError('Parent tick reached an unowned/child emitter')
        value=struct.unpack('<f',struct.pack('<I',uc.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0]
        self.parent_substeps.append({'actor':actor,'time':value})

    def tick_parent(self,time,max_substeps):
        if (self.frame_parent is None or type(time) not in [int,float] or not math.isfinite(time) or
                not self.last_parent_time<=f32(time)<=self.last_parent_time+30 or type(max_substeps) is not int or not 1<=max_substeps<=20):
            raise ValueError('Parent tick requires a monotonic clock and bounded substep count')
        self.parent_substeps=[];self.math_calls.clear();self.births.clear();self.in_parent_tick=True
        try:self.call(PARENT_TICK,{r.UC_X86_REG_RDI:self.frame_parent,r.UC_X86_REG_RSI:max_substeps,r.UC_X86_REG_XMM0:float_bits(time)})
        finally:self.in_parent_tick=False
        self.last_parent_time=f32(time)
        return {'time':self.last_parent_time,'substeps':list(self.parent_substeps),'state':self.parent_state()}

    def suspend_parent(self,suspended):
        if type(suspended) is not bool or self.frame_object is None:raise ValueError('Owned parent and explicit suspension required')
        complex_actors=[a for a in self.frame_actors if a['kind']=='complex']
        before=[self.u.mem_read(a['pointer']+0x18,1)[0] for a in complex_actors]
        self.call(0x1767070,{r.UC_X86_REG_RDI:self.frame_object,r.UC_X86_REG_RSI:int(suspended)})
        self.fragment(0x17661c5,0x1766243,{r.UC_X86_REG_RBX:self.frame_object})
        after=[self.u.mem_read(a['pointer']+0x18,1)[0] for a in complex_actors]
        if after!=[(value&~2)|(int(suspended)<<1) for value in before]:raise ValueError('Parent suspension did not propagate to every emitter')
        return {'before':before,'after':after,'suspended':suspended}

    def parent_state(self):
        if self.frame_parent is None:raise ValueError('No owned parent')
        for kind,off in [('complex',0x40),('animated',0x60)]:
            actual=[self.q(row) for row in self.vector(self.frame_parent+off,8,4096)]
            if actual!=[a['pointer'] for a in self.frame_actors if a['kind']==kind]:
                raise ValueError('Parent actor creation/removal requires another ownership transition')
        actors=[]
        for actor in self.frame_actors:
            pointer=actor['pointer'];record={**actor,'bytesHex':bytes(self.u.mem_read(pointer,actor['allocationBytes'])).hex()}
            if actor['kind']=='complex':
                if (self.q(pointer)!=self.frame_parent or self.q(pointer+8)!=actor['link'] or
                        self.q(actor['link']+0x10)!=actor['definition'] or self.q(actor['definition']+0x60)!=actor['primitive'] or
                        self.q(actor['primitive'])!=self.base+actor['primitiveVtableRva']):
                    raise ValueError('Parent actor/definition/primitive ownership changed')
                pool=self.q(pointer+0xa0);vectors={}
                if self.allocations.get(pool)!=0xf0:raise ValueError('Parent particle pool owner differs')
                for name,(offset,stride) in VECTORS.items():
                    data,count,capacity=struct.unpack('<QII',self.u.mem_read(pool+offset,16))
                    if count>4096 or count>(capacity&0x7fffffff) or (count and not self.library_pointer(data,count*stride)):
                        raise ValueError('Parent particle vector exceeds owned memory')
                    vectors[name]={'address':data,'count':count,'capacity':capacity&0x7fffffff,
                        'bytesHex':bytes(self.u.mem_read(data,count*stride)).hex() if count else ''}
                record.update(pool=pool,poolHex=bytes(self.u.mem_read(pool,0xf0)).hex(),vectors=vectors)
            actors.append(record)
        return {'parentHex':bytes(self.u.mem_read(self.frame_parent,0x2c0)).hex(),'actors':actors,
            'rngHex':bytes(self.u.mem_read(A['stream']+8,12)).hex(),'nextHeap':self.next_heap}

    def render_parent(self,camera):
        for name in ['position','right','up','axis']:
            v=camera.get(name)
            if not isinstance(v,list) or len(v)!=3 or any(type(x) not in [int,float] or not math.isfinite(x) for x in v):
                raise ValueError('Parent geometry requires explicit finite camera inputs')
        axes=[camera[k] for k in ['right','up','axis']]
        if any(abs(sum(v*v for v in a)-1)>2e-5 for a in axes) or any(abs(sum(x*y for x,y in zip(axes[a],axes[b])))>2e-5 for a,b in [(0,1),(0,2),(1,2)]):
            raise ValueError('Parent camera axes must be unit and orthogonal')
        state=self.parent_state()
        # Admit the whole root before writing any geometry. Empty pools do not
        # hide an unsupported primitive or an animated sibling.
        for actor in state['actors']:
            if actor['kind']!='complex' or actor['primitiveVtableRva'] not in WRITERS:
                raise ValueError('Parent geometry requires another primitive/animated-actor writer')
            if actor['vectors']['life']['count']>1024:raise ValueError('Parent geometry exceeds admitted particle count')
            if self.q(self.base+actor['primitiveVtableRva']+0x28)-self.base!=WRITERS[actor['primitiveVtableRva']][1]:
                raise ValueError('Original parent primitive writer method differs')
        self.put(G['view'],'fff',*camera['position']);self.put(G['view']+0x24,'fff',*camera['axis'])
        self.put(CAMERA_INPUT,'fff',*camera['up']);self.put(CAMERA_INPUT+0x10,'fff',*camera['right'])
        self.call(0x1746290,{r.UC_X86_REG_RDI:CAMERA_CACHE+0x158,r.UC_X86_REG_RSI:CAMERA_INPUT,r.UC_X86_REG_RDX:CAMERA_INPUT+0x10})
        self.put(CAMERA_CACHE,'Q',G['view']);self.put(A['manager']+0x338,'QI',CAMERA_CACHE,1)
        draws=[]
        for actor in state['actors']:
            kind,writer=WRITERS[actor['primitiveVtableRva']];count=actor['vectors']['life']['count']
            nv_max=count*(56 if kind=='camera-trail' else 112)
            ni_max=max(0,count-1)*12 if kind=='camera-trail' else count*12
            self.u.mem_write(G['context'],bytes(0x3000))
            self.put(G['view'],'fff',*camera['position']);self.put(G['view']+0x24,'fff',*camera['axis'])
            for off,value in [(0,G['indices']),(8,G['vertices']),(0x10,G['draw']),(0x18,actor['pointer']),(0x20,G['view'])]:self.put(G['context']+off,'Q',value)
            def guard(uc,access,address,size,value,user):
                if not ((G['indices']<=address<address+size<=G['indices']+ni_max) or
                        (G['vertices']<=address<address+size<=G['vertices']+nv_max)):
                    raise ValueError('Parent primitive writer exceeded its owned output')
            hook=self.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,guard,begin=G['indices'],end=0x100affff)
            try:self.call(writer,{r.UC_X86_REG_RDI:actor['primitive'],r.UC_X86_REG_RSI:G['context']})
            finally:self.u.hook_del(hook)
            nv=self.q(G['context']+8)-G['vertices'];ni=self.q(G['context'])-G['indices']
            if not (0<=nv<=nv_max and 0<=ni<=ni_max and nv%28==0 and ni%2==0):raise ValueError('Parent geometry output cursor differs')
            if kind!='camera-trail' and (nv!=nv_max or ni!=ni_max):raise ValueError('Parent quad geometry omitted live particles')
            indices=bytes(self.u.mem_read(G['indices'],ni));vertices=bytes(self.u.mem_read(G['vertices'],nv))
            if any(i>=nv//28 for i in struct.unpack('<'+'H'*(ni//2),indices)):raise ValueError('Parent geometry index exceeds vertices')
            draws.append({'emitterIndex':actor['emitterIndex'],'actor':actor['pointer'],'kind':kind,'particleCount':count,
                'verticesHex':vertices.hex(),'indicesHex':indices.hex(),'drawHex':bytes(self.u.mem_read(G['draw'],16)).hex()})
        return draws
