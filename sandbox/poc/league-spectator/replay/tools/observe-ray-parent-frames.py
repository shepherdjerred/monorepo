"""Observe whole original effect parents with rays and arbitrary trails.

Select every previously activated replay-requested root whose complete actor set
uses these geometry writers. No emitter is removed. Clock, camera, seed and pose
are explicit research inputs; this is not match creation or reference playback.
"""
import argparse
from collections import Counter
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import time
import traceback
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from vfx_ray_frames_native import NativeRayParentFrames,RAY_WRITERS
from vfx_parent_frames_native import f32
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('parent_frames_observer',Path(__file__).with_name('observe-parent-frames.py'))
frames=importlib.util.module_from_spec(spec);spec.loader.exec_module(frames)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--limit',type=int)
    p.add_argument('--steps',type=int,default=30)
    args=p.parse_args()
    if not 2<=args.steps<=120 or args.limit is not None and args.limit<=0:
        raise ValueError('Ray observation requires 2..120 frames and positive limit')
    fixture=NativeVfxFixture(args.cache)
    selection_path=fixture.cache/'research/effect-root-activation.json'
    selection=fixture.read(selection_path)
    if selection['kind']!='requested-root-native-activation-observations' or selection['scope']['partialSelection']:
        raise ValueError('Complete original requested-root observations required')
    for path,digest in selection['inputs'].items():
        if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Requested-root input changed')
    for name,digest in selection['sources'].items():
        if sha(fixture.raw(Path(__file__).with_name(name)))!=digest:
            raise ValueError('Requested-root observer changed: '+name)
    selected=[]
    for case in selection['cases']:
        if case['status']!='native-parent-activated':continue
        actors=case['ownership']['actors']
        if (all(a['kind']=='complex' and a['primitiveVtableRva'] in RAY_WRITERS for a in actors) and
                any(a['primitiveVtableRva'] in [0x23f26e0,0x23f6678] for a in actors)):
            selected.append({'effectId':case['effectId'],'requestedCount':case['requests']})
    if args.limit is not None:selected=selected[:args.limit]
    directory=fixture.assets/'latest-ray-parent-caches';directory.mkdir(exist_ok=True)
    device=GraphicsTextureDevice(args.angle)
    cases=[];blocks={};caches=[];began=time.monotonic()
    try:
        for item in selected:
            n=NativeRayParentFrames(fixture.assets/'decoder-16.21-macos',args.client,device=device)
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader
            texture_start=len(device.textures)
            case={**item,'status':'boundary','frames':[],'seekChecks':[]}
            try:
                warm=fixture.activate(n,item['effectId'],12345,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                case['warmOwnership']=n.own_parent(warm['object'])
                n.render_parent(frames.CAMERA);n.suspend_parent(True)
                case['cache']=frames.export_cache(n,warm,frames.CAMERA,directory);caches.append(case['cache'])
                clock={'ticks':[2000000000]*3,'mode':0,'timebase':[1,1]}
                n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase'])
                case['randomSeed']=n.set_random_seed(9876)
                case['clockInput']=clock
                obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000);n.mark_ready(obj)
                n.call(0x1765960,{r.UC_X86_REG_RDI:obj})
                ownership=n.own_parent(obj);case['ownership']=ownership
                case['initialState']=n.parent_state()
                initial=ownership['initialTime'];checkpoint=None;middle=args.steps//2
                for tick in range(1,args.steps+1):
                    started=time.perf_counter()
                    frame=n.tick_parent(f32(initial+tick/60),20)
                    frame['geometry']=n.render_parent(frames.CAMERA)
                    frame.update(tick=tick,nativeMilliseconds=(time.perf_counter()-started)*1000)
                    frame['stateAndGeometrySha256']=frames.frame_digest(frame)
                    case['frames'].append(frame)
                    if tick==middle:checkpoint=n.checkpoint_parent()
                final=n.parent_memory_digest()
                n.restore_parent(checkpoint)
                for tick in range(middle+1,args.steps+1):
                    frame=n.tick_parent(f32(initial+tick/60),20)
                    frame['geometry']=n.render_parent(frames.CAMERA)
                    actual=frames.frame_digest(frame);expected=case['frames'][tick-1]['stateAndGeometrySha256']
                    if actual!=expected:raise ValueError('Ray parent checkpoint state/geometry differs')
                    case['seekChecks'].append({'tick':tick,'actualSha256':actual,'expectedSha256':expected})
                if n.parent_memory_digest()!=final:raise ValueError('Ray parent restored CPU world differs')
                n.release_parent_checkpoint(checkpoint)
                case['restoredFinalCpuWorldSha256']=final
                case['status']='native-ray-parent-frames-returned'
            except Exception as error:
                ip=n.u.reg_read(r.UC_X86_REG_RIP)
                case.update(errorType=type(error).__name__,error=str(error),traceback=traceback.format_exc(),
                    instructionAddress=ip,instructionRva=ip-n.base if n.base<=ip<n.base+len(n.image) else None)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Ray shader input changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'index':len(cases),'total':len(selected),'effectId':item['effectId'],
                'status':case['status'],'frames':len(case['frames']),'error':case.get('error'),
                'elapsedSeconds':time.monotonic()-began}),flush=True)
        sources={Path(__file__),Path(frames.__file__),Path(inspect.getfile(NativeVfxFixture)),
            Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog))}
        sources.update(Path(inspect.getfile(c)) for c in NativeRayParentFrames.__mro__ if c is not object)
        sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py',
            'graphics_pipeline_device.py','graphics_mesh_device.py','native_texture_dependencies.py',
            'render-particle-shader.py','observe-shader-angle.py','macho.py'])
        counts={'roots':len(cases),'returningRoots':sum(c['status']=='native-ray-parent-frames-returned' for c in cases),
            'frames':sum(len(c['frames']) for c in cases),'checkpointContinuations':sum(len(c['seekChecks']) for c in cases),
            'geometryRecords':sum(len(f['geometry']) for c in cases for f in c['frames'])}
        live=Counter(g['kind'] for c in cases for f in c['frames'] for g in f['geometry'] if g['verticesHex'])
        result={'schema':1,'kind':'native-ray-parent-frame-observations','build':n.profile['clientVersion'],
            'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
            'selectionSha256':sha(selection_path.read_bytes()),'inputs':fixture.inputs,
            'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},'originalBlocks':list(blocks.values()),
            'writers':{str(k):{'kind':v[0],'rva':v[1]} for k,v in RAY_WRITERS.items()},
            'camera':frames.CAMERA,'cases':cases,'counts':counts,'nonemptyGeometryByKind':dict(live),
            'graphicsContext':device.info,'graphicsLibraries':{name:sha((args.angle/name).read_bytes()) for name in ['libEGL.dll','libGLESv2.dll']},
            'scope':{'partialSelection':args.limit is not None,'wholeRootsPreserved':True,
                'originalParentActivationAndTick':True,'originalPrimitiveWriters':True,
                'freshInterpreterPerRoot':True,'freshParentAfterResourceCache':True,'clockCameraSeedSupplied':True,
                'matchCreationImplemented':False,'gpuDrawObserved':False,'wasmCompared':False,'browserExecuted':False,'referenceCompared':False}}
        encoded=json.dumps(result,indent=2).encode()
        out=fixture.cache/('research/ray-parent-frames-native-partial.json' if args.limit else 'research/ray-parent-frames-native.json')
        out.write_bytes(encoded)
        if not args.limit:
            package={'schema':1,'kind':'prepared-ray-parent-resource-caches','build':result['build'],
                'protocol':result['protocol'],'decoderImageSha256':result['decoderImageSha256'],
                'observationSha256':sha(encoded),'caches':caches,'sources':result['sources'],
                'scope':{'staticBuildPreparation':True,'containsReplayEvents':False,
                    'portableBrowserGraphicsHandles':False,'browserRun':False}}
            (directory/'package.json').write_text(json.dumps(package,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(out),'counts':counts,'nonemptyGeometryByKind':dict(live)}))
    finally:device.close()


if __name__=='__main__':main()
