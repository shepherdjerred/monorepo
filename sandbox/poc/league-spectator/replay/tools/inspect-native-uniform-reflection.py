"""Compare selected material UBO inventories with real linked GLES reflection."""
import argparse
import ctypes as C
import importlib.util
import json
import sys
from pathlib import Path

module_path=Path(__file__).with_name('render-particle-shader.py')
spec=importlib.util.spec_from_file_location('ubo_reflection_angle',module_path)
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=adapter.sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Reflection source changed')
        inputs[str(path)]=digest;return data
    inventory=json.loads(raw(cache/'research/direct-uniform-inventory.json'))
    for path,digest in inventory['inputs'].items():
        if adapter.sha(raw(path))!=digest:raise ValueError('Prepared material input changed: '+path)
    d=adapter.Draw(args.angle);programs={};rows=[];mismatches=[]
    try:
        d.fn(d.gl,'glGetActiveUniformBlockiv',None,C.c_uint,C.c_uint,C.c_uint,C.POINTER(C.c_int))
        d.fn(d.gl,'glGetActiveUniformBlockName',None,C.c_uint,C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_void_p)
        for material in inventory['programs']:
            stages=material['shaders'];identity=adapter.sha((stages['vertex']+'\0'+stages['pixel']).encode())
            if identity not in programs:programs[identity]=d.program({'glsl':stages['vertex']},{'glsl':stages['pixel']})
            handle=programs[identity];count=C.c_int();d.gl.glGetProgramiv(handle,0x8a36,C.byref(count));active=[]
            for index in range(count.value):
                name=C.create_string_buffer(512);length=C.c_int()
                d.gl.glGetActiveUniformBlockName(handle,index,len(name),C.byref(length),name)
                values={}
                for label,enum in [('size',0x8a40),('vertex',0x8a44),('pixel',0x8a46)]:
                    value=C.c_int();d.gl.glGetActiveUniformBlockiv(handle,index,enum,C.byref(value));values[label]=value.value
                active.append({'index':index,'name':name.value.decode(),**values})
            expected=material['blocks'];by_name={block['name']:block for block in expected}
            errors=[]
            if len(by_name)!=len(expected):errors.append('duplicate-provided-group-name')
            if set(by_name)!={block['name'] for block in active}:errors.append('active-reflection-name-set-differs')
            for block in active:
                provided=by_name.get(block['name'])
                if provided and provided['size']<block['size']:errors.append('provided-storage-smaller-than-active-block:'+block['name'])
            row={'materialKey':material['key'],'kind':material['kind'],'shaderPairSha256':identity,
                 'provided':expected,'active':active,'strictInventoryPass':not errors,'errors':errors}
            rows.append(row)
            if errors:mismatches.append(row)
            error=d.gl.glGetError()
            if error:raise ValueError(f'Actual native UBO reflection GL error {error:x}')
        for module in tuple(sys.modules.values()):
            path=getattr(module,'__file__',None)
            if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
        for path in [Path(__file__),module_path,args.angle/'libEGL.dll',args.angle/'libGLESv2.dll']:raw(path)
        for path,digest in inputs.items():
            if adapter.sha(Path(path).read_bytes())!=digest:raise ValueError('Material reflection input changed: '+path)
        output=cache/'research/direct-uniform-reflection-gles-v33.json'
        output.write_text(json.dumps({'schema':1,'kind':'actual-linked-material-uniform-block-inventory-control',
            'inputs':inputs,'context':d.info,'materials':rows,'mismatches':mismatches,
            'counts':{'materials':len(rows),'uniqueLinkedPrograms':len(programs),
                'perKind':{kind:sum(row['kind']==kind for row in rows) for kind in sorted({row['kind'] for row in rows})},
                'maxActiveBlocks':max(len(row['active']) for row in rows),
                'maxActiveVertexBlocks':max(sum(b['vertex'] for b in row['active']) for row in rows),
                'maxActivePixelBlocks':max(sum(b['pixel'] for b in row['active']) for row in rows)},
            'scope':{'actualGlesProgramReflection':True,'exactPreparedGlslPairs':True,
                'strictActiveNameAndMinimumStorageContract':True,'inactiveBlocksSilentlyDropped':False,
                'drawPerformed':False,'browserContextObserved':False,'nativeWorldParity':False}},indent=2))
        print(json.dumps({'output':str(output),'materials':len(rows),'linkedPrograms':len(programs),'mismatches':len(mismatches),
            'firstMismatches':[{'key':row['materialKey'],'errors':row['errors'],'provided':[b['name'] for b in row['provided']],
                'active':[b['name'] for b in row['active']]} for row in mismatches[:4]]}))
        if mismatches:raise ValueError('Selected material inventory is incompatible with actual active GLSL reflection')
    finally:
        for handle in programs.values():d.gl.glDeleteProgram(handle)
        d.close()


if __name__=='__main__':main()
