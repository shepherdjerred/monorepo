"""Observe complete native parent scheduling, suspension and geometry.

Select the largest fully GPU-prepared quad/trail root for each available
champion. Every selected root stays in the report, including any boundary.
This is a component cohort, not arbitrary-match or browser acceptance.
"""
import argparse
from collections import Counter
import ctypes as C
import inspect
import json
from pathlib import Path
import time
from unicorn import x86_const as r
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from vfx_parent_frames_native import NativeVfxParentFrames,f32
from vfx_spawn_native import ADDRESSES as A,sha

CAMERA={'position':[0,1000,0],'right':[1,0,0],'up':[0,0,-1],'axis':[0,-1,0]}
def frame_digest(frame):
    return sha(json.dumps({k:frame[k] for k in ['time','substeps','state','geometry']},sort_keys=True,separators=(',',':')).encode())


def select_roots(fixture):
    assets=fixture.assets;effects=fixture.read(assets/'latest-effects/manifest.json')
    quad=fixture.read(assets/'latest-complete-quad-gpu/package.json')
    trail=fixture.read(assets/'latest-trail-particles/gpu.json')
    bindings={(e['effectId'],e['emitterIndex']):e for p in [quad,trail] for e in p['emitters']}
    if len(bindings)!=len(quad['emitters'])+len(trail['emitters']):raise ValueError('Ambiguous parent GPU emitter binding')
    candidates={}
    for effect_id,ref in effects['definitions'].items():
        path=assets/'latest-effects'/ref['file'];data=fixture.raw(path)
        if sha(data)!=ref['sha256']:raise ValueError('Parent cohort source definition changed')
        definition=json.loads(data)['definition'];emitters=definition.get('complexEmitterDefinitionData',[])
        if len(emitters)<2 or definition.get('simpleEmitterDefinitionData'):continue
        if any((effect_id,i) not in bindings for i in range(len(emitters))):continue
        actor=effect_id.split('/')[1]
        disabled=[i for i,e in enumerate(emitters) if e.get('disabled',False)]
        candidates.setdefault(actor,[]).append({'effectId':effect_id,'emitters':len(emitters),'authoredDisabledEmitters':disabled,
            'sourceDefinitionSha256':ref['sha256']})
    selected=[sorted(values,key=lambda v:(-v['emitters'],v['effectId']))[0] for _,values in sorted(candidates.items())]
    return selected,bindings,sum(map(len,candidates.values()))


def export_cache(n,activation,camera,directory):
    """Static initialized cache, before the second effect object is created.

    Offscreen graphics handles are retained only as CPU metadata. Any future
    browser runtime must bind its own graphics resources and reject unported
    host callbacks; these are not transferable GLES objects.
    """
    key=activation['effectId'].replace('/','-');segments=[]
    for address,size,label in [(0x10000000,0x400000,'io'),(0x10400000,n.next_heap-0x10400000,'heap')]:
        data=bytes(n.u.mem_read(address,size))
        if label=='heap':
            file=f'{key}-heap.bin';(directory/file).write_bytes(data)
            segments.append({'address':address,'file':file,'bytes':len(data),'sha256':sha(data)})
        else:
            for off in range(0,len(data),4096):
                page=data[off:off+4096]
                if not any(page):continue
                file=f'{key}-io-{off:06x}.bin';(directory/file).write_bytes(page)
                segments.append({'address':address+off,'file':file,'bytes':len(page),'sha256':sha(page)})
    current=bytes(n.u.mem_read(n.base,len(n.image)));patches=[]
    for off in range(0,len(current),4096):
        page=current[off:off+4096]
        if page==n.image[off:off+len(page)]:continue
        if off<0x1fef000:raise ValueError('Parent cache attempted to patch original executable code')
        file=f'{key}-image-{off:07x}.bin';(directory/file).write_bytes(page)
        patches.append({'rva':off,'file':file,'bytes':len(page),'sha256':sha(page)})
    record={'schema':1,'kind':'initialized-native-parent-resource-cache','effectId':activation['effectId'],
        'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'graphSha256':activation['graphSha256'],
        'decoderImageSha256':n.profile['decoderImageSha256'],'warmObject':activation['object'],'warmParent':activation['parent'],
        'clockContext':n.clock_context,'clockInput':activation['clockInput'],'warmSeed':activation['randomSeed'],
        'camera':camera,'segments':segments,'imagePatches':patches,'allocations':sorted(n.allocations.items()),'nextHeap':n.next_heap,
        'hostMutexes':{'object':n.object_mutexes,'resource':n.resource_mutexes},'hostAttributes':n.object_attrs,
        'threadDestructors':n.thread_destructors,'nativeBindings':n.material_backend.records,
        'scope':{'staticAuthoredAssetInitialization':True,'containsReplayEvents':False,'warmParentSuspended':True,
            'originalFactoryExecuted':True,'offscreenGraphicsBacked':True,'portableBrowserGraphicsHandles':False,
            'browserRun':False,'sceneGlobalsBound':False,'referenceCompared':False}}
    data=json.dumps(record,indent=2).encode();file=f'{key}.json';(directory/file).write_bytes(data)
    return {'file':file,'sha256':sha(data),'bytes':len(data),'effectId':activation['effectId']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:parser.add_argument(name,type=Path)
    parser.add_argument('--effect',action='append');parser.add_argument('--steps',type=int,default=60)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if not 1<=args.steps<=120:raise ValueError('Parent observation requires 1..120 canonical updates')
    cache=args.cache.resolve();fixture=NativeVfxFixture(cache);cohort,bindings,candidate_count=select_roots(fixture)
    if args.effect:
        if len(set(args.effect))!=len(args.effect) or not set(args.effect)<=set(fixture.systems['systems']):raise ValueError('Unknown/duplicate parent root')
        refs={v['effectId']:v for v in cohort}
        if not set(args.effect)<=set(refs):raise ValueError('Explicit root must be in the declared maximum-per-champion cohort')
        cohort=[refs[name] for name in args.effect]
    directory=fixture.assets/'latest-parent-frame-caches';directory.mkdir(parents=True,exist_ok=True)
    device=GraphicsTextureDevice(args.angle);n=NativeVfxParentFrames(fixture.assets/'decoder-16.21-macos',args.client,device=device)
    cases=[];blocks={};caches=[];began=time.monotonic()
    try:
        for selected in cohort:
            case={**selected,'status':'boundary','frames':[],'suspension':[]};shaders=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device)
            n.shader_catalog=shaders;texture_start=len(device.textures);device.uploads=[]
            try:
                activation=fixture.activate(n,selected['effectId'],12345,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                warm=n.own_parent(activation['object']);n.render_parent(CAMERA);n.suspend_parent(True)
                caches.append(export_cache(n,activation,CAMERA,directory));case['cache']=caches[-1]
                before={'shaders':len(shaders.requests),'pipelines':len(n.native_pipelines),'materials':len(n.native_bindings),'textures':len(n.preloaded_textures)}
                clock={'ticks':[2000000000]*3,'mode':0,'timebase':[1,1]};n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase'])
                seed=n.set_random_seed(9876);obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000);n.mark_ready(obj)
                n.call(0x1765960,{r.UC_X86_REG_RDI:obj});owned=n.own_parent(obj)
                after={'shaders':len(shaders.requests),'pipelines':len(n.native_pipelines),'materials':len(n.native_bindings),'textures':len(n.preloaded_textures)}
                if before!=after:raise ValueError('Fresh parent required additional graphics resources after cache preparation')
                case.update(ownership=owned,randomSeed=seed,clockInput=clock,resourceCountsBefore=before,resourceCountsAfter=after,
                    initialState=n.parent_state(),warmedOwnership=warm)
                expected=[i for i in range(selected['emitters']) if i not in selected['authoredDisabledEmitters']]
                if (owned['disabledEmitters']!=selected['authoredDisabledEmitters'] or
                        [a['emitterIndex'] for a in owned['actors']]!=expected):
                    raise ValueError('Parent actor selection differs from the proven authored disabled-byte filter')
                initial=owned['initialTime']
                checkpoint=None
                for tick in range(1,args.steps+1):
                    if tick in [7,13,22]:case['suspension'].append({'beforeTick':tick,**n.suspend_parent(tick!=13)})
                    value=f32(initial+tick/60);t=time.perf_counter();frame=n.tick_parent(value,20);frame['nativeMilliseconds']=(time.perf_counter()-t)*1000
                    frame.update(tick=tick,age=f32(value-initial),geometry=n.render_parent(CAMERA))
                    frame['stateAndGeometrySha256']=frame_digest(frame)
                    case['frames'].append(frame)
                    if tick==12:checkpoint=n.checkpoint_parent()
                if checkpoint is not None:
                    final_digest=n.parent_memory_digest();case['checkpoint']={'tick':12,'finalCpuWorldSha256':final_digest}
                    n.restore_parent(checkpoint);case['seekChecks']=[]
                    for tick in range(13,args.steps+1):
                        if tick in [13,22]:n.suspend_parent(tick!=13)
                        frame=n.tick_parent(f32(initial+tick/60),20);frame['geometry']=n.render_parent(CAMERA)
                        actual=frame_digest(frame);expected=case['frames'][tick-1]['stateAndGeometrySha256']
                        if actual!=expected:raise ValueError('Parent checkpoint continuation differs in state/substeps/geometry')
                        case['seekChecks'].append({'tick':tick,'expectedSha256':expected,'actualSha256':actual})
                    restored_digest=n.parent_memory_digest()
                    if restored_digest!=final_digest:raise ValueError('Parent checkpoint continuation changed the full CPU world')
                    case['checkpoint']['restoredFinalCpuWorldSha256']=restored_digest
                    n.release_parent_checkpoint(checkpoint);case['checkpoint']['rejectedInvalidHandles']=0
                    for token in [checkpoint,object()]:
                        try:n.restore_parent(token)
                        except ValueError:case['checkpoint']['rejectedInvalidHandles']+=1
                        else:raise ValueError('Parent accepted a released/foreign checkpoint')
                case['status']='frames-returned'
            except Exception as error:
                case.update(error=str(error),instructionRva=n.u.reg_read(r.UC_X86_REG_RIP)-n.base)
            finally:
                blocks.update(n.blocks)
                for path,digest in shaders.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Parent native shader input changed during observation')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shaders.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'completed':len(cases),'total':len(cohort),'effectId':case['effectId'],'status':case['status'],
                'frames':len(case['frames']),'error':case.get('error'),'elapsedSeconds':round(time.monotonic()-began,1)}),flush=True)
        destructors=n.finish_owned_thread();blocks.update(n.blocks)
        paths={Path(__file__),Path(__file__).with_name('native_vfx_fixture.py'),Path(__file__).with_name('graphics_texture_device.py'),
            Path(__file__).with_name('graphics_shader_catalog.py'),Path(__file__).with_name('graphics_material_bindings.py'),
            Path(__file__).with_name('graphics_pipeline_device.py'),Path(__file__).with_name('graphics_mesh_device.py'),
            Path(__file__).with_name('native_texture_dependencies.py'),Path(__file__).with_name('render-particle-shader.py'),
            Path(__file__).with_name('observe-shader-angle.py'),Path(__file__).with_name('macho.py')}
        paths.update(Path(inspect.getfile(c)) for c in NativeVfxParentFrames.__mro__ if c is not object)
        sources={p.name:sha(p.read_bytes()) for p in paths}
        result={'schema':1,'kind':'complete-native-parent-frame-observations','build':n.profile['clientVersion'],
            'protocol':n.profile['protocolDigest'],'decoderImageSha256':n.profile['decoderImageSha256'],
            'inputs':fixture.inputs,'sources':sources,'originalBlocks':list(blocks.values()),'camera':CAMERA,
            'context':device.info,'libraries':{name:sha((args.angle/name).read_bytes()) for name in ['libEGL.dll','libGLESv2.dll']},
            'mathProvider':{'library':'Windows ucrtbase.dll float routines','sha256':sha(Path('C:/Windows/System32/ucrtbase.dll').read_bytes()),
                'originalMacosLibmVerified':False},
            'selection':{'policy':'largest fully GPU-prepared complex-only quad/trail root per champion; lexicographic tie break',
                'candidateRoots':candidate_count,'cohort':cohort},'cases':cases,'threadDestructors':destructors,
            'counts':{'roots':len(cases),'returningRoots':sum(c['status']=='frames-returned' for c in cases),
                'frames':sum(len(c['frames']) for c in cases),'substeps':sum(len(f['substeps']) for c in cases for f in c['frames']),
                'geometryRecords':sum(len(f['geometry']) for c in cases for f in c['frames']),
                'suspensionTransitions':sum(len(c['suspension']) for c in cases),
                'checkpointContinuations':sum(len(c.get('seekChecks',[])) for c in cases),
                'checkpointWorldComparisons':sum('checkpoint' in c and 'restoredFinalCpuWorldSha256' in c['checkpoint'] for c in cases)},
            'scope':{'partialCorpus':True,'completeSelectedAuthoredRoots':True,'originalParentActivationAndTick':True,
                'freshParentAfterResourceCache':True,'originalObjectSuspensionPropagation':True,'originalPrimitiveWriters':True,
                'nativeGeometry':True,'clockAndCameraAndSeedSupplied':True,'matchLifecycleMapping':False,
                'sceneGlobalsBound':False,'wasmCompared':False,'browserRun':False,'mainViewerIntegrated':False,'referenceCompared':False}}
        encoded=json.dumps(result,indent=2).encode();output=args.output or cache/'research/parent-frames-native.json';output.write_bytes(encoded)
        package={'schema':1,'kind':'prepared-native-parent-resource-caches','build':result['build'],'protocol':result['protocol'],
            'decoderImageSha256':result['decoderImageSha256'],'observationSha256':sha(encoded),'caches':caches,
            'sources':sources,'scope':{'staticBuildPreparation':True,'containsReplayEvents':False,'portableBrowserGraphicsHandles':False,'browserRun':False}}
        (directory/'package.json').write_text(json.dumps(package,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(output),'sha256':sha(encoded),'counts':result['counts'],
            'boundaries':dict(Counter(c['error'] for c in cases if c['status']=='boundary'))}))
    finally:device.close()


if __name__=='__main__':main()
