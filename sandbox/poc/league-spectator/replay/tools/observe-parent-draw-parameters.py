"""Observe original frame draw parameters over complete activated effects.

The full batched-draw prefix executes through shared parameter setters, stopping
before resource selection/submission. Matrices, poses, clocks and offsets are
controlled research inputs, not recovered match values.
"""
import argparse
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import time
import traceback
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from parent_draw_parameters_native import NativeParentDrawParameters,DRAW_PREFIX,SLOTS
from vfx_parent_frames_native import f32
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('parent_frames_observer',Path(__file__).with_name('observe-parent-frames.py'))
frames=importlib.util.module_from_spec(spec);spec.loader.exec_module(frames)


def matrix(tick):
    return [f32((i+1)*.01+tick*.001) for i in range(16)]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--limit',type=int);args=p.parse_args()
    fixture=NativeVfxFixture(args.cache)
    selection_path=fixture.cache/'research/ray-parent-frames-native.json'
    selection=fixture.read(selection_path)
    if selection['kind']!='native-ray-parent-frame-observations' or selection['scope']['partialSelection']:
        raise ValueError('Complete matching parent cohort required')
    for name,digest in selection['sources'].items():
        if sha(fixture.raw(Path(__file__).with_name(name)))!=digest:raise ValueError('Parent selection producer changed')
    for path,digest in selection['inputs'].items():
        if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Parent selection input changed')
    material_path=fixture.assets/'latest-parent-native-materials/package.json'
    material=fixture.read(material_path)
    if material['counts']['roots']!=selection['counts']['returningRoots']:
        raise ValueError('Complete original material cohort differs')
    cases_in=selection['cases'][:args.limit] if args.limit else selection['cases']
    directory=fixture.assets/'latest-parent-draw-caches';directory.mkdir(exist_ok=True)
    device=GraphicsTextureDevice(args.angle);cases=[];caches=[];blocks={};began=time.monotonic()
    try:
        for source in cases_in:
            n=NativeParentDrawParameters(fixture.assets/'decoder-16.21-macos',args.client,device=device)
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader
            texture_start=len(device.textures)
            case={'effectId':source['effectId'],'status':'boundary','frames':[],'seekChecks':[]}
            try:
                warm=fixture.activate(n,source['effectId'],12345,
                    {'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                n.own_parent(warm['object'])
                observed=n.material_passes();case['materialPasses']=observed
                variants=[]
                for actor in observed['actors']:
                    for row in actor['rows']:
                        for v in row['variants']:
                            pipeline=n.native_pipelines[v['nativePipeline']]
                            program=n.native_programs[v['nativeProgram']]
                            sh={stage:next(s['translation']['sha256'] for s in n.native_shaders.values()
                                if s['glHandle']==program[stage]) for stage in ['vertex','pixel']}
                            expected=material['roots'][source['effectId']]['actors'][str(actor['emitterIndex'])]['rows'][row['index']]['variants'][v['index']]
                            if (sh!={s:expected['shaders'][s]['sha256'] for s in sh} or
                                    pipeline['descriptorHex']!=expected['pipeline']['descriptorHex']):
                                raise ValueError('Installing shared parameter storage changed original static material selection')
                            variants.append({'emitterIndex':actor['emitterIndex'],'passHash':row['hash'],
                                'index':v['index'],'shaders':sh,'pipelineDescriptorHex':pipeline['descriptorHex']})
                case['materialVariants']=variants
                # Initialize original lazy parameter handles, then suspend this
                # resource-warming parent. No replay state is in this cache.
                for actor in observed['actors']:
                    n.draw_parameters(actor['emitterIndex'],matrix(0),actor['rows'][0]['hash'],0)
                n.render_parent(frames.CAMERA);n.suspend_parent(True)
                cache_ref=frames.export_cache(n,warm,frames.CAMERA,directory)
                path=directory/cache_ref['file'];cache_record=json.loads(path.read_bytes())
                cache_record['drawParameters']={'prefix':list(DRAW_PREFIX),'slots':n.draw_parameter_slots,
                    'scene':n.draw_scene,'wrapper':n.draw_wrapper,'command':n.draw_command,'material':n.draw_material,
                    'scope':'owned shared storage and IO only; caller supplies each frame input'}
                cache_bytes=json.dumps(cache_record,indent=2).encode();path.write_bytes(cache_bytes)
                cache_ref.update(sha256=sha(cache_bytes),bytes=len(cache_bytes));case['cache']=cache_ref
                clock={'ticks':[2000000000]*3,'mode':0,'timebase':[1,1]}
                n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase']);n.set_random_seed(9876)
                obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000);n.mark_ready(obj)
                n.call(0x1765960,{r.UC_X86_REG_RDI:obj});ownership=n.own_parent(obj)
                case.update(ownership=ownership,clockInput=clock,initialState=n.parent_state())
                by_index={a['emitterIndex']:a for a in observed['actors']}
                def step(tick):
                    pose={'position':[f32(tick*3),f32(tick*.25),f32(-tick*2)],
                        'secondaryPosition':[f32(tick*3+10),f32(tick*.25),f32(-tick*2+15)],'direction':[0,0,1]}
                    placement=n.apply_placement(obj,pose);sync=n.synchronize_placement(obj)
                    frame=n.tick_parent(f32(ownership['initialTime']+tick/60),20)
                    frame['geometry']=n.render_parent(frames.CAMERA)
                    parameters=[n.draw_parameters(a['emitterIndex'],matrix(tick),by_index[a['emitterIndex']]['rows'][0]['hash'],
                        tick*17+a['emitterIndex']) for a in ownership['actors']]
                    frame.update(tick=tick,pose=pose,placement=placement,sync=sync,drawParameters=parameters)
                    return frame
                for tick in range(1,5):
                    case['frames'].append(step(tick))
                    if tick==2:checkpoint=n.checkpoint_parent()
                final=n.parent_memory_digest();n.restore_parent(checkpoint)
                for tick in [3,4]:
                    actual=step(tick);expected=case['frames'][tick-1]
                    if actual!=expected:raise ValueError('Restored native draw parameters/state/geometry differ')
                    case['seekChecks'].append({'tick':tick,'frameSha256':sha(json.dumps(actual,separators=(',',':')).encode())})
                if n.parent_memory_digest()!=final:raise ValueError('Restored native draw CPU world differs')
                n.release_parent_checkpoint(checkpoint);case['finalCpuWorldSha256']=final
                case['status']='native-draw-parameter-frames-returned';caches.append(cache_ref)
            except Exception as error:
                ip=n.u.reg_read(r.UC_X86_REG_RIP)
                case.update(errorType=type(error).__name__,error=str(error),traceback=traceback.format_exc(),
                    instructionAddress=ip,instructionRva=ip-n.base if n.base<=ip<n.base+len(n.image) else None)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Draw parameter shader input changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'index':len(cases),'total':len(cases_in),'effectId':source['effectId'],
                'status':case['status'],'frames':len(case['frames']),'error':case.get('error'),
                'elapsedSeconds':time.monotonic()-began}),flush=True)
        sources={Path(__file__),Path(frames.__file__),Path(inspect.getfile(NativeVfxFixture)),
            Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog))}
        sources.update(Path(inspect.getfile(c)) for c in NativeParentDrawParameters.__mro__ if c is not object)
        sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py',
            'graphics_pipeline_device.py','graphics_mesh_device.py','native_texture_dependencies.py',
            'render-particle-shader.py','observe-shader-angle.py','macho.py'])
        result={'schema':1,'kind':'original-parent-draw-parameter-observations','build':selection['build'],
            'protocol':selection['protocol'],'decoderImageSha256':selection['decoderImageSha256'],
            'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
            'originalBlocks':list(blocks.values()),'camera':frames.CAMERA,'cases':cases,'slots':SLOTS,
            'counts':{'roots':len(cases),'returningRoots':sum(c['status']=='native-draw-parameter-frames-returned' for c in cases),
                'frames':sum(len(c['frames']) for c in cases),'checkpointContinuations':sum(len(c['seekChecks']) for c in cases),
                'drawParameterRecords':sum(len(f['drawParameters']) for c in cases for f in c['frames'])},
            'scope':{'partialSelection':args.limit is not None,'originalParameterConstructor':True,
                'originalRegistryInsertionAndLookup':True,'originalDrawPrefixAndSetters':True,
                'materialSelectionsCompared':True,'projectionPoseClockOffsetSupplied':True,'boundedCmemcmpOnly':True,
                'macosLibcMemcmpVerified':False,'materialApplicationExecuted':False,'gpuDrawSubmitted':False,
                'mainViewerEnabled':False,'browserExecuted':False,'referenceCompared':False}}
        encoded=json.dumps(result,indent=2).encode()
        out=fixture.cache/('research/parent-draw-parameters-native-partial.json' if args.limit else 'research/parent-draw-parameters-native.json')
        out.write_bytes(encoded)
        if not args.limit:
            catalog={'schema':1,'kind':'prepared-parent-draw-parameter-caches','build':selection['build'],
                'protocol':selection['protocol'],'decoderImageSha256':selection['decoderImageSha256'],
                'observationSha256':sha(encoded),'caches':caches,'sources':result['sources'],
                'scope':{'staticBuildPreparation':True,'containsReplayEvents':False,
                    'portableBrowserGraphicsHandles':False,'browserRun':False}}
            (directory/'package.json').write_text(json.dumps(catalog,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(out),'counts':result['counts']}))
    finally:device.close()


if __name__=='__main__':main()
