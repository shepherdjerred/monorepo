"""Attempt every map root named by the fixture's catalog candidate join.

These are candidate-selected static asset observations, not recovered match
creation. Complete roots remain intact and every boundary stays in the report.
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
from native_map_vfx_fixture import NativeMapVfxFixture
from parent_placement_native import NativeParentPlacement
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_parent_frames_native import WRITERS
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('parent_frames_observer',Path(__file__).with_name('observe-parent-frames.py'))
frames=importlib.util.module_from_spec(spec);spec.loader.exec_module(frames)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--limit',type=int)
    args=p.parse_args()
    fixture=NativeMapVfxFixture(args.cache)
    selection_path=fixture.cache/'research/map-effect-resources-comparison.json'
    selection=fixture.read(selection_path)
    if selection['kind']!='native-wasm-map-global-resource-comparison' or selection['mismatchCount']:
        raise ValueError('Map catalog selection requires original comparison')
    for path,digest in selection['inputs'].items():
        if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Map candidate input changed')
    for name,digest in selection['sources'].items():
        if sha(fixture.raw(Path(__file__).parent.parent/name))!=digest:
            raise ValueError('Map candidate producer changed')
    requests=Counter()
    for candidate in selection['requestCandidates']:
        # Count at most once per candidate request/root; multiple maps do not
        # imply multiple actual creations.
        ids={match['declaration']['id'] for match in candidate['matches']
             if match['declaration']['status']=='map-effect-declaration'}
        for identity in ids:requests['map/12/'+identity]+=1
    selected=sorted(requests)
    if args.limit is not None:
        if args.limit<=0:raise ValueError('Positive activation limit required')
        selected=selected[:args.limit]
    directory=fixture.assets/'latest-map-effect-caches';directory.mkdir(exist_ok=True)
    device=GraphicsTextureDevice(args.angle)
    cases=[];blocks={};began=time.monotonic()
    try:
        for effect_id in selected:
            # A failed original resource initializer can leave partial native and
            # host state. Each candidate owns a fresh interpreter, so a boundary
            # cannot contaminate subsequent observations.
            n=NativeParentPlacement(fixture.assets/'decoder-16.21-macos',args.client,device=device)
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device)
            n.shader_catalog=shader;texture_start=len(device.textures)
            case={'effectId':effect_id,'catalogCandidateRequests':requests[effect_id],'status':'boundary'}
            try:
                warm=fixture.activate(n,effect_id,0,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                ownership=n.own_parent(warm['object']);case['ownership']=ownership
                case['unsupportedGeometry']=[{'kind':a['kind'],'primitiveVtableRva':a.get('primitiveVtableRva')}
                    for a in ownership['actors'] if a['kind']!='complex' or a.get('primitiveVtableRva') not in WRITERS]
                n.suspend_parent(True)
                case['cache']=frames.export_cache(n,warm,frames.CAMERA,directory)
                case['status']='native-map-parent-activated'
            except Exception as error:
                instruction=n.u.reg_read(r.UC_X86_REG_RIP)
                case.update(errorType=type(error).__name__,error=str(error),traceback=traceback.format_exc(),
                    instructionAddress=instruction,instructionRva=(instruction-n.base
                        if n.base<=instruction<n.base+len(n.image) else None))
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Map shader input changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'index':len(cases),'total':len(selected),'effectId':effect_id,'status':case['status'],
                'unsupportedGeometry':len(case.get('unsupportedGeometry',[])),'error':case.get('error'),
                'elapsedSeconds':time.monotonic()-began}),flush=True)
        sources={Path(__file__),Path(frames.__file__),Path(__file__).with_name('native_vfx_fixture.py'),
            Path(inspect.getfile(NativeMapVfxFixture)),Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog))}
        sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py',
            'graphics_pipeline_device.py','graphics_mesh_device.py','native_texture_dependencies.py',
            'render-particle-shader.py','observe-shader-angle.py','macho.py'])
        sources.update(Path(inspect.getfile(c)) for c in NativeParentPlacement.__mro__ if c is not object)
        result={'schema':1,'kind':'candidate-map-root-native-activation-observations','build':'16.21.829.8620',
            'protocol':'20e09df23c66b85e','selectionSha256':sha(selection_path.read_bytes()),
            'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,
            'graphicsContext':device.info,
            'graphicsLibraries':{name:sha((args.angle/name).read_bytes()) for name in ['libEGL.dll','libGLESv2.dll']},
            'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},'originalBlocks':list(blocks.values()),'cases':cases,
            'counts':{'roots':len(cases),'activatedRoots':sum(c['status']=='native-map-parent-activated' for c in cases),
                'knownGeometryRoots':sum(c['status']=='native-map-parent-activated' and not c['unsupportedGeometry'] for c in cases)},
            'scope':{'partialSelection':args.limit is not None,'catalogCandidateSelectionOnly':True,'staticBuildCachesOnly':True,
                'freshInterpreterPerCandidate':True,
                'originalParentActivation':True,'offscreenGraphicsBacked':True,'activeGlobalsRecovered':False,
                'matchCreationImplemented':False,'parentFramesCompared':False,'gpuDrawObserved':False,
                'browserExecuted':False,'referenceCompared':False}}
        out=fixture.cache/('research/map-effect-activation-partial.json' if args.limit else 'research/map-effect-activation.json')
        out.write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(out),'counts':result['counts']}))
    finally:device.close()


if __name__=='__main__':main()
