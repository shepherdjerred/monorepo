"""Capture complete activated material passes and native GPU texture pixels.

This is build-only asset preparation. Scene textures, pass scheduling, per-frame
parameters, decoded creation/placement and replay lifecycle remain explicit.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path
import time
import traceback
from unicorn import x86_const as r
from parent_material_native import NativeParentMaterials
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import sha


class CapturedTextureDevice(GraphicsTextureDevice):
    def __init__(self,angle,output):
        self.output=output
        (output/'planes').mkdir(parents=True,exist_ok=True)
        super().__init__(angle)

    def create(self,request):
        record=super().create(request)
        levels=[]
        for mip,planes in enumerate(request['levels']):
            values=[]
            for layer,pixels in enumerate(planes):
                canonical=self.canonical(request['nativeFormat'],pixels)
                digest=sha(canonical);file=f'planes/{digest}.bin'
                (self.output/file).write_bytes(canonical)
                verified=next(v for v in record['readbacks'] if v['mip']==mip and v['layer']==layer)
                if digest!=verified['sha256'] or len(canonical)!=verified['bytes']:
                    raise ValueError('Captured material texture differs from verified GPU readback')
                values.append({'file':file,'sha256':digest,'bytes':len(canonical),
                    'width':max(1,request['width']>>mip),'height':max(1,request['height']>>mip),
                    'mip':mip,'layer':layer})
            levels.append(values)
        record['preparedLevels']=levels
        return record


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--limit',type=int)
    args=p.parse_args()
    fixture=NativeVfxFixture(args.cache)
    selection_path=fixture.cache/'research/ray-parent-frames-native.json'
    selection=fixture.read(selection_path)
    if selection['kind']!='native-ray-parent-frame-observations' or selection['scope']['partialSelection']:
        raise ValueError('Complete exact-build ray parent observations required')
    for name,digest in selection['sources'].items():
        if sha(fixture.raw(Path(__file__).with_name(name)))!=digest:
            raise ValueError('Ray material selection producer changed: '+name)
    for path,digest in selection['inputs'].items():
        if sha(fixture.raw(Path(path)))!=digest:
            raise ValueError('Ray material selection input changed')
    cases_in=selection['cases'][:args.limit] if args.limit else selection['cases']
    output=fixture.assets/'latest-parent-native-materials';output.mkdir(exist_ok=True)
    device=CapturedTextureDevice(args.angle,output)
    cases=[];blocks={};began=time.monotonic()
    try:
        for source in cases_in:
            n=NativeParentMaterials(fixture.assets/'decoder-16.21-macos',args.client,device=device)
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader
            texture_start=len(device.textures)
            case={'effectId':source['effectId'],'status':'boundary'}
            try:
                activation=fixture.activate(n,source['effectId'],12345,
                    {'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                case['ownership']=n.own_parent(activation['object'])
                case['passes']=n.material_passes()
                case['defaultTextures']=n.gpu_records
                case['preloadedTextures']=n.preloaded_textures
                case['textures']={str(k):v for k,v in n.native_textures.items()}
                case['shaders']={str(k):v for k,v in n.native_shaders.items()}
                case['shaderRequests']=shader.requests
                case['programs']={str(k):v for k,v in n.native_programs.items()}
                case['pipelines']={str(k):v for k,v in n.native_pipelines.items()}
                case['bindings']={str(k):v for k,v in n.native_bindings.items()}
                case['bindingRequests']=n.material_binding_requests
                case['status']='complete-native-materials-captured'
            except Exception as error:
                ip=n.u.reg_read(r.UC_X86_REG_RIP)
                case.update(errorType=type(error).__name__,error=str(error),traceback=traceback.format_exc(),
                    instructionAddress=ip,instructionRva=ip-n.base if n.base<=ip<n.base+len(n.image) else None)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Native material shader changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'index':len(cases),'total':len(cases_in),'effectId':source['effectId'],
                'status':case['status'],'error':case.get('error'),'elapsedSeconds':time.monotonic()-began}),flush=True)
        sources={Path(__file__),Path(inspect.getfile(NativeVfxFixture)),Path(inspect.getfile(GraphicsTextureDevice)),
            Path(inspect.getfile(GraphicsShaderCatalog))}
        sources.update(Path(inspect.getfile(c)) for c in NativeParentMaterials.__mro__ if c is not object)
        sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py',
            'graphics_pipeline_device.py','graphics_mesh_device.py','native_texture_dependencies.py',
            'render-particle-shader.py','observe-shader-angle.py','macho.py'])
        result={'schema':1,'kind':'complete-native-parent-material-observations','build':selection['build'],
            'protocol':selection['protocol'],'decoderImageSha256':selection['decoderImageSha256'],
            'selectionSha256':sha(selection_path.read_bytes()),'inputs':fixture.inputs,
            'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},'originalBlocks':list(blocks.values()),
            'cases':cases,'counts':{'roots':len(cases),'capturedRoots':sum(c['status']=='complete-native-materials-captured' for c in cases),
                'actors':sum(len(c.get('passes',{}).get('actors',[])) for c in cases),
                'passRows':sum(len(a['rows']) for c in cases for a in c.get('passes',{}).get('actors',[])),
                'variants':sum(len(row['variants']) for c in cases for a in c.get('passes',{}).get('actors',[]) for row in a['rows'])},
            'scope':{'partialSelection':args.limit is not None,'originalCompleteActivation':True,
                'originalPassLookupExecuted':True,'originalPassNameHashExecuted':True,'textureGpuReadbackCompared':True,
                'allObservedPassesAndVariantsPreserved':True,'clockCameraSeedNotRecovered':True,
                'sceneResourcesProvided':False,'gpuDrawSubmitted':False,'mainViewerEnabled':False,
                'browserExecuted':False,'referenceCompared':False}}
        path=fixture.cache/('research/parent-native-materials-partial.json' if args.limit else 'research/parent-native-materials.json')
        path.write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(path),'counts':result['counts']}))
    finally:device.close()


if __name__=='__main__':main()
