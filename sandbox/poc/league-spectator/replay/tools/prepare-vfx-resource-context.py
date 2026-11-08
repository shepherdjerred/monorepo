"""Observe original resource-context initialization and parent activation.

No-emitter definitions exercise complete parent activation with explicitly
supplied clocks. Populated effects retain their real graphics-resource boundary.
"""
import argparse,inspect,json,struct
from pathlib import Path
from collections import Counter
from unicorn import x86_const as r
from vfx_resource_native import NativeVfxResourceContext,RESOURCE_MANAGER_INPUT_BLOCKS,TEXTURE_MANAGER_PREFIX
from vfx_spawn_native import ADDRESSES as A,sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:parser.add_argument(name,type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';inputs={}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    systems=read(assets/'latest-vfx-system-assets/package.json');effects=read(assets/'latest-effects/manifest.json')
    n=NativeVfxResourceContext(assets/'decoder-16.21-macos',args.client)
    initialized_image=bytes(n.u.mem_read(n.base,len(n.image)))
    baseline={'heapStart':0x10400000,'heapEnd':n.baseline_heap,'heapHex':n.system_baseline.hex(),
        'allocations':list(n.baseline_allocations.items()),'mutexes':n.baseline_mutexes,
        'globals':[{'rva':at,'bytesHex':initialized_image[at:at+4096].hex()}
            for at in range(0,len(n.image),4096) if initialized_image[at:at+4096]!=n.image[at:at+4096]],
        'ownedInputs':[{'address':0x100b0000,'bytesHex':bytes(n.u.mem_read(0x100b0000,8)).hex()}]}
    library_names=['_mach_timebase_info','_strlen','_strcmp','___bzero','____chkstk_darwin']
    library_imports={name:at for at,name in n.source.imports.items() if name in library_names}
    spawn=read(assets/'decoder-16.21-macos/vfx-spawn.json')
    seed_ref=spawn['templates'][0]
    seed_graph=read(assets/'decoder-16.21-macos'/seed_ref['file'])
    if inputs[str((assets/'decoder-16.21-macos'/seed_ref['file']).resolve())]!=seed_ref['sha256']:
        raise ValueError('Original initialized unit-default graph changed')
    initialized_globals=seed_graph['globals']
    if len(initialized_globals)!=1 or initialized_globals[0]['rva']!=0x256c9c0 or len(initialized_globals[0]['bytesHex'])!=0x180*2:
        raise ValueError('Unsupported original unit-default globals')
    names=[key for key in systems['systems'] if effects['definitions'][key]['complexEmitters']==0 and effects['definitions'][key]['simpleEmitters']==0]
    cases=[];original_blocks={};graphs={}
    schedules=[{'mode':mode,'ticks':[2123456789,3987654321,7111111111],
        'timebase':[1,1],'firstBits':0x3f800000,'secondBits':0x3f800000} for mode in [0,1,2]]
    schedules.extend([{'mode':mode,'ticks':[12345,43210,76543],
        'timebase':[numer,denom],'firstBits':0x3fc00000,'secondBits':0x3f000000}
        for mode,numer,denom in [(0,125,3),(1,1,3),(2,3,1)]])
    for name in names:
        ref=systems['systems'][name];graph=read(assets/'latest-vfx-system-assets'/ref['file'])
        if inputs[str((assets/'latest-vfx-system-assets'/ref['file']).resolve())]!=ref['sha256']:
            raise ValueError('Parent activation root changed')
        graphs[name]=graph
        for schedule in schedules[:3] if name!=names[0] else schedules:
            n.load_prepared_system(graph);initial=n.initialize_resource_context(0,False)
            for g in initialized_globals:
                if bytes(n.u.mem_read(n.base+g['rva'],len(g['bytesHex'])//2)).hex()!=g['bytesHex']:
                    raise ValueError('Original native unit-default initialization differs')
            clock=n.supply_clock_inputs(schedule['ticks'],schedule['mode'],schedule['timebase'])
            at=n.create_object();n.set_scalars(at,schedule['firstBits'],schedule['secondBits']);n.mark_ready(at)
            initial_object=bytes(n.u.mem_read(at,0x238))
            n.call(0x1765960,{r.UC_X86_REG_RDI:at});parent=n.q(at+0x28)
            if n.allocations.get(parent)!=0x2c0 or n.u32(A['manager']+0x188)!=1:
                raise ValueError('Native parent activation or active queue differs')
            before_parent=bytes(n.u.mem_read(parent,0x2c0));count=n.u32(A['manager']+0x188)
            # An activation is a one-shot operation in this component; do not
            # infer repeat-call idempotence from mark-ready or parent presence.
            actual_root=bytes(n.u.mem_read(A['definition'],0x160));expected_root=bytes.fromhex(graph['objectHex'])
            if actual_root[:0x150]!=expected_root[:0x150] or bytes(n.u.mem_read(graph['heapStart'],ref['heapBytes'])).hex()!=graph['heapHex']:
                raise ValueError('Parent activation changed authored fields or asset heap')
            # 0x16e9d50 appends its resource to the definition's native observer
            # vector at +0x150; this is runtime bookkeeping, not serialized data.
            observers,observer_count,observer_capacity=struct.unpack_from('<QII',actual_root,0x150)
            resource=n.q(parent+0x1d8)
            if observer_count!=1 or observer_capacity!=1 or n.q(observers)!=resource+0x60 or n.q(resource+0x68)!=resource:
                raise ValueError('Original definition resource-observer callback differs')
            if struct.unpack_from('<f',before_parent,0x12c)[0]<=0:
                raise ValueError('Supplied nonzero clock did not reach native parent')
            cases.append({'effectId':name,'graphSha256':ref['sha256'],'input':schedule,
                'initialContext':initial,'clock':clock,'object':at,'initialObjectHex':initial_object.hex(),
                'objectHex':bytes(n.u.mem_read(at,0x238)).hex(),'parent':parent,'parentHex':before_parent.hex(),
                'activeParentCount':count,'rootAfterHex':actual_root.hex(),
                'observerResource':resource,'observerCallback':n.q(observers),
                'managerHex':bytes(n.u.mem_read(A['manager'],0x3a8)).hex(),
                'resourceContext':n.resource_context_state(),'osCalls':list(n.object_os_calls)})
            original_blocks.update(n.blocks)
    # Retain a genuine populated-asset boundary, not a successful factory sink.
    populated='champions/vladimir/39/9fbafd14';ref=systems['systems'][populated]
    graph=read(assets/'latest-vfx-system-assets'/ref['file'])
    n.load_prepared_system(graph);n.initialize_resource_context(0,False);n.supply_clock_inputs([0,0,0],0,[1,1])
    at=n.create_object();n.set_scalars(at,0x3f800000,0x3f800000);n.mark_ready(at)
    boundary=None
    try:n.call(0x1765960,{r.UC_X86_REG_RDI:at})
    except Exception as error:
        boundary={'effectId':populated,'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'error':str(error)}
    if not boundary or boundary['rva']!=0x17e34c8:
        raise ValueError('Expected missing default graphics resource boundary changed')
    original_blocks.update(n.blocks)
    paths={Path(inspect.getfile(c)) for c in NativeVfxResourceContext.__mro__ if c is not object}
    paths.update([Path(__file__),Path(__file__).with_name('macho.py')])
    ranges=[*RESOURCE_MANAGER_INPUT_BLOCKS,TEXTURE_MANAGER_PREFIX,(0x17c3fd0,0x17c4032),
        (0x14db4b0,0x14db530),(0x15eaeac,0x15eaf0a),(0x15ed8e0,0x15ed907),
        (0x1765960,0x1765a44),(0x174bca0,0x174be88),(0x1760840,0x1760fd8),
        (0x174bb60,0x174bc9d),(0x16e9d50,0x16e9ffa)]
    package={'schema':1,'kind':'native-vfx-resource-context','build':n.profile['clientVersion'],
        'protocol':n.profile['protocolDigest'],'decoderImageSha256':n.profile['decoderImageSha256'],
        'objectPackageSha256':sha((assets/'latest-vfx-objects/package.json').read_bytes()),
        'managerInputBlocks':RESOURCE_MANAGER_INPUT_BLOCKS,'textureManagerPrefix':TEXTURE_MANAGER_PREFIX,
        'initializedGlobals':initialized_globals,'initializedGlobalsSourceSha256':seed_ref['sha256'],
        'assetBaseline':baseline,'libraryImports':library_imports,
        'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])} for a,b in ranges],
        'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
        'scope':{'fullMaterialCacheConstructor':True,'textureManagerPrefix':True,
            'originalClockGetterAndFrequencyExecuted':True,'clockInputsSupplied':True,
            'authoredFieldsPreserved':True,'nativeResourceObserverVectorMutated':True,
            'noEmitterParentsActivated':True,'populatedEffectGraphicsBoundaryUnresolved':True,
            'fullTextureManagerConstructor':False,'graphicsProvider':False,'mainViewerIntegrated':False}}
    directory=assets/'latest-vfx-resource-context';directory.mkdir(exist_ok=True)
    raw=json.dumps(package,indent=2).encode();(directory/'package.json').write_bytes(raw)
    counts={'roots':len(names),'activations':len(cases),'timebases':len({tuple(c['input']['timebase']) for c in cases}),
        'selectorModes':len({c['input']['mode'] for c in cases}),'populatedBoundaries':1}
    result={'schema':1,'kind':'native-vfx-resource-context-observations','packageSha256':sha(raw),
        'inputs':inputs,'sources':package['sources'],'originalBlocks':list(original_blocks.values()),
        'cases':cases,'boundary':boundary,'counts':counts,'scope':package['scope']}
    (cache/'research/vfx-resource-context-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'counts':counts,'boundary':boundary}))


if __name__=='__main__':main()
