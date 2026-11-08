"""Observe native quad pool ordering when several adjacent particles expire."""
import argparse
import inspect
import json
from pathlib import Path
from vfx_point_quad_native import NativePointQuad
from vfx_spawn_native import ADDRESSES, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    n = NativePointQuad(args.cache / 'public/decoder-16.21-macos', args.client)
    emitter = {'__type': 'VfxEmitterDefinitionData', 'rate': {'constantValue': 4, '__type': 'ValueFloat'},
               'isSingleParticle': True, 'lifetime': 1,
               'particleLifetime': {'constantValue': 1, '__type': 'ValueFloat'},
               'birthScale0': {'constantValue': [1, 2, 1], '__type': 'ValueVector3'},
               'SpawnShape': {'__type': '{ee39916f}'},
               'primitive': {'__type': 'VfxPrimitiveArbitraryQuad'}, 'blendMode': 1}
    graph = n.prepare_point_quad(emitter)
    inp = {'time': 0, 'previous': [0, 0, 0], 'current': [4, 0, 0],
           'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'viewPosition': [0, 0, 1000]}
    cases = []
    for expired in [[0, 1], [1, 2], [0, 2], [0, 1, 3], [1]]:
        n.reset_quad(graph, 0x12345, 0)
        initial = n.frame_quad(inp)['state']['vectors']['initial']
        if initial['count'] != 4:
            raise ValueError('Native burst did not create four particles: ' + str(initial['count']))
        pool = n.q(ADDRESSES['actor'] + 0xa0)
        life = n.q(pool + 8)
        # Explicit owned control inputs: distinct birth clocks identify pool
        # slots, while selected lifetime lanes expire in the same update.
        birth_bits = []
        for index in range(4):
            n.put(life + index * 8, 'f', index / 1000)
            birth_bits.append(bytes(n.u.mem_read(life + index * 8, 4)))
        for index in expired:
            n.put(life + index * 8 + 4, 'f', .1)
        output = n.frame_quad({**inp, 'time': .2})['state']
        after = bytes.fromhex(output['vectors']['life']['hex'])
        survivors = [birth_bits.index(after[i:i + 4]) for i in range(0, len(after), 8)]
        cases.append({'expired': expired, 'survivors': survivors})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'build': n.profile['clientVersion'],
              'decoderImageSha256': n.profile['decoderImageSha256'], 'cases': cases,
              'emitter': emitter, 'seedHex': '0000000000012345',
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalEmitterUpdateAndPoolRemoval': True,
                        'suppliedLifetimeLanes': True, 'matchCoverage': False}}
    output = args.cache / 'research/direct-pool-deaths-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': cases}))


if __name__ == '__main__':
    main()
