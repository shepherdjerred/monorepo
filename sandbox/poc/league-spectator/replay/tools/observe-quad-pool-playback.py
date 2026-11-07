"""Independently resimulate replay-bound complete quad pools and vertex writers."""
import argparse
import inspect
import json
from pathlib import Path
from vfx_control_native import NativeVfxControl
from vfx_spawn_native import sha


class ControlledQuad(NativeVfxControl):pass


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    args=p.parse_args();cache=args.cache.resolve();directory=cache/'public/decoder-16.21-macos'
    raw=(cache/'research/quad-pool-playback.json').read_bytes();playback=json.loads(raw)
    for name,digest in playback['sources'].items():
        if sha((Path(__file__).parent.parent/name).read_bytes())!=digest:raise ValueError('Quad playback source changed')
    package_raw=(directory/'vfx-bound-quads.json').read_bytes();package=json.loads(package_raw)
    if sha(package_raw)!=playback['packageSha256']:raise ValueError('Quad playback package changed')
    n=ControlledQuad(directory,args.client);counts={'samples':0,'frames':0,'geometryChecks':0,'emptyChecks':0}
    for sample in playback['observations']:
        ref=sample['ref'];graph_raw=(directory/ref['file']).read_bytes()
        if sha(graph_raw)!=ref['sha256']:raise ValueError('Replay quad graph changed')
        n.reset_bound(json.loads(graph_raw),0,0,package);suspended=None
        for step in sample['history']:
            if suspended!=step['suspended']:n.suspend(step['suspended']);suspended=step['suspended']
            output=n.frame_bound(step['input']);counts['frames']+=1
        count=output['state']['vectors']['life']['count'];actual=sample['actual']
        if actual is None:
            if count:raise ValueError('Replay quad compositor dropped a live pool')
            counts['emptyChecks']+=1
        else:
            if count!=actual['particleCount'] or output['geometry']!=actual['geometry']:
                raise ValueError(f"Quad pool geometry differs at {ref['emitterIndex']} / {sample['age']}")
            counts['geometryChecks']+=1
        counts['samples']+=1
    sources={Path(inspect.getfile(c)) for c in ControlledQuad.__mro__ if c is not object}|{Path(__file__)}
    result={'schema':1,'kind':'replay-quad-pool-native-comparison','playbackSha256':sha(raw),
        'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},'originalBlocks':list(n.blocks.values()),
        'counts':counts,'mismatches':0,'scope':{**playback['scope'],'nativeCompared':True}}
    (cache/'research/quad-pool-playback-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(counts))


if __name__=='__main__':main()
