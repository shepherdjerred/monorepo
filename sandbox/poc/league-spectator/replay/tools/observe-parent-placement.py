"""Observe original whole-parent frames with explicit changing world placement."""
import argparse
import ctypes as C
import inspect
import json
import math
from pathlib import Path
import time
from unicorn import x86_const as r
from parent_placement_native import NativeParentPlacement,POSE_INPUT,SETTERS,SYNC
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import sha
from vfx_parent_frames_native import f32
import importlib.util

spec=importlib.util.spec_from_file_location('parent_frames_observer',Path(__file__).with_name('observe-parent-frames.py'))
frames=importlib.util.module_from_spec(spec);spec.loader.exec_module(frames)


def pose(tick):
    angle=tick*.11;c=f32(math.cos(angle));s=f32(math.sin(angle))
    value={'position':[f32(6000+tick*13.5),f32(-100+tick*.75),f32(7000+tick*8)],
        'secondaryPosition':[f32(6500-tick*2),-95,f32(7450+tick*5)]}
    if (tick//8)%2==0:value['basis']=[c,0,-s,0,s,0,c,0,0,-1,0,0,123,456,789,1]
    else:value['direction']=[f32(c),f32(.1*s),f32(s)]
    return value


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--effect');p.add_argument('--steps',type=int,default=60);args=p.parse_args()
    if not 1<=args.steps<=120:raise ValueError('Placement observation needs 1..120 steps')
    fixture=NativeVfxFixture(args.cache);cohort,_,_=frames.select_roots(fixture)
    if args.effect:cohort=[v for v in cohort if v['effectId']==args.effect]
    if not cohort:raise ValueError('Unknown native parent placement root')
    device=GraphicsTextureDevice(args.angle);n=NativeParentPlacement(fixture.assets/'decoder-16.21-macos',args.client,device=device)
    cases=[];blocks={};began=time.monotonic()
    try:
        for selected in cohort:
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader;texture_start=len(device.textures)
            case={**selected,'status':'boundary','frames':[]}
            try:
                warm=fixture.activate(n,selected['effectId'],12345,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                n.own_parent(warm['object']);n.render_parent(frames.CAMERA);n.suspend_parent(True)
                clock={'ticks':[2000000000]*3,'mode':0,'timebase':[1,1]};n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase']);n.set_random_seed(9876)
                obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000)
                initial_pose=pose(0);initial_setters=n.apply_placement(obj,initial_pose,True)
                n.mark_ready(obj);n.call(0x1765960,{r.UC_X86_REG_RDI:obj});owned=n.own_parent(obj)
                initial_sync=n.synchronize_placement(obj)
                case.update(initialPose=initial_pose,initialSetters=initial_setters,initialSync=initial_sync,ownership=owned,initialState=n.parent_state(),clockInput=clock,randomSeed=9876)
                for tick in range(1,args.steps+1):
                    value=pose(tick);setters=n.apply_placement(obj,value);sync=n.synchronize_placement(obj)
                    update=n.tick_parent(f32(owned['initialTime']+tick/60),20)
                    update.update(tick=tick,placement=value,setters=setters,sync=sync,geometry=n.render_parent(frames.CAMERA))
                    update['stateAndGeometrySha256']=frames.frame_digest(update);case['frames'].append(update)
                case['status']='frames-returned'
            except Exception as error:case.update(error=str(error),instructionRva=n.u.reg_read(r.UC_X86_REG_RIP)-n.base)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Native placement shader changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'effectId':case['effectId'],'status':case['status'],'frames':len(case['frames']),'error':case.get('error'),'elapsedSeconds':time.monotonic()-began}),flush=True)
        paths={Path(__file__),Path(__file__).with_name('native_vfx_fixture.py'),Path(frames.__file__),Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog))}
        paths.update(Path(inspect.getfile(c)) for c in NativeParentPlacement.__mro__ if c is not object)
        result={'schema':1,'kind':'original-parent-placement-frames','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
            'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in paths},'originalBlocks':list(blocks.values()),
            'mathProviderSha256':sha(fixture.raw(Path('C:/Windows/System32/ucrtbase.dll'))),
            'camera':frames.CAMERA,'poseInput':POSE_INPUT,'setters':SETTERS,'syncRva':SYNC,'cases':cases,
            'counts':{'roots':len(cases),'returningRoots':sum(c['status']=='frames-returned' for c in cases),'frames':sum(len(c['frames']) for c in cases),'geometryRecords':sum(len(f['geometry']) for c in cases for f in c['frames'])},
            'scope':{'worldInputsSupplied':True,'originalObjectSetters':True,'originalProviderFreeObjectSync':True,'originalParentTickAndWriters':True,'entityBoneProviders':False,'replayFieldMapping':False,'browserRun':False,'mainViewerIntegrated':False,'referenceCompared':False}}
        out=fixture.cache/'research'/('parent-placement-native-partial.json' if args.effect or args.steps!=60 else 'parent-placement-native.json');raw=json.dumps(result,indent=2).encode();out.write_bytes(raw)
        print(json.dumps({'output':str(out),'sha256':sha(raw),'counts':result['counts']}))
    finally:device.close()


if __name__=='__main__':main()
