"""Render native ANM/world poses with explicitly diagnostic CPU mesh skinning."""
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


def sha(data):return hashlib.sha256(data).hexdigest()


def matrix(pose):
    t,s,q=pose[:3],pose[3:6],pose[6:];x,y,z,w=q
    if abs(np.dot(q,q)-1)>1e-3:raise ValueError('Diagnostic skinning requires unit source quaternions')
    rotation=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                       [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                       [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    result=np.eye(4);result[:3,:3]=rotation@np.diag(s);result[:3,3]=t
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    parser.add_argument('--native-skin-matrices',action='store_true',help='Render verified original inverse-bind matrices instead of diagnostic matrix composition')
    parser.add_argument('--wasm-animation-evaluation',action='store_true',help='Render actual original ANM/world/skin matrices evaluated in WASM')
    args=parser.parse_args();cache=args.cache.resolve();inputs={};tools=Path(__file__).resolve().parent
    if args.wasm_animation_evaluation and not args.native_skin_matrices:
        parser.error('--wasm-animation-evaluation requires --native-skin-matrices')
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    def proof(name,producer):
        result=json.loads(raw(cache/'research'/name))
        if result['sourceSha256']!=sha(raw(tools/producer)):raise ValueError('Evidence producer changed: '+producer)
        for path,expected in result['inputs'].items():
            if sha(raw(path))!=expected:raise ValueError('Evidence input changed: '+path)
        return result
    mesh=proof('character-mesh-indices-comparison.json','compare-character-mesh-indices.py')
    world=proof('resource-world-poses-comparison.json','compare-resource-world-poses.mjs')
    deviation=proof('animation-resource-pose-measurement.json','measure-animation-resource-poses.py')
    if world['mismatchCount'] or not mesh['vertexSourceBytesMatchGpuReadback'] or not mesh['materialLocalIndicesMatchGpuReadback']:
        raise ValueError('Matching native/WASM world poses and independently compared mesh required')
    native=json.loads(raw(cache/'research/animation-graph-preparation-dispatch-native.json'))
    mesh_native=json.loads(raw(cache/'research/character-mesh-cpu-index-native.json'))
    for report in [mesh_native,*native['cases']]:
        for name,expected in report['sources'].items():
            if sha(raw(tools/name))!=expected:raise ValueError('Native producer changed: '+name)
    if len(native['cases'])!=1:raise ValueError('One exact native actor control required')
    case=native['cases'][0];poses=case['animationPoses'];count=len(poses['joints'])
    if case['boundary'] or case['actor']!='champions/karthus/10' or native['build']!=mesh['build']:
        raise ValueError('Exact completed Karthus native mesh/animation build required')
    rig=raw(cache/'public/latest-scene/champions/karthus/10/model.skl')
    if (struct.unpack_from('<III',rig)!=(len(rig),0x22fd4fc3,0) or
            struct.unpack_from('<H',rig,14)[0]!=count):raise ValueError('Matching raw rig required')
    influence_count,joints_at,_,influences_at=struct.unpack_from('<Iiii',rig,16)
    if not 0<influence_count<=256 or influences_at<64 or influences_at+influence_count*2>len(rig):
        raise ValueError('Rig influences exceed bounds')
    influences=np.array(struct.unpack_from('<'+'h'*influence_count,rig,influences_at))
    if np.any(influences<0) or np.any(influences>=count):raise ValueError('Rig influence joint exceeds bounds')
    inverse=[];bind_world=[]
    for i,joint in enumerate(poses['joints']):
        at=joints_at+i*100
        if at+100>len(rig):raise ValueError('Raw rig joint exceeds bounds')
        local=np.array(struct.unpack_from('<10f',rig,at+16))
        if bytes.fromhex(joint['bindLocalHex'])!=rig[at+16:at+56]:raise ValueError('Loaded/raw bind transforms differ')
        parent=joint['parent']
        if not -1<=parent<i:raise ValueError('Diagnostic requires parent-ordered source joints')
        bind_world.append((bind_world[parent] if parent>=0 else np.eye(4))@matrix(local))
        inverse.append(matrix(np.array(struct.unpack_from('<10f',rig,at+56))))
    inverse=np.array(inverse)
    native_skin=None;native_palettes={};matrix_difference=None;skin_comparison=None
    if args.native_skin_matrices:
        skin_comparison=proof('animation-skin-matrices-wasm-comparison.json','compare-animation-skin-matrices.mjs')
        if skin_comparison['mismatchCount'] or skin_comparison['build']!=native['build']:
            raise ValueError('Matching original native/WASM skin matrices required')
        native_skin=json.loads(raw(cache/'research/animation-skin-matrices-native.json'))
        if (native_skin['boundary'] or native_skin['build']!=native['build'] or native_skin['actor']!=case['actor'] or
                native_skin['skinMatrices']['jointCount']!=count or native_skin['scope']['gpuSkinningExecuted']):
            raise ValueError('Complete matching original CPU skin-matrix evidence required')
        for name,expected in native_skin['sources'].items():
            if sha(raw(tools/name))!=expected:raise ValueError('Native skin-matrix producer changed: '+name)
        for path,expected in native_skin['inputs'].items():
            if sha(raw(path))!=expected:raise ValueError('Native skin-matrix input changed: '+path)
        if native_skin['skinMatrices']['inverseBindPosesHex']!=[rig[joints_at+i*100+56:joints_at+i*100+96].hex() for i in range(count)]:
            raise ValueError('Original loaded inverse binds differ from the raw skeleton')
        source_resources=poses['resources'];skin_resources=native_skin['skinMatrices']['resources']
        if len(source_resources)!=len(skin_resources):raise ValueError('Native skin-matrix resource count differs')
        matrix_difference=0.0
        for source_resource,skin_resource in zip(source_resources,skin_resources):
            if source_resource['key']!=skin_resource['key'] or len(source_resource['samples'])!=len(skin_resource['samples']):
                raise ValueError('Native skin-matrix sample/resource order differs')
            for index,(source_sample,skin_sample) in enumerate(zip(source_resource['samples'],skin_resource['samples'])):
                encoded=bytes.fromhex(skin_sample['matrices3x4Hex'])
                if source_sample['time']!=skin_sample['time'] or len(encoded)!=count*48:
                    raise ValueError('Native skin-matrix time or matrix count differs')
                palette=np.tile(np.eye(4),(count,1,1));palette[:,:3,:]=np.frombuffer(encoded,dtype='<f4').reshape(count,3,4)
                if not np.isfinite(palette).all():raise ValueError('Non-finite native skin matrix')
                world_values=np.frombuffer(bytes.fromhex(source_sample['worldPosesHex']),dtype='<f4').reshape(count,10)
                diagnostic=np.array([matrix(p) for p in world_values])@inverse
                matrix_difference=max(matrix_difference,float(np.max(np.abs(palette-diagnostic))))
                native_palettes[(source_resource['key'],index)]=palette
        if skin_comparison['counts']['samples']!=len(native_palettes):
            raise ValueError('Native/WASM skin-matrix sample coverage differs')
    wasm_comparison=None
    if args.wasm_animation_evaluation:
        wasm_comparison=proof('native-animation-evaluation-wasm-comparison.json','compare-native-animation-evaluation.mjs')
        if (wasm_comparison['boundary'] or wasm_comparison['mismatchCount'] or
                wasm_comparison['build']!=native['build'] or
                not wasm_comparison['scope']['browserCapableWasmEvaluationVerified'] or
                wasm_comparison['counts']['samples']!=len(native_palettes) or
                len(wasm_comparison['observations'])!=len(poses['resources'])):
            raise ValueError('Complete matching original ANM/world/skin WASM comparison required')
        for source_resource,wasm_resource in zip(poses['resources'],wasm_comparison['observations']):
            if (wasm_resource['keyHex']!=f"{source_resource['key']:016x}" or
                    len(source_resource['samples'])!=len(wasm_resource['samples'])):
                raise ValueError('WASM-render resource identity/order differs')
            for index,(source_sample,wasm_sample) in enumerate(zip(source_resource['samples'],wasm_resource['samples'])):
                encoded=bytes.fromhex(wasm_sample['skinMatrices3x4Hex'])
                if (wasm_sample['time']!=source_sample['time'] or len(encoded)!=count*48 or
                        any(wasm_sample[k] for k in ['localByteMismatches','worldByteMismatches','skinByteMismatches'])):
                    raise ValueError('WASM-render sample differs from original control')
                palette=np.tile(np.eye(4),(count,1,1));palette[:,:3,:]=np.frombuffer(encoded,dtype='<f4').reshape(count,3,4)
                if not np.array_equal(palette,native_palettes[(source_resource['key'],index)]):
                    raise ValueError('WASM-render matrices differ from the original CPU observation')
                native_palettes[(source_resource['key'],index)]=palette
    bind_error=float(np.max(np.abs(np.array(bind_world)@inverse-np.eye(4))))
    # Authored bind/inverse-bind transforms are distinct stored inputs, not a
    # promise of an exact matrix inverse. Preserve both and report their actual
    # residual; this diagnostic does not certify the game's skinning contract.
    bind_translation_error=float(np.max(np.abs((np.array(bind_world)@inverse-np.eye(4))[:,:3,3])))
    if not np.isfinite(bind_error):raise ValueError('Non-finite source bind/inverse-bind residual')
    source=bytes.fromhex(mesh_native['gpuMesh']['buffer']['bytesHex']);stride=56;vertices=mesh['counts']['vertices']
    if len(source)!=vertices*stride:raise ValueError('Exact compared vertex stride required')
    position=np.ndarray((vertices,3),dtype='<f4',buffer=source,strides=(stride,4)).astype(np.float64)
    blend=np.ndarray((vertices,4),dtype='u1',buffer=source,offset=12,strides=(stride,1)).copy()
    weights=np.ndarray((vertices,4),dtype='<f4',buffer=source,offset=16,strides=(stride,4)).astype(np.float64)
    if (np.any(blend>=influence_count) or not np.isfinite(weights).all() or np.any(weights<0) or
            np.max(np.abs(weights.sum(1)-1))>1e-4):raise ValueError('Diagnostic mesh influence weights/indices differ')
    vertex_joints=influences[blend];homogeneous=np.column_stack([position,np.ones(vertices)])
    local_indices=np.frombuffer(bytes.fromhex(mesh_native['indexBuffer']['bytesHex']),dtype='<u2')
    triangles=[];colors=[]
    for i,material in enumerate(mesh['materials']):
        indices=local_indices[material['startIndex']:material['startIndex']+material['indices']]
        triangles.append(indices.reshape(-1,3).astype(np.int64)+material['startVertex'])
        colors.extend([[.28,.77,.71] if i%2==0 else [.91,.65,.29]]*(len(indices)//3))
    triangles=np.concatenate(triangles);colors=np.array(colors)
    resources={p['key']:p for p in poses['resources']};names={}
    for measurement in deviation['measurements']:
        for name in measurement['clipNames']:names[name]=measurement['key']
    selected=['Attack1','Spell1_A','Death','Recall'];draws=[]
    fig,axes=plt.subplots(2,4,figsize=(16,10),facecolor='#101923')
    angle=np.pi/5;c,s=np.cos(angle),np.sin(angle);view=np.array([[c,0,s],[0,1,0],[-s,0,c]])
    light=np.array([.4,.6,.8]);light/=np.linalg.norm(light)
    for col,name in enumerate(selected):
        resource=resources[names[name]];samples=[resource['samples'][0],resource['samples'][2]];projected=[]
        for sample_index,sample in zip([0,2],samples):
            world_poses=np.frombuffer(bytes.fromhex(sample['worldPosesHex']),dtype='<f4').reshape(count,10)
            palette=native_palettes[(resource['key'],sample_index)] if args.native_skin_matrices else np.array([matrix(p) for p in world_poses])@inverse
            skin=palette[vertex_joints]
            skinned=(np.einsum('vkij,vj->vki',skin,homogeneous)*weights[:,:,None]).sum(1)[:,:3]
            if not np.isfinite(skinned).all():raise ValueError('Diagnostic skinning produced non-finite vertices')
            projected.append(skinned@view.T)
        combined=np.concatenate(projected);center=(combined.min(0)+combined.max(0))/2
        radius=max(np.ptp(combined[:,:2],axis=0))*.55
        if not radius>0:raise ValueError('Diagnostic animation has no finite extent')
        for row,(sample,points) in enumerate(zip(samples,projected)):
            faces=points[triangles];normals=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0])
            length=np.linalg.norm(normals,axis=1);normal=np.divide(normals,length[:,None],out=np.zeros_like(normals),where=length[:,None]>0)
            brightness=.25+.75*np.abs(normal@light);order=np.argsort(faces[:,:,2].mean(1))[::-1]
            axis=axes[row,col];axis.set_facecolor('#0b121c')
            axis.add_collection(PolyCollection(faces[order,:,:2],facecolors=(colors*brightness[:,None])[order],edgecolors='none'))
            axis.set_xlim(center[0]-radius,center[0]+radius);axis.set_ylim(center[1]-radius,center[1]+radius)
            axis.set_aspect('equal');axis.set_axis_off()
            axis.set_title(f"{name} | {resource['kind']}\nt = {sample['time']:.3f}s",color='#dce8f5',fontsize=12)
            draws.append({'clip':name,'resource':resource['key'],'time':sample['time'],
                          'nativeWorldPosesSha256':sha(bytes.fromhex(sample['worldPosesHex'])),
                          'diagnosticSkinnedPositionsSha256':sha(points.astype('<f8').tobytes())})
    title='Original ANM → WASM world + skin matrices → geometry' if args.wasm_animation_evaluation else 'Native animation → native inverse-bind matrices → geometry' if args.native_skin_matrices else 'Installed animation → native pose evaluation → character geometry'
    fig.suptitle(title,color='#e3edf7',fontsize=22,y=.97)
    counts=world['counts']
    fig.text(.5,.91,f"Karthus / skin 10 | Build {native['build']} | {len(resources)} loaded animation resources | Compressed + uncompressed",ha='center',color='#a5bad1',fontsize=12)
    fig.text(.5,.115,f"Native and WASM world-pose results: {counts['samples']} samples / {counts['comparedFloatLanes']:,} float lanes / zero bit mismatches",ha='center',color='#78d5c2',fontsize=12)
    fig.text(.5,.073,'Controlled animation samples. CPU skinning, colors, camera and lighting are diagnostic; League materials and particles are absent.',ha='center',color='#efc38b',fontsize=10)
    footer=f"Native/WASM skin matrices: {skin_comparison['counts']['comparedFloatLanes']:,} lanes, zero bit mismatches. Diagnostic math delta: {matrix_difference:.6g}." if args.native_skin_matrices else f'Authored bind/inverse matrix residual: {bind_error:.6f}.'
    if wasm_comparison:
        footer=f"Original ANM + world + skin in WASM: {wasm_comparison['counts']['comparedFloatLanes']:,} lanes, zero bit mismatches."
    fig.text(.5,.035,footer+' No recorded selection or blending. The main replay viewer is unchanged.',ha='center',color='#a5bad1',fontsize=10)
    fig.subplots_adjust(top=.85,bottom=.17,wspace=.04,hspace=.18)
    output=cache/'public/evidence'/('latest-native-animation-wasm.png' if args.wasm_animation_evaluation else 'latest-native-skin-matrices.png' if args.native_skin_matrices else 'latest-native-animation-resources.png');output.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(output,dpi=100,facecolor=fig.get_facecolor());plt.close(fig)
    for path in [matplotlib.__file__,np.__file__,cache/'research/LeagueToolkit/src/LeagueToolkit/Core/Animation/RigResource.cs']:raw(path)
    evidence={'schema':1,'kind':'native-animation-resource-mesh-diagnostic','build':native['build'],'inputs':inputs,
              'rendererSha256':sha(Path(__file__).read_bytes()),'imageSha256':sha(output.read_bytes()),
              'inverseBindRestPoseMaxComponentError':bind_error,
              'inverseBindRestPoseMaxTranslationError':bind_translation_error,'draws':draws,
              'diagnosticMatrixMaxComponentDifference':matrix_difference,
              'scope':{'originalAnmAndWorldEvaluation':True,'diagnosticCpuSkinning':True,'originalLeagueGpuSkinning':False,
                       'originalInverseBindMatrices':args.native_skin_matrices,
                       'originalAnmEvaluationInWasm':args.wasm_animation_evaluation,
                       'wasmPipelineMatricesRendered':args.wasm_animation_evaluation,
                       'skinningParityVerified':False,'originalLeagueMaterials':False,
                       'recordedAnimationSelection':False,'spellParticles':False,'mainViewerExpanded':False}}
    output.with_suffix('.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps({'image':str(output),'sha256':evidence['imageSha256'],'inverseBindError':bind_error}))


if __name__=='__main__':main()
