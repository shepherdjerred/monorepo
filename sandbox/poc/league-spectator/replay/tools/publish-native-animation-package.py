"""Prepare a static browser asset package from verified original ANM inputs."""
import argparse
import json
from pathlib import Path
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('cache',type=Path);args=parser.parse_args()
    cache=args.cache.resolve();tools=Path(__file__).resolve().parent;inputs={}
    def raw(path):
        path=Path(path);data=path.read_bytes();inputs[str(path.resolve())]=sha(data);return data
    source=json.loads(raw(cache/'research/static-native-animation-evaluation.json'))
    binary=raw(cache/'research/static-native-animation-evaluation.bin')
    comparison=json.loads(raw(cache/'research/native-animation-evaluation-wasm-comparison.json'))
    headers=json.loads(raw(cache/'research/loaded-animations-comparison.json'))
    if (source['boundary'] or source['binarySha256']!=sha(binary) or comparison['boundary'] or
            comparison['mismatchCount'] or comparison['build']!=source['build'] or
            not comparison['scope']['browserCapableWasmEvaluationVerified'] or
            not source['scope']['staticAssetInputsOnly'] or source['scope']['containsReplayEvents'] or
            source['scope']['containsSampledAnimations'] or source['scope']['processSnapshot']):
        raise ValueError('Complete matching static original ANM inputs and WASM comparison required')
    if sha(raw(tools/'compare-native-animation-evaluation.mjs'))!=comparison['sourceSha256']:
        raise ValueError('Original ANM comparison producer changed')
    if sha(raw(tools/'compare-loaded-animations.py'))!=headers['sourceSha256'] or headers['build']!=source['build']:
        raise ValueError('Independent original ANM payload comparison changed')
    for report in [source,comparison,headers]:
        for path,expected in report['inputs'].items():
            if sha(raw(path))!=expected:raise ValueError('Original animation package input changed: '+path)
        for name,expected in report.get('sources',{}).items():
            if sha(raw(tools/name))!=expected:raise ValueError('Original animation package producer changed: '+name)
    by_key={f"{row['key']:016x}":row for row in headers['resources'] if row['actor']==source['actor']}
    if len(by_key)!=len(source['resources']):raise ValueError('Native ANM input/header resource sets differ')
    resources=[]
    for resource in source['resources']:
        header=by_key.get(resource['keyHex'])
        if (not header or not header['matched'] or header['kind']!=resource['kind'] or
                header['frames']!=resource['frames'] or header['fps']!=resource['fps']):
            raise ValueError('Native ANM input/header identity or timing differs')
        resources.append({**resource,'sourceSha256':header['sourceSha256']})
    metadata={'schema':1,'kind':'prepared-native-animation-resources','build':source['build'],
              'protocol':source['protocol'],'decoderImageSha256':source['decoderImageSha256'],
              'runtimeSha256':sha(raw(cache/'public/vendor/unicorn_x86_candidate.mjs')),
              'actor':source['actor'],'binarySha256':sha(binary),'binaryFile':'static.bin',
              'segments':source['segments'],'resources':resources,'rig':source['rig'],
              'poseTemplate':source['poseTemplate'],
              'functions':{'compressed':0x15b0b30,'uncompressed':0x15b53e0,'world':0x15852a0,'skin':0x1586f40,
                           'cacheInitializationBlock':[0x15889f8,0x1588a19],
                           'sentinelInitializationBlock':[0x15dcd0e,0x15dcd18]},
              'scope':{'staticAssetInputsOnly':True,'sampledAnimationFramesIncluded':False,
                       'replayEventsIncluded':False,'nativeConstructedBindPoseTemplate':True,
                       'originalAssetAddressesRetained':True,'isolatedAssetSetRequired':True}}
    output=cache/'public/latest-native-animation-resources';output.mkdir(parents=True,exist_ok=True)
    encoded=json.dumps(metadata,indent=2).encode('utf-8')
    (output/'static.bin').write_bytes(binary);(output/'manifest.json').write_bytes(encoded)
    proof={'schema':1,'kind':'prepared-native-animation-package-evidence','inputs':inputs,
           'sourceSha256':sha(Path(__file__).read_bytes()),'manifestSha256':sha(encoded),'binarySha256':sha(binary),
           'scope':{'staticAssetsOnly':True,'mainViewerExpanded':False}}
    (cache/'research/native-animation-package-evidence.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
    print(json.dumps({'manifestSha256':sha(encoded),'binaryBytes':len(binary),'resources':len(metadata['resources'])}))


if __name__=='__main__':main()
