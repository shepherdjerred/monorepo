"""Draw and read back every authored DDS cube face/mip with a samplerCube.

The diagnostic shader selects face directions explicitly. This is a resource
and orientation diagnostic, not League materials, replay or browser playback.
"""
import argparse
import ctypes as C
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from graphics_texture_device import GraphicsTextureDevice
from dds_cube import decode_cube,FACE_NAMES


def sha(raw):return hashlib.sha256(raw).hexdigest()


VERTEX='''#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
gl_Position=vec4(p*2.0-1.0,0.0,1.0);}
'''
PIXEL='''#version 300 es
precision highp float;
uniform samplerCube sourceCube;
uniform int faceIndex; uniform float side; uniform float mipLevel;
out vec4 color;
void main(){
 vec2 p=2.0*gl_FragCoord.xy/side-1.0;
 vec3 d;
 if(faceIndex==0)d=vec3(1.0,-p.y,-p.x);
 else if(faceIndex==1)d=vec3(-1.0,-p.y,p.x);
 else if(faceIndex==2)d=vec3(p.x,1.0,p.y);
 else if(faceIndex==3)d=vec3(p.x,-1.0,-p.y);
 else if(faceIndex==4)d=vec3(p.x,-p.y,1.0);
 else d=vec3(-p.x,-p.y,-1.0);
 color=textureLod(sourceCube,d,mipLevel);
}
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();assets=cache/'public';root=assets/'latest-dds-cubes'
    package_raw=(root/'package.json').read_bytes();package=json.loads(package_raw)
    if package['build']!='16.21.829.8620' or package['kind']!='prepared-dds-cubemaps':raise ValueError('Unadmitted cube package')
    for path,digest in package['inputs'].items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('DDS package source input changed')
    for name,digest in package['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=digest:raise ValueError('DDS package producer changed')
    device=GraphicsTextureDevice(args.angle);gl=device.gl;proofs=[];inputs={};cube_records=[]
    try:
        device.fn(gl,'glUniform1f',None,C.c_int,C.c_float)
        device.fn(gl,'glDrawArrays',None,C.c_uint,C.c_int,C.c_int)
        program=device.program({'glsl':VERTEX},{'glsl':PIXEL})
        fig,axes=plt.subplots(3,6,figsize=(13,7),facecolor='#101822')
        for row,(key,cube) in enumerate(package['cubes'].items()):
            original_path=assets/'latest-effects'/cube['rawFile'];original=original_path.read_bytes()
            inputs[str(original_path)]=sha(original)
            if sha(original)!=key:raise ValueError('Original DDS cube source changed')
            decoded=decode_cube(original);rgba=[];bgra=[]
            for mip,level in enumerate(cube['levels']):
                colors=[];native=[]
                for face,plane in enumerate(level):
                    raw=(root/plane['file']).read_bytes();inputs[str(root/plane['file'])]=sha(raw)
                    if sha(raw)!=plane['sha256'] or raw!=decoded['levels'][mip][face]['rgba']:
                        raise ValueError('Prepared cube plane differs from original DDS')
                    colors.append(raw);converted=bytearray(raw);converted[0::4],converted[2::4]=raw[2::4],raw[0::4];native.append(bytes(converted))
                rgba.append(colors);bgra.append(native)
            gpu=device.create({'kind':'cube','nativeFormat':2,'width':cube['width'],'height':cube['height'],'layers':6,'levels':bgra})
            cube_records.append({'sourceSha256':key,**gpu})
            # GraphicsTextureDevice readback leaves its last uploaded face
            # attached. Use a separate RGBA target to avoid feedback sampling.
            gl.glActiveTexture(0x84c1)
            target=device.texture(np.zeros((cube['height'],cube['width'],4),dtype=np.uint8),'clamp','nearest')
            gl.glBindFramebuffer(0x8d40,device.framebuffer)
            gl.glFramebufferTexture2D(0x8d40,0x8ce0,0x0de1,target,0)
            if gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:raise ValueError('Cube diagnostic framebuffer incomplete')
            gl.glActiveTexture(0x84c0);gl.glBindTexture(0x8513,gpu['glHandle'])
            gl.glUseProgram(program);gl.glUniform1i(gl.glGetUniformLocation(program,b'sourceCube'),0)
            gl.glDisable(0x0be2);gl.glDisable(0x0b71);gl.glDisable(0x0b44);gl.glDisable(0x0bd0)
            for mip,level in enumerate(rgba):
                side=max(1,cube['width']>>mip);gl.glViewport(0,0,side,side)
                gl.glUniform1f(gl.glGetUniformLocation(program,b'side'),side)
                gl.glUniform1f(gl.glGetUniformLocation(program,b'mipLevel'),mip)
                for face,expected in enumerate(level):
                    gl.glUniform1i(gl.glGetUniformLocation(program,b'faceIndex'),face)
                    gl.glDrawArrays(4,0,3);gl.glFinish()
                    actual=C.create_string_buffer(side*side*4);gl.glReadPixels(0,0,side,side,0x1908,0x1401,actual)
                    if gl.glGetError() or actual.raw!=expected:
                        raise ValueError(f'SamplerCube face/mip orientation or pixels differ: {key} {face} {mip}')
                    proofs.append({'sourceSha256':key,'mip':mip,'face':face,'side':side,'pixelsSha256':sha(actual.raw),'exact':True})
                    if mip==0:
                        ax=axes[row,face];ax.imshow(np.frombuffer(actual.raw,dtype=np.uint8).reshape(side,side,4),interpolation='nearest')
                        ax.set_title(FACE_NAMES[face],color='#d7e4ef',fontsize=11);ax.set_xticks([]);ax.set_yticks([])
                        if face==0:
                            path=next(path for path,value in package['paths'].items() if value==key)
                            ax.set_ylabel(f'{Path(path).stem}\n{side} × {side}; {cube["mips"]} mip(s)',color='#d7e4ef',fontsize=10)
            if row==2:
                # Keep the tiny authored levels visible without hiding that
                # the main grid shows base faces only.
                fig.text(.5,.035,f'All {len(proofs)} face/mip shader draws reproduce prepared pixels exactly.',ha='center',color='#d7e4ef',fontsize=10)
        fig.suptitle('Authored cubemaps → six GPU faces + mip chains',color='#e9eef7',fontsize=19,y=.98)
        fig.text(.5,.075,'Resource diagnostic with samplerCube. No League effect material, replay frame or browser capture.',ha='center',color='#a9bacf',fontsize=10)
        fig.subplots_adjust(top=.9,bottom=.14,left=.13,right=.98,hspace=.32,wspace=.12)
        destination=assets/'evidence/latest-dds-cubes.png';destination.parent.mkdir(parents=True,exist_ok=True)
        fig.savefig(destination,dpi=130,facecolor=fig.get_facecolor());plt.close(fig)
        result={'schema':1,'kind':'dds-cube-gpu-diagnostic','build':package['build'],'packageSha256':sha(package_raw),
            'imageSha256':sha(destination.read_bytes()),'rendererSha256':sha(Path(__file__).read_bytes()),
            'cubeDecoderSha256':sha(Path(__file__).with_name('dds_cube.py').read_bytes()),'inputs':inputs,
            'counts':{'cubes':len(cube_records),'gpuSubresources':sum(len(c['readbacks']) for c in cube_records),'exactSamplerDraws':len(proofs)},
            'context':device.info,'uploads':cube_records,'draws':proofs,
            'scope':{'allAuthoredFacesAndMips':True,'gpuReadbackCompared':True,'samplerCubeDrawsCompared':True,
                'diagnosticShader':True,'originalMaterials':False,'referenceCompared':False,'browserExecuted':False,'mainViewerIntegrated':False}}
        destination.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        gl.glDeleteProgram(program)
        print(json.dumps({'image':str(destination),'sha256':result['imageSha256'],'counts':result['counts']}))
    finally:device.close()


if __name__=='__main__':main()
