"""Prepare an observed missing stage and compile its TOC permutations in GLES."""
import argparse
import ctypes as C
import inspect
import itertools
import json
from pathlib import Path
from xxhash import xxh64_intdigest
from native_ai_unit_fixture import NativeAIUnitFixture
from asset_work_queue_native import NativeAssetWorkQueue
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from shader_package_preparation_native import shader_preparation_config,prepare_native_shader_path
from probe_shared_constant_sources import borrowed_sources
from vfx_spawn_native import sha


def supplied_permutations(stage):
    grouped={}
    for definition in stage['baseDefines']:
        values=grouped.setdefault(definition['name'],{})
        values[definition['value']]=definition
    choices=[[None,*values.values()] for values in grouped.values()];combinations=1
    for values in choices:combinations*=len(values)
    if combinations>65536:raise ValueError('Shader compile control exceeds its explicit define-subset bound')
    wanted={row['hash'] for row in stage['permutations']};result={}
    for combination in itertools.product(*choices):
        selected=[value for value in combination if value is not None]
        ordered=sorted((value['name'],value['value']) for value in selected)
        key=f'{xxh64_intdigest("".join(f"{name}={value}" for name,value in ordered)):016x}'
        if key in wanted:result[key]=selected
    if result.keys()!=wanted:raise ValueError('Declared define subsets do not cover every original TOC permutation')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','installation','compiler','bun','graphics','seed']:parser.add_argument(name,type=Path)
    parser.add_argument('--path',required=True);parser.add_argument('--stage',choices=['vertex','pixel'],required=True)
    args=parser.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,NativeAssetWorkQueue);n=fixture.native
    result={'schema':1,'kind':'observed-static-shader-preparation-control','build':n.profile['clientVersion'],
            'path':args.path,'stage':args.stage,'preparations':[],'compiledPermutations':[],'boundary':None}
    device=None;catalog=None
    try:
        for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.graphics/name)
        device=GraphicsTextureDevice(args.graphics);catalog=GraphicsShaderCatalog(args.seed.resolve(),device)
        original=catalog.manifest['stages'][0];old_defines=next(iter(supplied_permutations(original).values()))
        retained=catalog.create_shader(original['file'],original['stage'],old_defines);old_entry=catalog.shaders[retained['glHandle']]
        config=shader_preparation_config(fixture,args.installation,args.compiler,args.bun)
        prepare_native_shader_path(fixture,catalog,config,args.path,args.stage,result['preparations'])
        status=C.c_int();device.gl.glGetShaderiv(retained['glHandle'],0x8b81,C.byref(status))
        if catalog.shaders[retained['glHandle']] is not old_entry or status.value!=1:
            raise ValueError('Static package extension changed an existing compiled GL shader')
        result['existingCompiledShaderRetained']=True
        selected=next(s for s in catalog.manifest['stages'] if s['file']==args.path.lower() and s['stage']==args.stage)
        for key,defines in supplied_permutations(selected).items():
            compiled=catalog.create_shader(args.path,args.stage,defines)
            result['compiledPermutations'].append({'hash':key,'recordId':compiled['recordId'],
                                                   'compiled':compiled['compiled'],'log':compiled['log']})
    except Exception as error:
        result['boundary']={'kind':type(error).__name__,'message':str(error)}
    finally:
        if catalog:
            for path,expected in catalog.inputs.items():
                if sha(fixture.raw(Path(path)))!=expected:raise ValueError('Shader preparation input changed: '+path)
            catalog.close()
        if device:device.close()
        n.close_files()
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(GraphicsTextureDevice)),
           Path(inspect.getfile(GraphicsShaderCatalog)),Path(inspect.getfile(prepare_native_shader_path)),
           Path(__file__).with_name('render-particle-shader.py'),Path(__file__).with_name('observe-shader-angle.py'),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object],*borrowed_sources()}
    result.update(inputs=fixture.inputs,sources={p.name:sha(p.read_bytes()) for p in sorted(paths)},
                  scope={'suppliedDefineSubsets':True,'actualGlesCompilation':True,'programLinking':False,
                         'nativeShaderRequestResumed':False,'mainViewerExpanded':False})
    output=fixture.cache/'research/static-shader-preparation-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'compiledPermutations':len(result['compiledPermutations']),'boundary':result['boundary']}))


if __name__=='__main__':main()
