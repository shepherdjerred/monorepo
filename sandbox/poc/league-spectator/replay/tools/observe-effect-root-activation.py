"""Exercise original complete-parent activation for replay-requested build assets.

Static cache discovery only. Activation is not rendering or match reconstruction.
Unknown callbacks and unsupported resources remain observed failures.
"""
import argparse
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import time
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
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
    p.add_argument('--limit',type=int);args=p.parse_args()
    fixture=NativeVfxFixture(args.cache);source_path=fixture.cache/'research/effect-root-inputs.json';source=fixture.read(source_path)
    if source['kind']!='replay-requested-effect-root-inputs' or source['build']!='16.21.829.8620' or source['protocol']!='20e09df23c66b85e':raise ValueError('Unmatched effect root inputs')
    for path,digest in source['inputs'].items():
        if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Changed root input: '+path)
    for path,digest in source['sources'].items():
        if sha(fixture.raw(Path(__file__).parent.parent/path))!=digest:raise ValueError('Changed root input producer: '+path)
    selected=source['roots'][:args.limit] if args.limit else source['roots']
    directory=fixture.assets/'latest-effect-root-caches';directory.mkdir(exist_ok=True)
    device=GraphicsTextureDevice(args.angle)
    n=NativeParentPlacement(fixture.assets/'decoder-16.21-macos',args.client,device=device)
    cases=[];blocks={};began=time.monotonic()
    try:
        for item in selected:
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader;texture_start=len(device.textures)
            case={**item,'status':'boundary'}
            try:
                warm=fixture.activate(n,item['effectId'],0,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                ownership=n.own_parent(warm['object'])
                case['ownership']=ownership
                unknown=[{'kind':a['kind'],'primitiveVtableRva':a.get('primitiveVtableRva')} for a in ownership['actors'] if a['kind']!='complex' or a.get('primitiveVtableRva') not in WRITERS]
                case['unsupportedGeometry']=unknown
                n.suspend_parent(True)
                case['cache']=frames.export_cache(n,warm,frames.CAMERA,directory)
                case['status']='native-parent-activated'
            except Exception as error:
                case.update(errorType=type(error).__name__,error=str(error),instructionRva=n.u.reg_read(r.UC_X86_REG_RIP)-n.base)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Changed root shader input')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'index':len(cases),'total':len(selected),'effectId':item['effectId'],'requests':item['requests'],'status':case['status'],'unsupportedGeometry':len(case.get('unsupportedGeometry',[])),'error':case.get('error'),'elapsedSeconds':time.monotonic()-began}),flush=True)
        paths={Path(__file__),Path(frames.__file__),Path(__file__).with_name('native_vfx_fixture.py'),Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog))}
        paths.update(Path(inspect.getfile(c)) for c in NativeParentPlacement.__mro__ if c is not object)
        result={'schema':1,'kind':'requested-root-native-activation-observations','build':source['build'],'protocol':source['protocol'],
            'selectionSha256':sha(source_path.read_bytes()),'decoderImageSha256':sha(n.image),'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in paths},'originalBlocks':list(blocks.values()),'cases':cases,
            'counts':{'roots':len(cases),'activatedRoots':sum(c['status']=='native-parent-activated' for c in cases),'activatedRequests':sum(c['requests'] for c in cases if c['status']=='native-parent-activated'),
                'knownGeometryRoots':sum(c['status']=='native-parent-activated' and not c['unsupportedGeometry'] for c in cases)},
            'scope':{'partialSelection':bool(args.limit),'staticBuildCachesOnly':True,'originalParentActivation':True,'decodedRequestSelection':True,'matchCreationImplemented':False,'parentFramesCompared':False,'gpuSubmissionObserved':False,'browserExecuted':False,'referenceCompared':False}}
        out=fixture.cache/('research/effect-root-activation-partial.json' if args.limit else 'research/effect-root-activation.json')
        out.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'output':str(out),'counts':result['counts']}))
    finally:device.close()

if __name__=='__main__':main()
