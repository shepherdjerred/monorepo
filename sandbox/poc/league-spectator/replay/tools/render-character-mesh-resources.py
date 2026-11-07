"""Render verified native SKN buffers with explicitly diagnostic materials."""
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


def sha(data):return hashlib.sha256(data).hexdigest()


VERTEX='''#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 projection;
uniform mat3 rotation;
out vec3 surfaceNormal;
void main(){gl_Position=projection*vec4(position,1.0);surfaceNormal=rotation*normal;}
'''
PIXEL='''#version 300 es
precision highp float;
in vec3 surfaceNormal;
uniform vec3 materialColor;
out vec4 color;
void main(){float light=0.25+0.75*abs(dot(normalize(surfaceNormal),normalize(vec3(0.4,0.6,0.8))));
color=vec4(materialColor*light,1.0);}
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('angle',type=Path);args=parser.parse_args()
    cache=args.cache.resolve();root=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    proof=json.loads(raw(cache/'research/character-mesh-indices-comparison.json'))
    if (proof['sourceSha256']!=sha(raw(root/'compare-character-mesh-indices.py')) or
            not proof['materialLocalIndicesMatchGpuReadback'] or not proof['cpuTriangleVisitsMatchSource'] or
            not proof['vertexSourceBytesMatchGpuReadback']):
        raise ValueError('Current successful independent vertex/index comparison required')
    for path,expected in proof['inputs'].items():
        if sha(raw(path))!=expected:raise ValueError('Mesh comparison input changed: '+path)
    report=json.loads(raw(cache/'research/character-mesh-cpu-index-native.json'))
    for name,expected in report['sources'].items():
        if sha(raw(root/name))!=expected:raise ValueError('Native mesh producer changed: '+name)
    for path,expected in report['inputs'].items():
        if sha(raw(path))!=expected:raise ValueError('Native mesh input changed: '+path)
    if report['boundary'] or not report['scope']['gpuMeshUploaded']:raise ValueError('Completed native GPU mesh setup required')
    original=report['gpuMesh']['buffer'];source=bytes.fromhex(original['bytesHex'])
    index_source=bytes.fromhex(report['indexBuffer']['bytesHex']);bindings=report['gpuMesh']['layout']['bindings']
    selected=[]
    for semantic,offset in [(0,0),(2,32)]:
        matches=[b for b in bindings if b['semantic']==semantic]
        if len(matches)!=1 or matches[0]['offset']!=offset:raise ValueError('Diagnostic requires original float position/normal bindings')
        selected.append(matches[0])
    stride=selected[0]['stride']
    if any(b['stride']!=stride for b in selected) or len(source)!=proof['counts']['vertices']*stride:
        raise ValueError('Native vertex source differs from its original binding stride')
    device=GraphicsTextureDevice(args.angle);backend=GraphicsMeshDevice(device);gl=device.gl;draws=[]
    for name in ['libEGL.dll','libGLESv2.dll']:raw(args.angle/name)
    depth=C.c_uint();program=None
    try:
        for name,result,types in [
            ('glDrawElements',None,[C.c_uint,C.c_int,C.c_uint,C.c_void_p]),
            ('glUniformMatrix4fv',None,[C.c_int,C.c_int,C.c_ubyte,C.POINTER(C.c_float)]),
            ('glUniformMatrix3fv',None,[C.c_int,C.c_int,C.c_ubyte,C.POINTER(C.c_float)]),
            ('glUniform3f',None,[C.c_int,C.c_float,C.c_float,C.c_float]),
            ('glGenRenderbuffers',None,[C.c_int,C.POINTER(C.c_uint)]),
            ('glBindRenderbuffer',None,[C.c_uint,C.c_uint]),
            ('glRenderbufferStorage',None,[C.c_uint,C.c_uint,C.c_int,C.c_int]),
            ('glFramebufferRenderbuffer',None,[C.c_uint,C.c_uint,C.c_uint,C.c_uint]),
            ('glDeleteRenderbuffers',None,[C.c_int,C.POINTER(C.c_uint)])]:device.fn(gl,name,result,*types)
        gl.glGenRenderbuffers(1,C.byref(depth));gl.glBindRenderbuffer(0x8d41,depth)
        gl.glRenderbufferStorage(0x8d41,0x81a6,512,512);gl.glBindFramebuffer(0x8d40,device.framebuffer)
        gl.glFramebufferRenderbuffer(0x8d40,0x8d00,0x8d41,depth)
        if gl.glCheckFramebufferStatus(0x8d40)!=0x8cd5:raise ValueError('Mesh diagnostic depth framebuffer is incomplete')
        program=device.program({'glsl':VERTEX},{'glsl':PIXEL});gl.glUseProgram(program)
        vertex=backend.create_buffer(source,0);indices=backend.create_buffer(index_source,0)
        vao=C.c_uint();gl.glGenVertexArrays(1,C.byref(vao));backend.vaos.append(vao);gl.glBindVertexArray(vao)
        gl.glBindBuffer(0x8892,vertex['glHandle']);gl.glBindBuffer(0x8893,indices['glHandle'])
        positions=np.ndarray((proof['counts']['vertices'],3),dtype='<f4',buffer=source,strides=(stride,4)).astype(np.float64)
        if not np.isfinite(positions).all():raise ValueError('Diagnostic positions must be finite')
        center=(positions.min(0)+positions.max(0))/2
        fig,axes=plt.subplots(1,3,figsize=(15,7),facecolor='#101923')
        for axis,(label,angle) in zip(axes,[('Front',0),('Three-quarter',np.pi/4),('Side',np.pi/2)]):
            c,s=np.cos(angle),np.sin(angle);rotation=np.array([[c,0,s],[0,1,0],[-s,0,c]])
            rotated=(positions-center)@rotation.T;extent=np.maximum(np.ptp(rotated,axis=0),1e-6)
            scale=1.8/max(extent[:2]);matrix=np.eye(4)
            matrix[:3,:3]=np.diag([scale,scale,1.5/max(extent)])@rotation
            matrix[:3,3]=-matrix[:3,:3]@center
            gl.glUniformMatrix4fv(gl.glGetUniformLocation(program,b'projection'),1,0,(C.c_float*16)(*matrix.T.flatten()))
            gl.glUniformMatrix3fv(gl.glGetUniformLocation(program,b'rotation'),1,0,(C.c_float*9)(*rotation.T.flatten()))
            gl.glViewport(0,0,512,512);gl.glDisable(0x0b44);gl.glDisable(0x0be2);gl.glEnable(0x0b71)
            gl.glClearColor(.025,.04,.065,1);gl.glClear(0x4000|0x100)
            for i,material in enumerate(proof['materials']):
                for location,binding in enumerate(selected):
                    gl.glEnableVertexAttribArray(location)
                    gl.glVertexAttribPointer(location,3,0x1406,0,stride,C.c_void_p(material['startVertex']*stride+binding['offset']))
                palette=[(.28,.77,.71),(.91,.65,.29)][i%2]
                gl.glUniform3f(gl.glGetUniformLocation(program,b'materialColor'),*palette)
                gl.glDrawElements(4,material['indices'],0x1403,C.c_void_p(material['startIndex']*2))
            gl.glFinish();pixels=(C.c_ubyte*(512*512*4))();gl.glReadPixels(0,0,512,512,0x1908,0x1401,pixels)
            if gl.glGetError():raise ValueError('Native mesh diagnostic indexed draw failed')
            rgba=np.frombuffer(pixels,dtype=np.uint8).reshape(512,512,4)[::-1].copy()
            if len(np.unique(rgba[:,:,:3].reshape(-1,3),axis=0))<2:raise ValueError('Native mesh diagnostic has no visible geometry')
            axis.imshow(rgba);axis.axis('off');axis.set_title(label,color='#dce8f5',fontsize=13)
            draws.append({'view':label,'pixelsSha256':sha(rgba.tobytes()),'projection':matrix.tolist()})
        fig.suptitle('Native character mesh pipeline',color='#e3edf7',fontsize=23,y=.96)
        counts=proof['counts']
        fig.text(.5,.88,f"Karthus / skin 10 | Build {report['build']} | {counts['vertices']:,} vertices | {counts['triangles']:,} triangles",ha='center',color='#9caec2',fontsize=12)
        fig.text(.5,.14,'Original mesh + skeleton reads, bone remapping and buffer setup; vertex/index bytes independently matched.',ha='center',color='#78d5c2',fontsize=11)
        fig.text(.5,.09,'Geometry diagnostic: rest pose, diagnostic colors and lighting. No League materials, animation or spell playback.',ha='center',color='#efc38b',fontsize=10)
        fig.text(.5,.045,'The main replay viewer is unchanged.',ha='center',color='#9caec2',fontsize=11)
        fig.subplots_adjust(top=.81,bottom=.2,wspace=.04)
        output=cache/'public/evidence/latest-character-mesh-resources.png';output.parent.mkdir(parents=True,exist_ok=True)
        fig.savefig(output,dpi=100,facecolor=fig.get_facecolor());plt.close(fig)
        for name in ['graphics_texture_device.py','graphics_mesh_device.py','render-particle-shader.py','observe-shader-angle.py']:raw(root/name)
        evidence={'schema':1,'kind':'native-character-mesh-geometry-diagnostic','inputs':inputs,
                  'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),'draws':draws,
                  'scope':{'diagnosticShader':True,'offscreenGlesDraw':True,'originalLeagueMaterials':False,
                           'animatedPose':False,'spellPlayback':False,'mainViewerExpanded':False}}
        output.with_suffix('.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        print(json.dumps({'image':str(output),'sha256':evidence['imageSha256']}))
    finally:
        if program:gl.glDeleteProgram(program)
        if depth.value:gl.glDeleteRenderbuffers(1,C.byref(depth))
        backend.close();device.close()


if __name__=='__main__':main()
