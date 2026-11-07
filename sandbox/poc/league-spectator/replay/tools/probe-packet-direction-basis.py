"""Original packet-authored horizontal direction to source-object basis controls.

These are supplied direction vectors, not native entity-facing observations.
The complete constructor, direction setter and object matrix setter run.
"""
import argparse
import inspect
import json
import random
import struct
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    f = NativeAIUnitFixture(args.cache, args.client, NativeGameModeData)
    n = f.native
    orientation, direction, obj = n.allocate(0xc0), n.allocate(16), n.allocate(0x200)
    vectors = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
               [1, 0, 1], [1 / 3, 0, -1 / 7], [-0.0, 0, -0.0],
               [1e-7, 0, 0], [1e-5, 0, 0], [1e-4, 0, 0],
               [1e-5, 0, 1e-5], [1e-4, 0, 1e-4], [3, 0, -4]]
    rng = random.Random(825192)
    vectors += [[rng.uniform(-2, 2), 0, rng.uniform(-2, 2)] for _ in range(256)]
    replay = f.read(f.cache / 'research/viewer-root-reconstruction.json')
    if replay.get('runtimePlaybackInput') is not False:
        raise ValueError('Diagnostic input must not be a playback package')
    actual = [d['vector6c'] for d in replay['report']['effectDescriptors']
              if 69 <= d['time'] <= 99 and d['attachmentEntityId'] and not d['attachmentKey4c']
              and not d['lookup14EntityId'] and d['lookupA8EntityId'] in [0, d['attachmentEntityId']]
              and not d['flags'] & ~0xb0 and d['flags'] & 0x10]
    if len(actual) != 28:
        raise ValueError('Expected observed source-only matrix-skip direction fixture')
    vectors += actual
    cases = []
    for supplied in vectors:
        n.u.mem_write(orientation, b'\xa5' * 0xc0)
        n.call(0x209a90, {r.UC_X86_REG_RDI: orientation})
        n.put(direction, '3f', *supplied)
        n.call(0x209a20, {r.UC_X86_REG_RDI: orientation, r.UC_X86_REG_RSI: direction})
        n.call(0x209e40, {r.UC_X86_REG_RDI: orientation})
        if n.u.reg_read(r.UC_X86_REG_RAX) != orientation:
            raise ValueError('Original orientation matrix getter differs')
        n.call(0x1755d40, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: orientation})
        matrix = bytes(n.u.mem_read(obj + 0x120, 64))
        floats = struct.unpack('<16f', matrix)
        if floats[12:] != (0, 0, 0, 1):
            raise ValueError('Original object setter did not clear supplied translation')
        cases.append({'direction': list(struct.unpack('<3f', struct.pack('<3f', *supplied))),
                      'matrixHex': matrix.hex(), 'basis': [floats[i] for i in [0,1,2,4,5,6,8,9,10]]})
    ranges = [(0x2098b0, 0x209a00), (0x209a20, 0x209a9a), (0x209e40, 0x209f77),
              (0x148a750, 0x148a7ae), (0x1755d40, 0x1755d71), (0x83edfa, 0x83ee94)]
    sources = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
               *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-packet-horizontal-direction-basis-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'cases': cases, 'actualDirectionControls': len(actual),
              'inputs': f.inputs, 'sources': {str(p.resolve()): sha(p.read_bytes()) for p in sources},
              'sourceBlocks': [{'rva': a, 'size': b-a, 'sha256': sha(n.image[a:b])} for a,b in ranges],
              'constants': {hex(a): bytes(n.u.mem_read(n.base+a, s)).hex() for a,s in
                            [(0x256cb08,12),(0x20ca034,4),(0x20ca4d0,4),(0x20ca4a8,4)]},
              'scope': {'suppliedHorizontalPacketDirections': True, 'actualDescriptorVectorControls': True,
                        'originalDirectionAndObjectSetters': True, 'nativeEntityFacingRecovered': False,
                        'matchResourceBindingsEstablished': False, 'browserRendered': False}}
    out = f.cache / 'research/packet-direction-basis-native.json'
    out.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(out), 'cases': len(cases)}))


if __name__ == '__main__':
    main()
