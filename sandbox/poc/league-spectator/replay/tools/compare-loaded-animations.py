"""Compare loaded native animation timing with independently decoded WAD headers."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import xxhash
import zstandard


def sha(data):return hashlib.sha256(data).hexdigest()
def f32(value):return struct.unpack('<f',struct.pack('<f',value))[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    report=json.loads(raw(cache/'research/animation-graph-preparation-dispatch-native.json'))
    observations=[]
    for case in report['cases']:
        if case['boundary'] or not case['scope']['queuedReadsDispatched'] or not case.get('animationResources'):
            raise ValueError('Completed original animation dispatch and loaded-resource inspection required')
        for name,expected in case['sources'].items():
            if sha(raw(tools/name))!=expected:raise ValueError('Animation dispatch producer changed: '+name)
        for path,expected in case['inputs'].items():
            if sha(raw(path))!=expected:raise ValueError('Animation dispatch input changed: '+path)
        state=case['assetQueueState']
        if (any(row['queued'] or row['outstanding'] for row in state['buckets']) or
                any(state[key] for key in ['completionJobs','decodedCallbacks','pendingCallbacks'])):
            raise ValueError('Native animation queue retains unfinished work')
        resources=case['animationResources']['resources'];keys={row['key'] for row in resources};payloads={}
        for archive in case['setup']['archives']:
            data=raw(archive['path'])
            if sha(data)!=archive['fileSha256'] or data[:4]!=b'RW\x03\x04':raise ValueError('Installed animation archive changed')
            count=struct.unpack_from('<I',data,268)[0]
            if not 0<count<=262144 or 272+count*32>len(data):raise ValueError('Independent animation WAD table exceeds bounds')
            for i in range(count):
                at=272+i*32;key,offset,packed,size=struct.unpack_from('<QIII',data,at)
                if key not in keys:continue
                if key in payloads or data[at+20]&15!=3 or not 128<=size<=1048576 or offset>len(data)-packed:
                    raise ValueError('Independent ANM payload identity/compression/bounds differ')
                payload=zstandard.ZstdDecompressor().decompress(data[offset:offset+packed],max_output_size=size)
                if len(payload)!=size:raise ValueError('Independent ANM decoded size differs')
                payloads[key]=payload
        if set(payloads)!=keys:raise ValueError('Loaded animation identities do not match installed payloads')
        for resource in resources:
            data=payloads[resource['key']];magic=data[:8];version=struct.unpack_from('<I',data,8)[0]
            if magic==b'r3d2anmd' and version in [4,5]:
                frames=struct.unpack_from('<I',data,32)[0];tick=struct.unpack_from('<f',data,36)[0]
                if not math.isfinite(tick) or tick<=0:raise ValueError('Independent ANM tick duration is invalid')
                fps=f32(1/tick);kind='uncompressed'
            elif magic==b'r3d2canm' and version in [1,2,3]:
                duration,fps=struct.unpack_from('<ff',data,36)
                if not math.isfinite(duration) or duration<0 or not math.isfinite(fps) or fps<=0:
                    raise ValueError('Independent compressed ANM timing is invalid')
                # The getter rounds the f32 duration*FPS product to nearest,
                # ties-to-even (CVTSS2SI), then includes the terminal frame.
                frames=round(f32(duration*fps))+1;kind='compressed'
            else:raise ValueError('Independent loaded-animation comparison does not admit this ANM version')
            if (resource['kind']!=kind or resource['frames']!=frames or
                    struct.pack('<f',resource['fps'])!=struct.pack('<f',fps)):
                raise ValueError('Loaded original animation timing differs from installed raw header')
            observations.append({'actor':case['actor'],'key':resource['key'],'sourceSha256':sha(data),
                                 'kind':kind,'version':version,'frames':frames,'fps':fps,'matched':True})
    for module in [zstandard.backend_c,xxhash._xxhash]:raw(module.__file__)
    for name in ['UncompressedAnimationAsset.cs','CompressedAnimationAsset.cs']:
        raw(cache/'research/LeagueToolkit/src/LeagueToolkit/Core/Animation'/name)
    result={'schema':1,'kind':'loaded-native-animation-header-comparison','build':report['build'],
            'inputs':inputs,'sourceSha256':sha(Path(__file__).read_bytes()),'resources':observations,
            'counts':{'resources':len(observations),'uncompressed':sum(r['kind']=='uncompressed' for r in observations),
                      'compressed':sum(r['kind']=='compressed' for r in observations)},
            'scope':{'loadedTimingMetadataOnly':True,'allPoseBytesCompared':False,
                     'animationEventsCompared':False,'mainViewerExpanded':False}}
    output=cache/'research/loaded-animations-comparison.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
