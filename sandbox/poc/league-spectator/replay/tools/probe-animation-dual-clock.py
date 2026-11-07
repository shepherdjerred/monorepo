"""Original legacy ANM header/FPS/atomic-clock controls over actual new assets."""
import argparse
import json
from pathlib import Path
import struct
import sys
from animation_clock_native import NativeAnimationClock, f32
from vfx_spawn_native import sha

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();inputs[str(path)]=sha(data);return data
    clock=json.loads(raw(cache/'public/decoder-16.21-macos/animation-clock.json'))
    n=NativeAnimationClock(cache/'public/decoder-16.21-macos',args.client)
    if sha(raw(cache/'public/decoder-16.21-macos/animation-clock.json'))!=n.profile['animationClockSha256']:
        raise ValueError('Current original clock package required')
    cases=[]
    for graph,source in clock['graphs'].items():
        for name,reference in source['clips'].items():
            if f32(reference['exportedFps'])==reference['clock']['resourceFps']:continue
            data=raw(cache/'public/latest-scene'/reference['source']['file'])
            if sha(data)!=reference['source']['sha256'] or sha(data[:0x80])!=reference['source']['headerSha256']:
                raise ValueError('Actual raw legacy animation changed')
            if data[:8]!=b'r3d2anmd' or struct.unpack_from('<I',data,8)[0]!=3:
                raise ValueError('Separate proof required for another unequal-clock format')
            authored_fps=struct.unpack_from('<i',data,24)[0]
            observed=n.prepare_header(data)
            reciprocal=f32(1/f32(1/f32(authored_fps)))
            if observed['resourceFps']!=reciprocal or observed['resourceFps']!=reference['clock']['resourceFps'] or reference['exportedFps']!=authored_fps:
                raise ValueError('Original reciprocal legacy clock relationship differs')
            spec=reference['clock'];node={'mTickDuration':spec['tickDuration'],'startFrame':spec['startFrame'],'EndFrame':spec['endFrame']}
            elapsed={f32(-0.000001),-0.0,0.0}
            for frame in [1,2,spec['resourceFrames']-2]:
                boundary=f32(frame*spec['tickDuration'])
                elapsed.update(f32(boundary+offset) for offset in [-0.000001,0,0.000001])
            samples=[]
            for at in sorted(elapsed):
                for delta in [f32(-1/60),0.,f32(1/60)]:
                    result=n.sample(observed,node,at,delta)
                    pose_time=struct.unpack('<f',bytes.fromhex(result['poseTimeHex']))[0]
                    samples.append({'input':{'elapsed':at,'delta':delta,'rate':1},'native':result,
                                    'presentationSampleFrameHex':struct.pack('<f',f32(pose_time*f32(authored_fps))).hex()})
            cases.append({'graph':graph,'clip':name,'reference':reference,'authoredIntegerFps':authored_fps,
                          'native':observed,'samples':samples})
    if len(cases)!=4:raise ValueError('Expected the four actual unequal-clock clips')
    raw(args.client);raw(cache/'public/decoder-16.21-macos/profile.json');raw(cache/'public/decoder-16.21-macos/image.bin')
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    output=cache/'research/animation-dual-clock-native.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-legacy-anm-distinct-clock-controls','build':n.profile['clientVersion'],
      'protocol':n.profile['protocolDigest'],'inputs':inputs,'cases':cases,'blocks':list(n.blocks.values()),
      'scope':{'actualRawHeaders':True,'originalLegacyConversionFPSGetterAndAtomicClock':True,
               'toolkitFPSFromAuthoredIntegerHeader':True,'presentationGridMultiplicationIsExplicitPolicy':True,
               'nativePoseEvaluationParity':False,'browserExecuted':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'clips':len(cases),'samples':sum(len(c['samples']) for c in cases)}))
if __name__=='__main__':main()
