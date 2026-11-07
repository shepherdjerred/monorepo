"""Reflect real active sampler names/types for the selected material cohort."""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path

module_path=Path(__file__).with_name('render-particle-shader.py')
spec=importlib.util.spec_from_file_location('sampler_reflection_angle',module_path)
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
SAMPLERS={0x8b5e:'sampler2D',0x8b5f:'sampler3D',0x8b60:'samplerCube',0x8b62:'sampler2DShadow',
 0x8dc1:'sampler2DArray',0x8dc4:'sampler2DArrayShadow',0x8dc5:'samplerCubeShadow',
 0x8dca:'isampler2D',0x8dcb:'isampler3D',0x8dcc:'isamplerCube',0x8dd2:'usampler2D',0x8dd3:'usampler3D',0x8dd4:'usamplerCube'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();inputs[str(path)]=adapter.sha(data);return data
    inventory=json.loads(raw(cache/'research/direct-uniform-inventory.json'))
    for path,digest in inventory['inputs'].items():
        if adapter.sha(raw(path))!=digest:raise ValueError('Sampler input changed: '+path)
    d=adapter.Draw(args.angle);programs={};rows=[]
    try:
        d.fn(d.gl,'glGetActiveUniform',None,C.c_uint,C.c_uint,C.c_int,C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_uint),C.c_void_p)
        for material in inventory['programs']:
            stages=material['shaders'];identity=adapter.sha((stages['vertex']+'\0'+stages['pixel']).encode())
            if identity not in programs:programs[identity]=d.program({'glsl':stages['vertex']},{'glsl':stages['pixel']})
            handle=programs[identity];count=C.c_int();d.gl.glGetProgramiv(handle,0x8b86,C.byref(count));active=[]
            for index in range(count.value):
                name=C.create_string_buffer(512);length,size=C.c_int(),C.c_int();kind=C.c_uint()
                d.gl.glGetActiveUniform(handle,index,len(name),C.byref(length),C.byref(size),C.byref(kind),name)
                if kind.value in SAMPLERS:active.append({'name':name.value.decode(),'size':size.value,'type':SAMPLERS[kind.value],'glType':kind.value})
            rows.append({'materialKey':material['key'],'kind':material['kind'],'shaderPairSha256':identity,'activeSamplers':active})
            if d.gl.glGetError():raise ValueError('Native sampler reflection failed')
        for path in [Path(__file__),module_path,args.angle/'libEGL.dll',args.angle/'libGLESv2.dll']:raw(path)
        for path,digest in inputs.items():
            if adapter.sha(Path(path).read_bytes())!=digest:raise ValueError('Sampler source changed: '+path)
        output=cache/'research/direct-sampler-reflection-gles-v33.json'
        output.write_text(json.dumps({'schema':1,'kind':'actual-selected-program-sampler-reflection','inputs':inputs,'context':d.info,'materials':rows,
            'scope':{'actualLinkedGlesReflection':True,'rendererUniformMapCompared':False,'browserContextObserved':False,'drawPerformed':False}},indent=2))
        unusual=[{'key':row['materialKey'],'kind':row['kind'],'samplers':row['activeSamplers']} for row in rows if any(s['type']!='sampler2D' for s in row['activeSamplers'])]
        print(json.dumps({'output':str(output),'materials':len(rows),'linkedPrograms':len(programs),'nonOrdinary2d':unusual}))
    finally:
        for handle in programs.values():d.gl.glDeleteProgram(handle)
        d.close()


if __name__=='__main__':main()
