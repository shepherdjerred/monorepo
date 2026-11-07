"""Run simultaneous original parent effects over prepared replay trajectories.

Seed, quality, activation, stop and basis are explicitly supplied preview policy.
Each burst is an independent owned CPU context over the same authored resource.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path
import time
from unicorn import x86_const as r
from parent_placement_native import NativeParentPlacement
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client','angle']:p.add_argument(key,type=Path)
    args=p.parse_args();fixture=NativeVfxFixture(args.cache)
    input_path=fixture.cache/'research/parent-missile-inputs.json';input_bytes=fixture.raw(input_path);schedule=json.loads(input_bytes)
    if schedule['kind']!='replay-derived-parent-missile-inputs' or schedule['counts']['parents']!=30 or schedule['build']!='16.21.829.8620' or schedule['protocol']!='20e09df23c66b85e':raise ValueError('Unexpected replay parent input corpus')
    for path,digest in schedule['inputs'].items():
        if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Replay parent input changed: '+path)
    device=GraphicsTextureDevice(args.angle);n=NativeParentPlacement(fixture.assets/'decoder-16.21-macos',args.client,device=device)
    cases=[];blocks={};began=time.monotonic()
    def select(ownership,time):
        n.frame_object=ownership['object'];n.frame_parent=ownership['parent'];n.frame_actors=ownership['actors'];n.last_parent_time=time
    try:
        for burst in schedule['bursts']:
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader;texture_start=len(device.textures)
            case={'effectId':burst['effectId'],'startTime':burst['startTime'],'status':'boundary','parents':[],'frames':[]}
            try:
                warm=fixture.activate(n,burst['effectId'],12345,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                n.own_parent(warm['object']);n.render_parent(schedule['camera']);n.suspend_parent(True)
                owned={};times={}
                for source in burst['parents']:
                    clock=source['clock'];n.supply_clock_inputs([int(v) for v in clock['ticks']],clock['mode'],clock['timebase']);n.set_random_seed(int(source['seed']))
                    obj=n.create_object();n.set_scalars(obj,0x3f800000,0x3f800000)
                    setters=n.apply_placement(obj,source['placement'],True);n.mark_ready(obj);n.call(0x1765960,{r.UC_X86_REG_RDI:obj})
                    ownership=n.own_parent(obj);sync=n.synchronize_placement(obj)
                    if ownership['initialTime']!=burst['startTime']:raise ValueError('Original parent clock does not match the supplied replay start')
                    owned[source['sequence']]=ownership;times[source['sequence']]=ownership['initialTime']
                    case['parents'].append({'sequence':source['sequence'],'ownership':ownership,'placement':{'setters':setters,'sync':sync},'state':n.parent_state()})
                for index,frame in enumerate(burst['frames']):
                    results=[]
                    for update in frame['updates']:
                        seq=update['sequence'];o=owned[seq];select(o,times[seq])
                        if 'suspended' in update:n.suspend_parent(update['suspended'])
                        setters=n.apply_placement(o['object'],update['placement']);sync=n.synchronize_placement(o['object'])
                        result=n.tick_parent(update['time'],update['maxSubsteps']);times[seq]=result['time']
                        results.append({'sequence':seq,**result,'placement':{'setters':setters,'sync':sync}})
                    for result in results:
                        select(owned[result['sequence']],times[result['sequence']]);result['geometry']=n.render_parent(schedule['camera'])
                    case['frames'].append({'index':index,'time':frame['time'],'parents':results})
                    if (index+1)%6==0:print(json.dumps({'effectId':burst['effectId'],'startTime':burst['startTime'],'frames':index+1,'total':len(burst['frames']),'elapsedSeconds':time.monotonic()-began}),flush=True)
                case['status']='frames-returned'
            except Exception as error:case.update(error=str(error),instructionRva=n.u.reg_read(r.UC_X86_REG_RIP)-n.base)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Replay parent shader changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case);print(json.dumps({'startTime':case['startTime'],'status':case['status'],'parents':len(case['parents']),'frames':len(case['frames']),'error':case.get('error')}),flush=True)
        paths={Path(__file__),Path(__file__).with_name('native_vfx_fixture.py'),Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog))}
        paths.update(Path(inspect.getfile(c)) for c in NativeParentPlacement.__mro__ if c is not object)
        result={'schema':1,'kind':'simultaneous-native-replay-parents','build':schedule['build'],'protocol':schedule['protocol'],'inputSha256':sha(input_bytes),
            'decoderImageSha256':sha(n.image),'mathProviderSha256':sha(fixture.raw(Path('C:/Windows/System32/ucrtbase.dll'))),'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in paths},'originalBlocks':list(blocks.values()),
            'camera':schedule['camera'],'policy':schedule['policy'],'cases':cases,
            'counts':{'bursts':len(cases),'returningBursts':sum(c['status']=='frames-returned' for c in cases),'parents':sum(len(c['parents']) for c in cases),'worldFrames':sum(len(c['frames']) for c in cases),
                'parentUpdates':sum(len(f['parents']) for c in cases for f in c['frames']),'geometryRecords':sum(len(p['geometry']) for c in cases for f in c['frames'] for p in f['parents'])},
            'scope':{'decodedMissileTrajectories':True,'simultaneousParents':True,'callerOrderedSharedRng':True,'independentBurstContexts':True,'allUpdatesBeforeGeometry':True,'originalParentCode':True,
                'activationStopSeedBasisSupplied':True,'originalEffectEventMapping':False,'originalSeedAndJobOrdering':False,'browserExecuted':False,'mainViewerIntegrated':False,'referenceCompared':False}}
        out=fixture.cache/'research/parent-missiles-native.json';encoded=json.dumps(result,indent=2).encode();out.write_bytes(encoded);print(json.dumps({'output':str(out),'sha256':sha(encoded),'counts':result['counts']}))
    finally:device.close()


if __name__=='__main__':main()
