"""Measure native loaded-resource poses against pinned Toolkit keyframes."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct


def sha(data):return hashlib.sha256(data).hexdigest()
def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    report=json.loads(raw(cache/'research/animation-graph-preparation-dispatch-native.json'))
    loaded=json.loads(raw(cache/'research/loaded-animations-comparison.json'))
    if loaded['sourceSha256']!=sha(raw(tools/'compare-loaded-animations.py')):
        raise ValueError('Current installed animation-header comparison required')
    for path,expected in loaded['inputs'].items():
        if sha(raw(path))!=expected:raise ValueError('Loaded animation comparison input changed: '+path)
    profile=json.loads(raw(cache/'public/decoder-16.21-macos/profile.json'))
    package=raw(cache/'public/latest-animation-poses/manifest.json');reference=json.loads(package)
    if (sha(package)!=profile['animationPosesSha256'] or reference['build']!=report['build'] or
            reference['build']!=profile['clientVersion']):raise ValueError('Matching pinned Toolkit pose package required')
    for name,expected in reference['toolchain']['sources'].items():
        if sha(raw(tools/name))!=expected:raise ValueError('Pinned Toolkit exporter source changed: '+name)
    assembly=cache/'research/animation-exporter-build/bin/Debug/net10.0/AnimationExporter.dll'
    if sha(raw(assembly))!=reference['toolchain']['assemblySha256']:
        raise ValueError('Pinned Toolkit exporter assembly changed')
    measurements=[];total_samples=0;total_joints=0
    for case in report['cases']:
        if case['boundary'] or not case.get('animationPoses'):raise ValueError('Completed original pose samples required')
        for name,expected in case['sources'].items():
            if sha(raw(tools/name))!=expected:raise ValueError('Native pose producer changed: '+name)
        poses=case['animationPoses'];graphs=[g for g in reference['graphs'].values() if g['actor']==case['actor']]
        if len(graphs)!=1:raise ValueError('One pinned reference graph per supplied pose actor required')
        graph=graphs[0];names=[joint['name'] for joint in poses['joints']]
        if names!=graph['catalog']['joints']:raise ValueError('Native pose rig names/order differ from reference')
        rig=raw(cache/'public/latest-scene'/graph['rigFile'])
        if sha(rig)!=graph['rigSha256'] or struct.unpack_from('<III',rig)!=(len(rig),0x22fd4fc3,0):
            raise ValueError('Pinned reference skeleton differs')
        count=struct.unpack_from('<H',rig,14)[0];offset=struct.unpack_from('<i',rig,20)[0]
        if count!=len(names) or not 0<offset<=len(rig)-count*100:raise ValueError('Reference skeleton joint bounds differ')
        binds=[];bind_error=0
        for i,joint in enumerate(poses['joints']):
            at=offset+i*100;identity,parent=struct.unpack_from('<hh',rig,at+2)
            name_at=at+96+struct.unpack_from('<i',rig,at+96)[0]
            end=rig.find(b'\0',name_at,min(name_at+1024,len(rig)))
            if (identity!=i or parent!=joint['parent'] or end<name_at or
                    rig[name_at:end].decode('utf-8')!=joint['name']):raise ValueError('Reference/native rig joint identity differs')
            bind=struct.unpack_from('<10f',rig,at+16);binds.append(bind)
            native_bind=struct.unpack('<10f',bytes.fromhex(joint['bindLocalHex']))
            bind_error=max(bind_error,max(abs(a-b) for a,b in zip(bind,native_bind)))
        installed={r['key']:r for r in loaded['resources'] if r['actor']==case['actor']}
        for resource in poses['resources']:
            source=installed[resource['key']]
            if source['kind']!=resource['kind']:raise ValueError('Native pose and installed animation class differ')
            clips=[(name,c) for name,c in graph['catalog']['clips'].items() if c['sourceSha256']==source['sourceSha256']]
            if not clips or len({c['sha256'] for _,c in clips})!=1:
                raise ValueError('Unique pinned pose payload for the installed ANM required')
            clip=clips[0][1];data=raw(cache/'public/latest-animation-poses'/graph['directory']/clip['file'])
            if sha(data)!=clip['sha256']:raise ValueError('Pinned Toolkit keyframe payload changed')
            size=struct.unpack_from('<I',data)[0]
            if not 2<=size<=len(data)-4:raise ValueError('Reference pose payload header exceeds bounds')
            header=json.loads(data[4:4+size]);body=data[4+size:]
            if (header['frames']!=resource['frames'] or
                    struct.pack('<f',header['fps'])!=struct.pack('<f',resource['fps'])):
                raise ValueError('Reference/native loaded animation time domain differs')
            tracks={}
            for track in header['tracks']:
                key=(track['jointId'],track['channel'])
                if (key in tracks or not 0<=track['jointId']<count or track['bone']!=names[track['jointId']] or
                        track['count'] not in [1,header['frames']] or
                        track['offset']+track['count']*track['width']*4>len(body)):
                    raise ValueError('Reference pose track identity/data bounds differ')
                values=struct.unpack_from('<'+'f'*(track['count']*track['width']),body,track['offset'])
                tracks[key]=(track,values)
            for joint,index in enumerate(resource['trackIndices']):
                present=[(joint,ch) in tracks for ch in ['position','scale','quaternion']]
                if (index>=0 and not all(present)) or (index<0 and any(present)):
                    raise ValueError('Native rig-to-animation presence mapping differs from reference')
            metrics={'maxTranslationComponentError':0,'maxScaleComponentError':0,'maxRotationAngleRadians':0,
                     'maxBindComponentError':bind_error}
            sample_measurements=[]
            for sample in resource['samples']:
                duration=f32(1/f32(header['fps']));frame=min(header['frames']-1,int(f32(sample['time']/duration)))
                next_frame=min(header['frames']-1,frame+1);start=f32(frame*duration)
                interval=f32(f32(next_frame*duration)-start)
                fraction=f32(f32(sample['time']-start)/interval) if interval else 0
                sample_metrics={key:0 for key in metrics if key!='maxBindComponentError'}
                native=struct.unpack('<'+'f'*(count*10),bytes.fromhex(sample['localPosesHex']))
                for joint in range(count):
                    expected=list(binds[joint])
                    for channel,first,width in [('position',0,3),('scale',3,3),('quaternion',6,4)]:
                        pair=tracks.get((joint,channel))
                        if pair is None:continue
                        track,values=pair
                        if track['width']!=width:raise ValueError('Reference channel width differs')
                        a=frame if track['count']>1 else 0;b=next_frame if track['count']>1 else 0
                        left=values[a*width:(a+1)*width];right=values[b*width:(b+1)*width]
                        if fraction==0 or a==b:value=left
                        else:
                            sign=-1 if channel=='quaternion' and sum(x*y for x,y in zip(left,right))<0 else 1
                            value=[f32((1-fraction)*x+fraction*sign*y) for x,y in zip(left,right)]
                            if channel=='quaternion':
                                norm=math.sqrt(sum(x*x for x in value));value=[x/norm for x in value]
                        expected[first:first+width]=value
                    actual=native[joint*10:(joint+1)*10]
                    sample_metrics['maxTranslationComponentError']=max(sample_metrics['maxTranslationComponentError'],max(abs(a-b) for a,b in zip(actual[:3],expected[:3])))
                    sample_metrics['maxScaleComponentError']=max(sample_metrics['maxScaleComponentError'],max(abs(a-b) for a,b in zip(actual[3:6],expected[3:6])))
                    qa,qb=actual[6:],expected[6:];norm=math.sqrt(sum(x*x for x in qa)*sum(x*x for x in qb))
                    if norm<=0:raise ValueError('Reference/native quaternion has zero length')
                    angle=2*math.acos(min(1,abs(sum(a*b for a,b in zip(qa,qb)))/norm))
                    sample_metrics['maxRotationAngleRadians']=max(sample_metrics['maxRotationAngleRadians'],angle)
                for key,value in sample_metrics.items():metrics[key]=max(metrics[key],value)
                sample_measurements.append({'time':sample['time'],'referenceFrame':frame,
                    'referenceNextFrame':next_frame,'referenceInterpolationFraction':fraction,
                    'exactReferenceKeyframe':fraction==0 or frame==next_frame,**sample_metrics})
                total_samples+=1;total_joints+=count
            measurements.append({'actor':case['actor'],'key':resource['key'],'kind':resource['kind'],
                                 'clipNames':[name for name,_ in clips],
                                 'samples':len(resource['samples']),'sampleMeasurements':sample_measurements,**metrics})
    maxima={key:max(row[key] for row in measurements) for key in measurements[0] if key.startswith('max')}
    result={'schema':1,'kind':'native-animation-pose-deviation-measurement','build':report['build'],
            'inputs':inputs,'sourceSha256':sha(Path(__file__).read_bytes()),'measurements':measurements,
            'counts':{'resources':len(measurements),'samples':total_samples,'jointSamples':total_joints},'maxima':maxima,
            'bySampleDomain':[
                {'kind':kind,'exactReferenceKeyframe':exact,'samples':len(samples),
                 **{key:max(sample[key] for sample in samples) for key in
                    ['maxTranslationComponentError','maxScaleComponentError','maxRotationAngleRadians']}}
                for kind in ['uncompressed','compressed'] for exact in [True,False]
                if (samples:=[sample for row in measurements if row['kind']==kind
                              for sample in row['sampleMeasurements'] if sample['exactReferenceKeyframe']==exact])],
            'referenceInterpolation':'Linear vectors and shortest normalized-linear quaternion interpolation over pinned Toolkit keyframes',
            'scope':{'deviationMeasurementOnly':True,'exactPoseParityVerified':False,
                     'compressedPoseEvaluationCompared':any(row['kind']=='compressed' for row in measurements),
                     'animationGraphBlendingCompared':False,'mainViewerExpanded':False}}
    output=cache/'research/animation-resource-pose-measurement.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts'],'maxima':maxima}))


if __name__=='__main__':main()
