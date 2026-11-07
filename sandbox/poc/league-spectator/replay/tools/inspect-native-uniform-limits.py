"""Query the exact local ANGLE WebGL-compatible native context UBO limits."""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    args=parser.parse_args()
    adapter_path=Path(__file__).with_name('observe-shader-angle.py')
    spec=importlib.util.spec_from_file_location('uniform_limit_angle',adapter_path)
    adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
    context=adapter.Angle(args.angle)
    try:
        context.fn(context.gl,'glGetIntegerv',None,C.c_uint,C.POINTER(C.c_int))
        limits={}
        for name,enum in [('MAX_UNIFORM_BUFFER_BINDINGS',0x8a2f),('MAX_VERTEX_UNIFORM_BLOCKS',0x8a2b),
                          ('MAX_FRAGMENT_UNIFORM_BLOCKS',0x8a2d),('MAX_COMBINED_UNIFORM_BLOCKS',0x8a2e),
                          ('MAX_UNIFORM_BLOCK_SIZE',0x8a30)]:
            value=C.c_int();context.gl.glGetIntegerv(enum,C.byref(value))
            if context.gl.glGetError()!=0:raise ValueError('Uniform limit query failed: '+name)
            limits[name]=value.value
        inputs={str(p.resolve()):adapter.sha(p.read_bytes()) for p in [Path(__file__),adapter_path,
            args.angle/'libEGL.dll',args.angle/'libGLESv2.dll']}
        output=args.cache.resolve()/'research/native-uniform-limits.json'
        output.write_text(json.dumps({'schema':1,'kind':'native-angle-webgl-compatible-uniform-limits','inputs':inputs,
            'context':context.info,'limits':limits,'scope':{'actualNativeContextQueried':True,
                'userBrowserContextQueried':False,'renderingPerformed':False}},indent=2))
        print(json.dumps({'output':str(output),'limits':limits}))
    finally:context.close()


if __name__=='__main__':main()
