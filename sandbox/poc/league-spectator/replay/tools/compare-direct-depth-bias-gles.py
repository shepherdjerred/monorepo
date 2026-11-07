"""Real GLES depth-state fixture; not a League pixel-parity comparison."""
import argparse
import ctypes as C
import json
from pathlib import Path
import struct
import sys
import numpy as np
from offscreen_direct_batch import DirectBatchDraw, adapter


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=adapter.sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Depth fixture input drift')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    comparison=read(cache/'research/direct-depth-bias-comparison-v35.json')
    for path,digest in comparison['inputs'].items():
        if adapter.sha(raw(path))!=digest:raise ValueError('Source-current depth comparison required: '+path)
    native=read(cache/'research/direct-depth-bias-native-v35.json')
    d=DirectBatchDraw(args.angle)
    try:
        u,i,f,b=C.c_uint,C.c_int,C.c_float,C.c_ubyte
        for name,result,params in [
            ('glGenRenderbuffers',None,[i,C.POINTER(u)]),('glBindRenderbuffer',None,[u,u]),
            ('glRenderbufferStorage',None,[u,u,i,i]),('glFramebufferRenderbuffer',None,[u,u,u,u]),
            ('glDeleteRenderbuffers',None,[i,C.POINTER(u)]),('glDepthFunc',None,[u]),
            ('glDepthMask',None,[b]),('glClearDepthf',None,[f]),('glDrawArrays',None,[u,i,i]),
            ('glUniform4f',None,[i,f,f,f,f]),('glUniform1f',None,[i,f]),
            ('glIsEnabled',b,[u]),('glGetFloatv',None,[u,C.POINTER(f)])]:d.fn(d.gl,name,result,*params)
        depth=u();d.gl.glGenRenderbuffers(1,C.byref(depth));d.gl.glBindRenderbuffer(0x8d41,depth)
        d.gl.glRenderbufferStorage(0x8d41,0x81a6,512,512)
        d.gl.glFramebufferRenderbuffer(0x8d40,0x8d00,0x8d41,depth)
        if d.gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:raise ValueError('Complete RGBA8/depth24 framebuffer required')
        vertex='#version 300 es\nprecision highp float;uniform float z;void main(){vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));gl_Position=vec4(p[gl_VertexID],z,1.);}'
        fragment='#version 300 es\nprecision highp float;uniform vec4 color;out vec4 outColor;void main(){outColor=color;}'
        program=d.program({'glsl':vertex},{'glsl':fragment});d.gl.glUseProgram(program)
        color=d.gl.glGetUniformLocation(program,b'color');z=d.gl.glGetUniformLocation(program,b'z')
        d.gl.glViewport(0,0,512,512);d.gl.glDisable(0x0b44);d.gl.glDisable(0x0be2)
        d.gl.glEnable(0x0b71);d.gl.glDepthFunc(0x0201);d.gl.glDepthMask(1)
        def fixture(enabled,slope,constant):
            d.gl.glDisable(0x8037);d.gl.glClearColor(0,0,0,1);d.gl.glClearDepthf(1);d.gl.glClear(0x4100)
            d.gl.glUniform1f(z,0);d.gl.glUniform4f(color,1,0,0,1);d.gl.glDrawArrays(4,0,3)
            if enabled:d.gl.glEnable(0x8037);d.gl.glPolygonOffset(slope,constant)
            else:d.gl.glDisable(0x8037)
            d.gl.glUniform1f(z,0.000001);d.gl.glUniform4f(color,0,1,0,1);d.gl.glDrawArrays(4,0,3)
            output=(C.c_ubyte*(512*512*4))();d.gl.glFinish();d.gl.glReadPixels(0,0,512,512,0x1908,0x1401,output)
            actual_enabled=bool(d.gl.glIsEnabled(0x8037));values=[]
            for key in [0x8038,0x2a00]:
                value=f();d.gl.glGetFloatv(key,C.byref(value));values.append(value.value)
            error=d.gl.glGetError()
            if error or actual_enabled!=enabled:raise ValueError(f'GLES raster state/error mismatch: {error:04x}')
            if enabled and struct.pack('<ff',*values)!=struct.pack('<ff',slope,constant):raise ValueError('GL factor order or signed values changed')
            rgba=bytes(output);return {'sha256':adapter.sha(rgba),'centerRGBA':list(rgba[(256*512+256)*4:(256*512+256)*4+4]),'enabled':actual_enabled,'factorHex':struct.pack('<ff',*values).hex()}
        cases=[]
        for source,js in zip(native['cases'],comparison['cases'],strict=True):
            state=bytes.fromhex(source['passes'][0]['nativeRenderStateHex']);slope,constant=struct.unpack('<ff',state[24:32]);expected=fixture(bool(state[4]&8),slope,constant)
            p=js['program'];compiled_factors=struct.unpack('<ff',bytes.fromhex(js['programFactorHex']));actual=fixture(p['enabled'],*compiled_factors)
            if actual!=expected:raise ValueError('Native descriptor versus compiled program raster mismatch')
            cases.append({'factorHex':source['factorHex'],'native':expected,'compiled':actual})
        restored=[fixture(True,-1,-60),fixture(False,0,0),fixture(True,-1,-60)]
        if [v['centerRGBA'] for v in restored]!=[[0,255,0,255],[255,0,0,255],[0,255,0,255]]:raise ValueError('Biased/unbiased/restored depth raster did not distinguish occlusion')
        d.gl.glDeleteRenderbuffers(1,C.byref(depth));d.gl.glDeleteProgram(program)
    finally:d.close()
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for name in ['libEGL.dll','libGLESv2.dll']:raw(args.angle/name)
    for path,digest in inputs.items():
        if adapter.sha(Path(path).read_bytes())!=digest:raise ValueError('Final depth fixture source drift')
    output=cache/'research/direct-depth-bias-gles-v35.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-depth-bias-shared-state-real-gles-fixture','artifactVersion':35,'inputs':inputs,'cases':cases,'restoredDraws':restored,'fixtureShaders':{'vertex':vertex,'fragment':fragment},'scope':{'nativeDescriptorVersusCompiledProgram':True,'realGLESDepthAttachment':True,'biasedUnbiasedRestoredOcclusion':True,'leagueShaderPixelParity':False,'actualSpectatorGPUAcceptance':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'restoredDraws':len(restored),'mismatches':0}))


if __name__=='__main__':main()
