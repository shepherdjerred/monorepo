"""Observe complete CameraTrail assets and replay-derived projectile paths."""
import argparse
import json
import struct
from pathlib import Path

from trail_particle_native import NativeTrailParticles
from vfx_spawn_native import sha, ADDRESSES as A

IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    decoder, directory = cache/'public/decoder-16.21-macos', cache/'public/latest-trail-particles'
    package_raw = (directory/'package.json').read_bytes()
    meta = json.loads(package_raw)
    for name, h in meta['compilerSources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != h:
            raise ValueError('Trail compiler changed: '+name)
    cases, blocks = [], {}
    counts = {'graphs': 0, 'frames': 0, 'births': 0, 'vertices': 0, 'indices': 0,
        'assetPreservationChecks': 0}
    # Supplied display cadence, with an explicit repeated-time probe. Large
    # jumps create hundreds of high-rate trail points in one native call and
    # exceed the existing five-million-instruction bound. Keep the bound and
    # execute the intervening frames rather than discarding births.
    times = [0, 0, *[i/60 for i in range(1, 31)]]
    for index, ref in enumerate(meta['templates']):
        if index % 40 == 0:
            n = NativeTrailParticles(decoder, args.client)
        raw = (directory/ref['file']).read_bytes()
        if sha(raw) != ref['sha256']:
            raise ValueError('Trail graph changed')
        graph = json.loads(raw)
        modes = [(0,1,0)]
        if ref['effectId'] == 'champions/vladimir/39/9fbafd14':
            modes += [(1,987654321,0),(2,0xffffffffffffffff,3)]
        for mode, seed, quality in modes:
            n.reset_bound(graph, seed, quality, meta)
            frames, previous = [], [0,250,0]
            for tick, time in enumerate(times):
                current = [time*130,250+time*3,time*70]
                basis = IDENTITY if mode != 2 else [0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]
                inp = {'time':time,'previous':previous,'current':current,'basis':basis,
                    'viewPosition':[0,2000,1000], 'cameraRight':[1,0,0],
                    'cameraUp':[0,0,1], 'viewAxis':[0,1,0],
                    'multTexturePresent':graph['hasMultDefinition']}
                try:
                    output = n.frame_bound(inp)
                except Exception as error:
                    raise ValueError(f"Trail {ref['effectId']}:{ref['emitterIndex']} mode {mode} t={time}: {error}") from error
                if (bytes(n.u.mem_read(A['definition'],0x470)).hex() != graph['assetObjectHex'] or
                    bytes(n.u.mem_read(graph['assetHeapStart'],graph['assetHeapBytes'])).hex() != graph['segments'][1]['bytesHex']):
                    raise ValueError('Trail update mutated the complete authored asset')
                frames.append({'input':inp,'output':output,'libraryInputs':list(n.library_inputs)})
                counts['frames'] += 1
                counts['births'] += len(output['state']['births'])
                counts['vertices'] += len(output['geometry']['verticesHex'])//56
                counts['indices'] += len(output['geometry']['indicesHex'])//4
                counts['assetPreservationChecks'] += 1
                previous = current
            cases.append({'graphSha256':ref['sha256'],'effectId':ref['effectId'],
                'emitterIndex':ref['emitterIndex'],'seedHex':f'{seed:016x}',
                'quality':quality,'mode':mode,'frames':frames})
        counts['graphs'] += 1
        blocks.update(n.blocks)
        if (index+1)%20 == 0:
            print(json.dumps(counts), flush=True)
    result = {'schema':1,'kind':'native-complete-trail-observations',
        'packageSha256':sha(package_raw),'observerSha256':sha(Path(__file__).read_bytes()),
        'compilerSources':meta['compilerSources'],'originalBlocks':list(blocks.values()),
        'cases':cases,'counts':counts,'scope':meta['scope']}
    (cache/'research/trail-particles-native.json').write_text(
        json.dumps(result,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print(json.dumps(counts), flush=True)


if __name__ == '__main__':
    main()
