"""Render controlled reusable-sampler motion with diagnostic mesh presentation."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import numpy as np
from PIL import Image,features


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path);args=parser.parse_args()
    cache=args.cache.resolve();tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def proof(name,producer):
        report=json.loads(raw(cache/'research'/name))
        if sha(raw(tools/producer))!=report['sourceSha256']:raise ValueError('Evidence producer changed: '+producer)
        for path,expected in report['inputs'].items():
            if sha(raw(path))!=expected:raise ValueError('Evidence input changed: '+path)
        return report
    motion=proof('native-animation-sampler-motion.json','export-native-animation-motion.mjs')
    mesh=proof('character-mesh-indices-comparison.json','compare-character-mesh-indices.py')
    native=json.loads(raw(cache/'research/character-mesh-cpu-index-native.json'))
    for name,expected in native['sources'].items():
        if sha(raw(tools/name))!=expected:raise ValueError('Native mesh producer changed: '+name)
    if (motion['actor']!='champions/karthus/10' or motion['build']!=mesh['build'] or
            not mesh['vertexSourceBytesMatchGpuReadback'] or not mesh['materialLocalIndicesMatchGpuReadback'] or
            motion['fps']!=24 or motion['frameCount']!=72 or len(motion['clips'])!=2 or not features.check('webp')):
        raise ValueError('Exact verified mesh/motion and WebP encoder required')
    encoded=raw(cache/'research/native-animation-sampler-motion.bin')
    if sha(encoded)!=motion['binarySha256']:raise ValueError('WASM motion matrices changed')
    pose_manifest=json.loads(raw(cache/'public/latest-animation-poses/manifest.json'))
    graph=[g for g in pose_manifest['graphs'].values() if g['actor']==motion['actor']]
    if len(graph)!=1 or graph[0]['catalog']['joints']!=motion['jointNames']:raise ValueError('Native motion rig order differs')
    rig=raw(cache/'public/latest-scene'/graph[0]['rigFile']);count=len(motion['jointNames'])
    if sha(rig)!=graph[0]['rigSha256'] or struct.unpack_from('<III',rig)!=(len(rig),0x22fd4fc3,0):raise ValueError('Pinned raw rig changed')
    influences_count=struct.unpack_from('<I',rig,16)[0];influences_at=struct.unpack_from('<i',rig,28)[0]
    if not 0<influences_count<=256 or not 64<=influences_at<=len(rig)-influences_count*2:
        raise ValueError('Raw rig influences exceed bounds')
    influences=np.array(struct.unpack_from('<'+'h'*influences_count,rig,influences_at))
    if np.any(influences<0) or np.any(influences>=count):raise ValueError('Rig influence joint index exceeds bounds')
    source=bytes.fromhex(native['gpuMesh']['buffer']['bytesHex']);vertices=mesh['counts']['vertices'];stride=56
    if len(source)!=vertices*stride:raise ValueError('Compared vertex source size differs')
    position=np.ndarray((vertices,3),dtype='<f4',buffer=source,strides=(stride,4)).astype(np.float64)
    blend=np.ndarray((vertices,4),dtype='u1',buffer=source,offset=12,strides=(stride,1)).copy()
    weights=np.ndarray((vertices,4),dtype='<f4',buffer=source,offset=16,strides=(stride,4)).astype(np.float64)
    if (np.any(blend>=influences_count) or not np.isfinite(weights).all() or np.any(weights<0) or
            np.max(np.abs(weights.sum(1)-1))>1e-4):raise ValueError('Compared mesh influence data differs')
    joints=influences[blend];homogeneous=np.column_stack([position,np.ones(vertices)])
    indices=np.frombuffer(bytes.fromhex(native['indexBuffer']['bytesHex']),dtype='<u2');triangles=[];colors=[]
    for index,material in enumerate(mesh['materials']):
        values=indices[material['startIndex']:material['startIndex']+material['indices']]
        triangles.append(values.reshape(-1,3).astype(np.int64)+material['startVertex'])
        colors.extend([[.28,.77,.71] if index%2==0 else [.91,.65,.29]]*(len(values)//3))
    triangles=np.concatenate(triangles);colors=np.array(colors)
    angle=np.pi/5;c,s=np.cos(angle),np.sin(angle);view=np.array([[c,0,s],[0,1,0],[-s,0,c]])
    light=np.array([.4,.6,.8]);light/=np.linalg.norm(light)
    positions=[];draws=[]
    for clip in motion['clips']:
        if len(clip['frames'])!=motion['frameCount']:raise ValueError('Native motion frame count differs')
        frames=[]
        for frame in clip['frames']:
            at,size=frame['offset'],frame['bytes']
            if size!=count*48 or not 0<=at<=len(encoded)-size:raise ValueError('Native motion matrix span exceeds bounds')
            palette=np.tile(np.eye(4),(count,1,1));palette[:,:3,:]=np.frombuffer(encoded[at:at+size],dtype='<f4').reshape(count,3,4)
            skin=palette[joints];points=(np.einsum('vkij,vj->vki',skin,homogeneous)*weights[:,:,None]).sum(1)[:,:3]@view.T
            if not np.isfinite(points).all():raise ValueError('Diagnostic vertex skinning produced non-finite output')
            frames.append(points)
        positions.append(frames)
        draws.append({'clip':clip['name'],'skinnedPositionsSha256':sha(np.array(frames,dtype='<f8').tobytes())})
    fig,axes=plt.subplots(1,2,figsize=(12,7),facecolor='#101923');artists=[]
    for axis,frames in zip(axes,positions):
        combined=np.concatenate(frames);center=(combined.min(0)+combined.max(0))/2;radius=max(np.ptp(combined[:,:2],axis=0))*.55
        if not radius>0:raise ValueError('Native motion has no finite extent')
        axis.set_facecolor('#101923');axis.set_xlim(center[0]-radius,center[0]+radius);axis.set_ylim(center[1]-radius,center[1]+radius)
        axis.set_aspect('equal');axis.set_axis_off();artist=PolyCollection([],edgecolors='none');axis.add_collection(artist);artists.append(artist)
    fig.suptitle('Original animation sampler · WASM',color='#e3edf7',fontsize=23,y=.96)
    fig.text(.5,.88,f"Karthus / skin 10 | Build {motion['build']} | Controlled clip playback at 24 fps",ha='center',color='#a5bad1',fontsize=12)
    fig.text(.5,.074,'Native ANM → world poses → inverse-bind matrices. Attack holds its terminal keyframe.',ha='center',color='#78d5c2',fontsize=11)
    fig.text(.5,.035,'CPU mesh blending, colors, lighting and camera are diagnostic. No particles, audio or recorded match selection.',ha='center',color='#efc38b',fontsize=10)
    fig.subplots_adjust(top=.78,bottom=.13,wspace=.04);images=[]
    for frame in range(motion['frameCount']):
        for index,(axis,artist,clip) in enumerate(zip(axes,artists,motion['clips'])):
            faces=positions[index][frame][triangles];normals=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0]);length=np.linalg.norm(normals,axis=1)
            normal=np.divide(normals,length[:,None],out=np.zeros_like(normals),where=length[:,None]>0)
            brightness=.25+.75*np.abs(normal@light);order=np.argsort(faces[:,:,2].mean(1))[::-1]
            artist.set_verts(faces[order,:,:2]);artist.set_facecolors((colors*brightness[:,None])[order])
            axis.set_title(f"{clip['name']} | {clip['kind']}\nclip t = {clip['frames'][frame]['time']:.3f}s",color='#dce8f5',fontsize=13)
        fig.canvas.draw();images.append(Image.fromarray(np.array(fig.canvas.buffer_rgba()).copy()).convert('RGB'))
    plt.close(fig);output=cache/'public/evidence/latest-native-animation-motion.webp';output.parent.mkdir(parents=True,exist_ok=True)
    durations=[round((i+1)*1000/motion['fps'])-round(i*1000/motion['fps']) for i in range(motion['frameCount'])]
    images[0].save(output,save_all=True,append_images=images[1:],duration=durations,loop=0,lossless=True,method=4)
    poster=output.with_suffix('.png');images[0].save(poster)
    contact=Image.new('RGB',(images[0].width,images[0].height*3),'#101923')
    for row,frame in enumerate([0,24,48]):contact.paste(images[frame],(0,row*images[0].height))
    contact_path=output.with_name('latest-native-animation-motion-contact.png');contact.save(contact_path)
    with Image.open(output) as check:
        if check.n_frames!=motion['frameCount'] or check.size!=images[0].size:raise ValueError('Encoded motion dimensions/frame count differ')
    webp=output.read_bytes();at=12;encoded_durations=[]
    if webp[:4]!=b'RIFF' or webp[8:12]!=b'WEBP' or struct.unpack_from('<I',webp,4)[0]+8!=len(webp):
        raise ValueError('Encoded motion RIFF container differs')
    while at<len(webp):
        if at+8>len(webp):raise ValueError('Truncated encoded motion chunk')
        tag=webp[at:at+4];size=struct.unpack_from('<I',webp,at+4)[0];start=at+8
        if start+size>len(webp):raise ValueError('Encoded motion chunk exceeds container')
        if tag==b'ANMF':
            if size<16:raise ValueError('Encoded motion frame header is truncated')
            encoded_durations.append(int.from_bytes(webp[start+12:start+15],'little'))
        at=start+size+(size&1)
    if at!=len(webp) or encoded_durations!=durations:raise ValueError('Encoded motion frame timings differ')
    for path in [matplotlib.__file__,np.__file__,Image.__file__]:raw(path)
    evidence={'schema':1,'kind':'native-animation-sampler-motion-diagnostic','build':motion['build'],'inputs':inputs,
              'sourceSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'posterSha256':sha(poster.read_bytes()),'contactSha256':sha(contact_path.read_bytes()),
              'frameCount':motion['frameCount'],'fps':motion['fps'],'durationMs':sum(durations),'draws':draws,
              'scope':{'actualWasmSamplerMatrices':True,'controlledClipPlayback':True,'diagnosticCpuSkinning':True,
                       'leagueMaterials':False,'particles':False,'audio':False,'recordedMatchPlayback':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'frames':len(images),'durationMs':sum(durations),'sha256':evidence['imageSha256']}))


if __name__=='__main__':main()
