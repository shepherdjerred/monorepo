"""Original world factory over decoded detached descriptors and complete maps.

All referenced character maps are deserialized and typed-link-fixed. The chosen
root reuses the exact prepared live root; other map roots are loaded unchanged.
No unit ID, attachment field, packet vector or authored map row is discarded.
"""
import importlib.metadata
import io
import json
from pathlib import Path
import runpy
import math
import struct
import cdtb.binfile as binfile
from unicorn import x86_const as r
from world_descriptor_native import NativeWorldDescriptors,DESCRIPTOR,AUXILIARIES,OUTPUT
from effect_link_native import NativeEffectLinks
from effect_resolver_native import NativeEffectResolverAssets
from vfx_asset_native import REGISTRY
import unicorn
from vfx_ray_frames_native import NativeRayParentFrames
from vfx_spawn_native import ADDRESSES as A,sha
from vfx_parent_frames_native import f32,float_bits


class ReplayDescriptorLibraries:
    def __init__(self,fixture):
        self.fixture=fixture;self.effects=fixture.read(fixture.assets/'latest-effects/manifest.json')
        self.contexts=fixture.read(fixture.assets/'latest-effect-contexts/package.json')
        self.resolvers=fixture.read(fixture.cache/'research/effect-resolvers-native.json')
        self.by_identity={c['identity']:c for c in self.contexts['contexts']}
        self.resolver_cases={c['actorKey']:c for c in self.resolvers['cases']}
        self.parsed={};self.resolver_fields={}
        distribution=importlib.metadata.distribution('cdtb')
        if json.loads(distribution.read_text('direct_url.json'))['vcs_info']['commit_id']!='3367589fdd3ee3d0d01383d2f98dba12b04d1371':
            raise ValueError('Typed BIN parser revision differs')
        names=runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
        for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
            path=fixture.cache/'vfx'/('hashes.'+name+'.txt')
            if sha(fixture.raw(path))!=self.effects['toolchain']['dictionaries'][name]:raise ValueError('Typed BIN dictionary differs')
            dictionary.hashes=names(path)
        for dictionary in [binfile.hashfile_binentries,binfile.hashfile_binhashes,binfile.hashfile_binhashes_xxh3,binfile.hashfile_binpaths]:dictionary.hashes={}

    def bin_bytes(self,digest):
        if digest not in self.parsed:
            path=self.fixture.cache/'research/latest-effects/bins'/(digest+'-'+self.effects['toolchain']['parserIdentity'][:16]+'.bin')
            data=self.fixture.raw(path)
            if sha(data)!=digest or data[:4]!=b'PROP':raise ValueError('Typed asset source changed')
            self.parsed[digest]=data
        return self.parsed[digest]

    def system_fields(self,ref):
        data=self.bin_bytes(ref['rawSourceSha256']);result=[]
        for field in ref['fields']:
            value=data[field['offset']:field['offset']+field['bytes']]
            if len(value)!=field['bytes'] or sha(value)!=field['sha256']:raise ValueError('Typed system field changed')
            result.append(value)
        return result

    def map_fields(self,actor_key):
        if actor_key in self.resolver_fields:return self.resolver_fields[actor_key]
        case=self.resolver_cases[actor_key]
        if case['status']!='native-resource-map-loaded':raise ValueError('Context runtime resource getter is unresolved: '+actor_key)
        data=self.bin_bytes(case['sourceSha256'])
        class Reader(binfile.BinReader):
            def __init__(self,*args):super().__init__(*args);self.spans={}
            def read_field(self,htype):
                start=self.f.tell();field=super().read_field(htype);self.spans[id(field)]=(start,self.f.tell());return field
        stream=io.BytesIO(data);stream.read(4);reader=Reader(stream)
        _,_,types=reader.read_binfile_header()
        entries={e.path.h:e for e in [reader.read_binfile_entry(t) for t in types]}
        fields=[data[a:b] for a,b in [reader.spans[id(f)] for f in entries[case['resourceResolverId']].fields]]
        if [{'bytes':len(v),'sha256':sha(v)} for v in fields]!=case['fields']:raise ValueError('Native resolver field spans changed')
        self.resolver_fields[actor_key]=fields;return fields

    def install(self,n,identities,effect_id):
        result={};root_entries={};loaded_roots={}
        # The warmed graph's root is a fixed-address preparation input rather
        # than a heap allocation. Build an owned, original-constructed root for
        # the typed library, retaining its complete immutable post-load bytes
        # and child pointers. The original typed-fixup ownership gate stays intact.
        prepared=bytes(n.u.mem_read(A['definition'],n.system_size))
        selected_root=n.allocate(n.system_size)
        n.call(0x1786e80,{r.UC_X86_REG_RDI:selected_root})
        n.u.mem_write(selected_root,prepared)
        if bytes(n.u.mem_read(selected_root,n.system_size))!=prepared:raise ValueError('Owned prepared root bytes changed')
        for identity in dict.fromkeys(identities):
            context=self.by_identity.get(identity)
            if context is None:raise ValueError('Unprepared auxiliary context identity: '+str(identity))
            actor_key=context['actorKey'];actor=self.effects['actors'][actor_key]
            fields=self.map_fields(actor_key)
            ids=sorted(set(v['effectId'] for v in actor['resources'].values() if v['status']=='prepared-definition'))
            entries=[]
            for root_id in ids:
                if root_id not in root_entries:
                    if root_id==effect_id:
                        entry={'object':selected_root,'typeRva':n.system_type-n.base}
                    else:entry=n.load_live_system(self.system_fields(self.fixture.systems['systems'][root_id]))
                    root_entries[root_id]={'identity':int(root_id.rsplit('/',1)[1],16),'effectId':root_id,
                        'object':entry['object'],'typeRva':entry['typeRva']}
                    loaded_roots[root_id]=entry['object']
                    if len(loaded_roots)%50==0:print(json.dumps({'stage':'complete-library-roots','effectId':effect_id,'loaded':len(loaded_roots),'actor':actor_key}),flush=True)
                entries.append(root_entries[root_id])
            loaded=n.read_resolver_fields(fields)
            if loaded['rows']!=self.resolver_cases[actor_key]['loaded']['rows']:raise ValueError('Complete authored map changed')
            fixed=n.fix_resolver_links(loaded,sorted(entries,key=lambda v:v['identity']))
            if fixed['status']!='typed-local-links-resolved':
                raise ValueError('Complete context library requires global assets: '+actor_key+' '+str(fixed['missingReferenceTokens']))
            character=n.character_context(context['name'],context['skinId'])
            if character['identity']!=identity:raise ValueError('Original context identity differs from replay auxiliary ID')
            n.put(character['object']+0x60,'Q',loaded['object'])
            result[identity]={'context':character,'resolver':loaded['object'],'rows':len(loaded['rows']),
                'roots':len(entries),'pendingAfter':fixed['pendingAfter']}
        return {'contexts':result,'loadedRoots':loaded_roots,'selectedDefinition':selected_root,
            'preparedRootCopy':{'source':A['definition'],'destination':selected_root,'bytes':len(prepared),'sha256':sha(prepared),
                'originalConstructorExecuted':True,'completePostloadBytesPreserved':True}}


class DeferredResolverAssets(NativeEffectResolverAssets):
    def __init__(self,*args):
        # Prepared roots contain absolute arena pointers. Preserve their frozen
        # loader baseline; initialize additional character reflection after the
        # root is warmed, rather than relocating its native allocation history.
        self.initializing_resource_types=False;self.resource_global_zeroes=[];self.resource_stack_probes=[]
        self.resolver_chain_stop=False;self.resolver_allocator_calls=[]
        super(NativeEffectResolverAssets,self).__init__(*args)

    def initialize_context_reflection(self):
        for at in [0x149a460,0x149a4c0]:
            entry=next(v for v in self.profile['modeledServices'] if v['rva']==at)
            if entry['service']!='bounded byte allocation in RDI':raise ValueError('Resource allocator contract changed')
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.resolver_allocate,begin=self.base+at,end=self.base+at)
        self.initializing_resource_types=True
        try:self.call(0x167ce00,{})
        finally:self.initializing_resource_types=False
        count=self.u32(self.base+REGISTRY+8);array=self.q(self.base+REGISTRY)
        if not 318<=count<=2048:raise ValueError('Character reflection registry exceeds bounds')
        self.types={}
        for i in range(count):
            pointer=self.q(array+i*8)
            if not self.base+0x1fef000<=pointer<=self.base+len(self.image)-0x88:raise ValueError('Character reflection descriptor outside image')
            identity=self.u32(pointer+8)
            if identity in self.types:raise ValueError('Duplicate character reflection identity')
            self.types[identity]=pointer
        self.type_catalog=self.catalog()
        if any(v not in self.types for v in [0xef3a0f33,0x72a165de,0xe9212d72]):raise ValueError('Required character reflection missing')


class DeferredEffectLinks(NativeEffectLinks,DeferredResolverAssets):
    pass


class NativeReplayWorldDescriptors(NativeWorldDescriptors,NativeRayParentFrames,DeferredEffectLinks):
    def __init__(self,*args,**kwargs):
        self.in_replay_factory=False
        super().__init__(*args,**kwargs)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.guard_replay_world_lookup,
            begin=self.base+0x548f00,end=self.base+0x548f00)

    def guard_replay_world_lookup(self,uc,address,size,user):
        if self.in_replay_factory and self.u.reg_read(r.UC_X86_REG_RSI)&0xffffffff:
            raise ValueError('Decoded factory requires unresolved nonzero world entity lookup: '+
                str(self.u.reg_read(r.UC_X86_REG_RSI)&0xffffffff))

    def initialize_replay_frame(self):
        # Explicit diagnostic camera volume, supplied to the original frustum
        # test and parent visibility scheduler. It is not recovered match FOW.
        camera=self.allocate(0x190,0xa5);array=self.allocate(8);frame=self.allocate(16)
        self.put(array,'Q',camera);self.put(frame,'QII',array,1,1)
        for i,(axis,sign) in enumerate([(0,1),(0,-1),(1,1),(1,-1),(2,1),(2,-1)]):
            normal=[0.,0.,0.];normal[axis]=float(sign)
            self.put(camera+0x78+0x6c+i*16,'4f',*normal,1000000.)
            indices=[j+(3 if normal[j]>=0 else 0) for j in range(3)]
            self.put(camera+0x78+0xcc+i*12,'3I',*indices)
        box=self.allocate(24);controls=[]
        for axis,sign in [(None,0),*[(a,s) for a in range(3) for s in [-1,1]]]:
            center=[0.,0.,0.]
            if axis is not None:center[axis]=sign*1000002.
            self.put(box,'6f',*[v-1 for v in center],*[v+1 for v in center])
            self.call(0x1494e00,{r.UC_X86_REG_RDI:camera+0x78,r.UC_X86_REG_RSI:box})
            actual=bool(self.u.reg_read(r.UC_X86_REG_RAX)&255);expected=axis is None
            if actual!=expected:raise ValueError('Original frustum test disagrees with the supplied camera volume')
            controls.append({'center':center,'intersects':actual})
        self.replay_frame=frame
        return {'frame':frame,'camera':camera,'array':array,'cameraHex':bytes(self.u.mem_read(camera,0x190)).hex(),
            'volumeMin':[-1000000.]*3,'volumeMax':[1000000.]*3,'originalFrustumControls':controls,
            'scope':'supplied visible research camera volume; not replay fog/visibility'}

    def synchronize_replay_object(self,obj):
        if obj!=self.frame_object or self.in_parent_tick or any(self.q(obj+off) for off in [0x170,0x180,0x190]):
            raise ValueError('Replay object synchronization requires a detached owned object and frame')
        self.parent_substeps=[];self.in_parent_tick=True
        try:self.call(0x1765a50,{r.UC_X86_REG_RDI:obj,r.UC_X86_REG_RSI:self.replay_frame,r.UC_X86_REG_RDX:0})
        finally:self.in_parent_tick=False
        return {'objectHex':bytes(self.u.mem_read(obj,0x238)).hex(),
            'parentHex':bytes(self.u.mem_read(self.frame_parent,0x2c0)).hex(),
            'nativeCatchupSubsteps':list(self.parent_substeps),
            'objectTimeOffset':struct.unpack('<f',self.u.mem_read(obj+0x1f0,4))[0],
            'frame':self.replay_frame,'originalObjectSyncExecuted':True}

    def tick_replay_frame(self,time,max_substeps):
        if (not isinstance(time,(int,float)) or not math.isfinite(time) or
                not self.last_parent_time<=f32(time)<=self.last_parent_time+30 or
                type(max_substeps) is not int or not 1<=max_substeps<=20):
            raise ValueError('Replay frame requires explicit monotonic time and bounded scheduler work')
        self.parent_substeps=[];self.math_calls.clear();self.births.clear();self.in_parent_tick=True
        try:self.call(0x1744c20,{r.UC_X86_REG_RDI:self.frame_parent,r.UC_X86_REG_RSI:self.replay_frame,
            r.UC_X86_REG_RDX:0,r.UC_X86_REG_RCX:max_substeps,r.UC_X86_REG_XMM0:float_bits(time)})
        finally:self.in_parent_tick=False
        self.last_parent_time=f32(time)
        return {'time':self.last_parent_time,'substeps':list(self.parent_substeps),'state':self.parent_state(),
            'objectHex':bytes(self.u.mem_read(self.frame_object,0x238)).hex(),'originalVisibilitySchedulerExecuted':True}

    def create_decoded_detached(self,descriptor,libraries):
        for key in ['resourceContextEntityId','attachmentEntityId','lookup14EntityId','lookupA8EntityId']:
            if descriptor[key]!=0:raise ValueError('Decoded descriptor requires live entity resolution: '+key)
        data=bytes.fromhex(descriptor['descriptorHex'])
        if len(data)!=0xc0 or not descriptor['resourceKey'] or not descriptor['packetVectorsResolved']:
            raise ValueError('Complete keyed decoded descriptor required')
        # These fields are native pointers supplied zero by the packet reader.
        # Reject any nonzero pointer; the detached path never erases one.
        if any(struct.unpack_from('<Q',data,off)[0] for off in [0,0x10,0x18,0x20,0x28,0x30,0x38,0x40,0xa8]):
            raise ValueError('Decoded descriptor contains unresolved/nonzero pointer fields')
        ids=descriptor['unresolvedAuxiliaryContextIds']
        if len(ids)>4096:raise ValueError('Decoded auxiliary vector exceeds bound')
        array=self.allocate(max(8,len(ids)*8))
        for i,identity in enumerate(ids):
            supplied=libraries['contexts'].get(identity)
            if supplied is None:raise ValueError('Decoded auxiliary context was not fully prepared')
            self.put(array+i*8,'Q',supplied['context']['object'])
        self.u.mem_write(DESCRIPTOR,data)
        self.put(DESCRIPTOR+0x30,'QQQ',array,array+len(ids)*8,array+len(ids)*8)
        before=bytes(self.u.mem_read(DESCRIPTOR,0xc0))
        if before[:0x30]!=data[:0x30] or before[0x48:]!=data[0x48:]:raise ValueError('Decoded scalar/vector fields changed')
        self.u.mem_write(OUTPUT,bytes(16));self.shared_calls=[]
        self.in_replay_factory=True
        try:self.call(0x83ddc0,{r.UC_X86_REG_RDI:OUTPUT,r.UC_X86_REG_RSI:DESCRIPTOR})
        finally:self.in_replay_factory=False
        shared,control=self.q(OUTPUT),self.q(OUTPUT+8)
        if not shared:return {'status':'native-factory-returned-null','descriptorHex':before.hex()}
        if self.allocations.get(shared)!=8 or self.allocations.get(control)!=0x20:raise ValueError('Original replay factory shared ownership differs')
        wrapper=self.q(shared);obj=self.q(wrapper+0x178)
        if self.allocations.get(wrapper)!=0x268 or self.allocations.get(obj)!=0x238 or self.q(obj+0x48)!=libraries['selectedDefinition']:
            raise ValueError('Original replay factory selected another definition/entity type')
        if obj in self.object_addresses:raise ValueError('Original replay factory reused a tracked object')
        self.object_addresses.append(obj);self.observe_objects()
        self.call(0x1765960,{r.UC_X86_REG_RDI:obj})
        self.own_parent(obj);sync=self.synchronize_replay_object(obj);ownership=self.own_parent(obj)
        return {'status':'decoded-descriptor-created','descriptorHex':before.hex(),
            'finalDescriptorHex':bytes(self.u.mem_read(DESCRIPTOR,0xc0)).hex(),'shared':shared,'control':control,
            'wrapper':wrapper,'object':obj,'ownership':ownership,'synchronization':sync,
            'wrapperHex':bytes(self.u.mem_read(wrapper,0x268)).hex(),'objectHex':bytes(self.u.mem_read(obj,0x238)).hex(),
            'initialState':self.parent_state(),'sharedCalls':list(self.shared_calls)}
