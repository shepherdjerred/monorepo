"""Compare native graph track binding with independently prepared BIN fields."""
import argparse
import hashlib
import json
from pathlib import Path


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    report=json.loads(raw(cache/'research/animation-graph-preparation-native.json'))
    image=raw(cache/'public/decoder-16.21-macos/image.bin')
    if sha(image)!=report['decoderImageSha256']:raise ValueError('Exact native animation image required')
    # Original TrackData constructor initializes priority/blend bytes to zero.
    # Missing authored fields use those verified constructor defaults.
    if image[0x15d2764:0x15d2769]!=bytes.fromhex('66c7070000'):
        raise ValueError('Original TrackData priority/blend default bytes differ')
    observations=[]
    for case in report['cases']:
        if case['boundary'] or not case['scope']['allSuppliedGraphsPrepared']:
            raise ValueError('All supplied graph preparations must complete')
        for name,expected in case['sources'].items():
            if sha(raw(tools/name))!=expected:raise ValueError('Animation preparation producer changed: '+name)
        for path,expected in case['inputs'].items():
            if sha(raw(path))!=expected:raise ValueError('Animation preparation input changed: '+path)
        for graph in case['graphs']:
            source=graph['source'];binary=raw(source['source']);encoded=raw(source['output'])
            if sha(binary)!=source['sha256'] or sha(encoded)!=source['jsonSha256']:
                raise ValueError('Prepared animation BIN/reference fields changed')
            data=json.loads(encoded);root=data['{'+format(graph['identity'],'08x')+'}']
            if root['__type']!='AnimationGraphData':raise ValueError('Matching authored animation graph required')
            authored={int(key[1:-1],16):value for key,value in root['mTrackDataMap'].items()}
            if any(value['__type']!='TrackData' for value in authored.values()):
                raise ValueError('Independent authored track map contains another type')
            priorities=[value.get('mPriority',0) for value in authored.values()]
            if len(set(priorities))!=len(priorities):
                raise ValueError('This independent priority-order control requires distinct authored priorities')
            order=sorted(authored,key=lambda key:authored[key].get('mPriority',0))
            expected_indices={key:index for index,key in enumerate(order)}
            prepared=graph['preparation'];before=prepared['tracksBefore'];after=prepared['tracksAfter']
            if (not prepared['completed'] or {row['key'] for row in after}!=set(authored) or
                    any(row['index']!=0xffffffff for row in before)):
                raise ValueError('Original graph did not progress from its unassigned authored tracks')
            for row in after:
                fields=authored[row['key']]
                if (row['priority']!=fields.get('mPriority',0) or row['blendMode']!=fields.get('mBlendMode',0) or
                        row['index']!=expected_indices[row['key']] or row['runtimeKey']!=row['key']):
                    raise ValueError('Original graph track identity/priority/index differs from authored fields')
            observations.append({'actor':case['actor'],'identity':graph['identity'],'tracks':after,
                                 'authoredPriorityOrder':order,'matched':True})
    result={'schema':1,'kind':'animation-graph-preparation-comparison','build':report['build'],
            'inputs':inputs,'sourceSha256':sha(Path(__file__).read_bytes()),'graphs':observations,
            'counts':{'graphs':len(observations),'tracks':sum(len(g['tracks']) for g in observations)},
            'scope':{'trackBindingMetadataOnly':True,'allClipSemanticsCompared':False,
                     'animationPayloadsLoaded':False,'animatedPoseVerified':False,'mainViewerExpanded':False}}
    output=cache/'research/animation-graph-preparation-comparison.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
