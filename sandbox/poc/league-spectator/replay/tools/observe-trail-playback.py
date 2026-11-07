"""Independently resimulate replay-bound trail samples through original code."""
import argparse
import inspect
import json
from pathlib import Path

from trail_particle_native import NativeTrailParticles
from vfx_control_native import NativeVfxControl
from vfx_spawn_native import sha


class ControlledTrail(NativeTrailParticles, NativeVfxControl):
    pass


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    directory, decoder = cache/'public/latest-trail-particles', cache/'public/decoder-16.21-macos'
    raw = (cache/'research/trail-playback.json').read_bytes()
    playback = json.loads(raw)
    root = Path(__file__).parent.parent
    for name, digest in playback['sources'].items():
        if sha((root/name).read_bytes()) != digest:
            raise ValueError('Trail playback source changed: '+name)
    package_raw = (directory/'package.json').read_bytes()
    if sha(package_raw) != playback['packageSha256']:
        raise ValueError('Trail playback package changed')
    n = ControlledTrail(decoder, args.client)
    counts = {'samples':0,'frames':0,'geometryChecks':0,'emptyChecks':0,'suspensionTransitions':0}
    for sample in playback['observations']:
        ref = sample['ref']
        graph_raw = (directory/ref['file']).read_bytes()
        if sha(graph_raw) != ref['sha256']:
            raise ValueError('Replay trail graph changed')
        graph = json.loads(graph_raw)
        n.reset_bound(graph,0,0,json.loads(package_raw))
        suspended = None
        for step in sample['history']:
            if suspended != step['suspended']:
                n.suspend(step['suspended'])
                suspended = step['suspended']
                counts['suspensionTransitions'] += 1
            output = n.frame_bound(step['input'])
            counts['frames'] += 1
        count = output['state']['vectors']['life']['count']
        if sample['actual'] is None:
            if count != 0:
                raise ValueError('Replay trail compositor dropped a live pool')
            counts['emptyChecks'] += 1
        else:
            if count != sample['actual']['particleCount'] or output['geometry'] != sample['actual']['geometry']:
                raise ValueError(f"Replay trail geometry differs at sequence={sample['trace']['sequence']} emitter={ref['emitterIndex']} age={sample['age']}")
            counts['geometryChecks'] += 1
        counts['samples'] += 1
    sources = {Path(inspect.getfile(c)) for c in ControlledTrail.__mro__ if c is not object}
    sources.add(Path(__file__))
    result = {'schema':1,'kind':'replay-trail-native-comparison',
        'playbackSha256':sha(raw),'packageSha256':sha(package_raw),
        'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
        'originalBlocks':list(n.blocks.values()),'counts':counts,'mismatches':0,
        'scope':{**playback['scope'],'nativeCompared':True,
            'nativeOriginalControlAndPoolAndWriter':True,'referenceCompared':False}}
    (cache/'research/trail-playback-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(counts))


if __name__ == '__main__':
    main()
