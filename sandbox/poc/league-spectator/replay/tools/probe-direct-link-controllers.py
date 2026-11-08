"""Original constructor and empty authored material-override link producer.

Execute the owned link constructor and actual source-vector caller/builder.
Nonempty resource acceptance and whole resource postload stay unimplemented.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_asset_native import NativeVfxAssets, ROOT_TYPE
from vfx_spawn_native import ADDRESSES as A, sha, name_hash


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache, inputs = args.cache.resolve(), {}
    def raw(path):
        value = path.read_bytes(); inputs[str(path.resolve())] = sha(value); return value
    def read(path):
        return json.loads(raw(path))
    decoder = cache / 'public/decoder-16.21-macos'
    sources = {str(Path(__file__).resolve()): sha(Path(__file__).read_bytes())}
    for cls in [*NativeVfxRetirement.__mro__, *NativeVfxAssets.__mro__]:
        if cls is not object:
            path = Path(inspect.getfile(cls)); sources[str(path.resolve())] = sha(path.read_bytes())
    for name in ['profile.json', 'image.bin', 'vfx-assets.json', 'vfx-bound-quads.json', 'vfx-system.json']:
        raw(decoder / name)
    n = NativeVfxRetirement(decoder, args.client)
    loader = NativeVfxAssets(decoder, args.client)
    prop = [q for q in loader.type_catalog[f'{ROOT_TYPE:08x}']['properties'] if q['hash'] == name_hash('materialOverrideDefinitions')]
    if len(prop) != 1 or prop[0]['offset'] != 0x20 or prop[0]['type'] != 128 or prop[0]['mask']:
        raise ValueError('Original material override property changed')
    bound = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    system = n.checked_json('vfx-system.json', 'vfxSystemSha256')
    previous = read(cache / 'research/vfx-retirement-native.json')
    graph_ref = previous['cases'][0]['ref']
    graph_raw = raw(decoder / graph_ref['file'])
    if sha(graph_raw) != graph_ref['sha256']:
        raise ValueError('Exact owned graph required')
    controls = []
    for name, fields in [('absent', []), ('typed-empty', [struct.pack('<IBBII', name_hash('materialOverrideDefinitions'), 128, 131, 4, 0)])]:
        state = loader.load(fields)
        if state['ignored'] or state['mismatched']:
            raise ValueError('Original empty override field rejected')
        obj = bytes.fromhex(state['objectHex'])
        if obj[0x20:0x30] != bytes(16):
            raise ValueError('Original empty override constructor differs')
        n.reset_parent(json.loads(graph_raw), 1, 0, bound, system)
        # Preserve all unrelated complete authored graph fields. Only this
        # control's original serialized property-reader result is supplied.
        n.u.mem_write(A['definition'] + 0x20, obj[0x20:0x30])
        n.fragment(0x16e96ed, 0x16e9779, {r.UC_X86_REG_RAX: A['definition'],
            r.UC_X86_REG_R14: A['link'], r.UC_X86_REG_RBX: A['resource']})
        before = bytes(n.u.mem_read(A['link'] + 0x78, 16))
        pointer = n.allocate(8); n.put(pointer, 'Q', A['definition'])
        n.fragment(0x16e9779, 0x16e9794, {r.UC_X86_REG_R12: pointer,
            r.UC_X86_REG_RBX: A['resource'], r.UC_X86_REG_R14: A['link']})
        after = bytes(n.u.mem_read(A['link'] + 0x78, 16))
        if before != bytes(16) or after != before:
            raise ValueError('Original empty vector builder changed controller count')
        controls.append({'source': name, 'typedReaderConsumedAll': True,
            'sourceVectorHex': obj[0x20:0x30].hex(), 'initialLinkVectorHex': before.hex(),
            'afterLinkVectorHex': after.hex(), 'count': struct.unpack_from('<I', after, 8)[0]})
    single_clocks = []
    maximum = struct.unpack('<f', bytes.fromhex('ffff7f7f'))[0]
    owned_entry = n.allocate(0x58)
    for lifetime in [-1, 0, .5, 10.5, 10.500000953674316, maximum]:
        for particle_max in [-1, .5, maximum]:
            for single in [False, True]:
                for count in [0, 1]:
                    n.put(A['definition'] + 0x20, 'QII', owned_entry if count else 0, count, count)
                    n.put(A['definition'] + 0xf8, 'f', particle_max)
                    n.put(A['definition'] + 0x100, 'Q', 0)
                    n.put(A['definition'] + 0x108, 'f', lifetime)
                    n.put(A['definition'] + 0x2d2, 'B', int(single) << 4)
                    n.fragment(0x16e17e6, 0x16e1860, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link']})
                    single_clocks.append({'lifetime': lifetime, 'particleLifetimeMaximum': particle_max,
                        'isSingleParticle': single, 'materialOverrideCount': count,
                        'effectiveLifetime': struct.unpack('<f', n.u.mem_read(A['definition'] + 0x108, 4))[0]})
    ranges = [(0x16e96ed, 0x16e9794), (0x16e99f0, 0x16e9c04),
              (0x17584c4, 0x175853d), (0x16e17e6, 0x16e1860)]
    blocks = []
    for a, z in ranges:
        if n.image[a:z] != n.source.image[a:z]:
            raise ValueError('Original link-controller instructions changed')
        blocks.append({'rva': a, 'size': z - a, 'sha256': sha(n.image[a:z])})
    for path, expected in {**inputs, **sources}.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError('Final link proof provenance drift: ' + path)
    output = cache / 'research/direct-link-controllers-native.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'native-empty-material-override-link-controls',
        'build': bound['build'], 'protocol': bound['protocol'], 'inputs': inputs, 'sources': sources,
        'originalBlocks': blocks, 'registration': prop[0], 'controls': controls, 'singleClocks': single_clocks,
        'scope': {'originalLinkConstructorExecuted': True, 'originalSourceVectorCallerExecuted': True,
            'originalVectorBuilderExecuted': True, 'nonemptyMaterialOverrideAcceptance': False,
            'fullResourcePostloadExecuted': False, 'singleParticleLifetimeOptimizationTranslated': False,
            'nativeWorldAcceptance': False, 'browserAcceptance': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'counts': [v['count'] for v in controls], 'singleClocks': len(single_clocks)}))


if __name__ == '__main__':
    main()
