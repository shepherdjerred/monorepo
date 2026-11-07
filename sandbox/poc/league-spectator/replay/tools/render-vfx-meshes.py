"""Render original SCB parser output with an explicit geometry diagnostic shader.

These are real offscreen GLES draws of retained native vertex buffers, not
League materials, replay frames, browser playback or visual-fidelity proof.
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
from graphics_mesh_device import GraphicsMeshDevice
from graphics_mesh_attributes import bind_scb_attributes


def sha(data):return hashlib.sha256(data).hexdigest()


VERTEX='''#version 300 es
layout(location=0) in vec3 a_POSITION;
layout(location=1) in vec3 a_NORMAL;
layout(location=2) in vec2 a_TEXCOORD;
uniform mat4 diagnosticProjection;
out vec3 normal; out vec2 uv;
void main(){gl_Position=diagnosticProjection*vec4(a_POSITION,1.0);normal=a_NORMAL;uv=a_TEXCOORD;}
'''
PIXEL='''#version 300 es
precision highp float;
in vec3 normal; in vec2 uv; out vec4 color;
void main(){
 float shade=0.35+0.65*abs(dot(normalize(normal),normalize(vec3(0.4,0.8,0.6))));
 float grid=mod(floor(uv.x*8.0)+floor(uv.y*8.0),2.0);
 color=vec4(mix(vec3(0.18,0.55,0.8),vec3(0.4,0.88,0.72),grid)*shade,1.0);
}
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path)
    parser.add_argument('--source',type=Path);parser.add_argument('--uninspected',action='store_true',help='Local development artifact only; cannot publish')
    args=parser.parse_args();cache=args.cache.resolve()
    raw=(args.source or cache/'research/vfx-meshes-native.json').read_bytes();data=json.loads(raw)
    proof_bytes=None
    if not args.uninspected:
        proof_bytes=(cache/'research/vfx-meshes-inspection.json').read_bytes();proof=json.loads(proof_bytes)
        if proof['observationSha256']!=sha(raw) or proof['mismatchCount']:
            raise ValueError('Native mesh observations lack matching inspection')
    meshes={}
    for case in data['cases']:
        for mesh in case['staticMeshSetups']:
            meshes.setdefault(mesh['path'],(mesh,case))
    ordered=sorted(meshes.values(),key=lambda x:(x[0]['triangles'],x[0]['path']))
    if not ordered:raise ValueError('No original SCB geometry to render')
    selected=[ordered[int(i)] for i in np.linspace(0,len(ordered)-1,min(9,len(ordered)))]
    device=GraphicsTextureDevice(args.angle);backend=GraphicsMeshDevice(device);gl=device.gl;draws=[]
    try:
        device.fn(gl,'glDrawArrays',None,C.c_uint,C.c_int,C.c_int)
        device.fn(gl,'glUniformMatrix4fv',None,C.c_int,C.c_int,C.c_ubyte,C.POINTER(C.c_float))
        device.fn(gl,'glGenRenderbuffers',None,C.c_int,C.POINTER(C.c_uint))
        device.fn(gl,'glBindRenderbuffer',None,C.c_uint,C.c_uint)
        device.fn(gl,'glRenderbufferStorage',None,C.c_uint,C.c_uint,C.c_int,C.c_int)
        device.fn(gl,'glFramebufferRenderbuffer',None,C.c_uint,C.c_uint,C.c_uint,C.c_uint)
        device.fn(gl,'glDeleteRenderbuffers',None,C.c_int,C.POINTER(C.c_uint))
        depth=C.c_uint();gl.glGenRenderbuffers(1,C.byref(depth));gl.glBindRenderbuffer(0x8d41,depth)
        gl.glRenderbufferStorage(0x8d41,0x81a6,512,512)
        gl.glBindFramebuffer(0x8d40,device.framebuffer);gl.glFramebufferRenderbuffer(0x8d40,0x8d00,0x8d41,depth)
        if gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:raise ValueError('Mesh diagnostic depth framebuffer is incomplete')
        program=device.program({'glsl':VERTEX},{'glsl':PIXEL})
        attributes=[{'semantic':s,'index':0,'mask':m,'glslName':'a_'+s} for s,m in [('POSITION',7),('NORMAL',7),('TEXCOORD',3)]]
        fig,axes=plt.subplots(3,3,figsize=(12,10),facecolor='#101822');axes=axes.flatten()
        for ax in axes:ax.axis('off')
        for ax,(mesh,case) in zip(axes,selected):
            original=next(b for b in case['meshBuffers'] if b['nativePointer']==mesh['nativeBuffer'])
            source=bytes.fromhex(original['bytesHex']);buffer=backend.create_buffer(source,original['flags'])
            layout=next(v for v in case['meshLayouts'] if v['nativePointer']==mesh['nativeLayout'])
            vao=backend.create_layout(bytes.fromhex(layout['descriptorHex']),layout['attributeCount'])
            binding_proof=bind_scb_attributes(device,layout,{mesh['nativeBuffer']:buffer},program,attributes)
            positions=np.frombuffer(source,dtype=np.dtype({'names':['p'],'formats':[('<f4',3)],'offsets':[0],'itemsize':36}))['p'].astype(np.float64)
            center=(positions.min(0)+positions.max(0))/2
            _,_,basis=np.linalg.svd(positions-center,full_matrices=False)
            # Principal-axis framing is a diagnostic camera, not match placement.
            if np.linalg.det(basis)<0:basis[2]*=-1
            rotated=(positions-center)@basis.T;extent=np.maximum(np.ptp(rotated,axis=0),1e-6)
            scale=1.75/max(extent[:2]);matrix=np.eye(4)
            matrix[:3,:3]=np.diag([scale,scale,1.75/max(extent)])@basis
            matrix[:3,3]=-matrix[:3,:3]@center
            gl.glUseProgram(program);location=gl.glGetUniformLocation(program,b'diagnosticProjection')
            gl.glUniformMatrix4fv(location,1,0,(C.c_float*16)(*matrix.T.flatten()))
            gl.glViewport(0,0,512,512);gl.glDisable(0x0b44);gl.glDisable(0x0be2);gl.glEnable(0x0b71)
            gl.glClearColor(.025,.04,.065,1);gl.glClear(0x4000|0x100)
            gl.glDrawArrays(4,0,len(source)//36);gl.glFinish()
            pixels=(C.c_ubyte*(512*512*4))();gl.glReadPixels(0,0,512,512,0x1908,0x1401,pixels)
            if gl.glGetError():raise ValueError('Native mesh geometry diagnostic draw failed')
            rgba=np.frombuffer(pixels,dtype=np.uint8).reshape(512,512,4)[::-1].copy()
            if len(np.unique(rgba[:,:,:3].reshape(-1,3),axis=0))<2:raise ValueError('Native mesh diagnostic draw produced no visible geometry')
            ax.imshow(rgba);ax.set_title(f"{Path(mesh['path']).stem}\n{mesh['triangles']:,} triangles",color='#d7e4ef',fontsize=10)
            draws.append({'path':mesh['path'],'effectId':case['effectId'],'bufferSha256':sha(source),
                'pixelsSha256':sha(rgba.tobytes()),'vertexBindings':binding_proof,'diagnosticProjection':matrix.tolist()})
        fig.suptitle('Original SCB geometry → native vertex writer → GLES',color='#e9eef7',fontsize=19,y=.98)
        fig.text(.5,.025,'Geometry diagnostic: checker colors, automatic framing. No League materials, replay timing or browser playback.',
            color='#a9bacf',ha='center',fontsize=10)
        fig.subplots_adjust(top=.91,bottom=.07,hspace=.3,wspace=.06)
        destination=cache/'public/evidence/latest-vfx-meshes.png';destination.parent.mkdir(parents=True,exist_ok=True)
        fig.savefig(destination,dpi=130,facecolor=fig.get_facecolor());plt.close(fig)
        summary={'schema':1,'kind':'native-vfx-mesh-geometry-diagnostic','build':data['build'],
            'observationSha256':sha(raw),'inspectionSha256':sha(proof_bytes) if proof_bytes else None,
            'imageSha256':sha(destination.read_bytes()),'uniqueScbMeshes':len(meshes),'draws':draws,
            'rendererSha256':sha(Path(__file__).read_bytes()),
            'attributeBinderSha256':sha(Path(__file__).with_name('graphics_mesh_attributes.py').read_bytes()),
            'scope':{'diagnosticShader':True,'originalVertexBytes':True,'gpuAttributeStateQueried':True,
                'originalMaterials':False,'replayFrames':False,'browserExecuted':False,'mainViewerIntegrated':False}}
        destination.with_suffix('.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
        print(json.dumps({'image':str(destination),'draws':len(draws),'uniqueScbMeshes':len(meshes),'sha256':summary['imageSha256']}))
        gl.glDeleteProgram(program);gl.glDeleteRenderbuffers(1,C.byref(depth))
    finally:backend.close();device.close()


if __name__=='__main__':main()
