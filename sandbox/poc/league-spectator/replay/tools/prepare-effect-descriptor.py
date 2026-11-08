"""Original creation-descriptor prefix with explicit unresolved entity inputs.

The native prefix decodes packet fields and never calls resource lookup or the
factory. Live entity pointers are zero inputs; auxiliary context IDs are retained
as unresolved IDs, not looked up in a synthetic world registry.
"""
import argparse
import collections
import json
from pathlib import Path
import struct
from unicorn import x86_const as r

from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import sha

ENTRY, GROUP, FRAME, GRID = 0x100f1000, 0x100f2000, 0x100f5000, 0x100f6000
PREFIX = (0x84f530, 0x8501af)
POSITIONS = (0x84f033, 0x84f4f8)
SCALARS = {name: offset for name, offset in [
    ('scalar78', 0x78), ('scalar7c', 0x7c), ('scalarA0', 0xa0)]}
WORDS = {name: offset for name, offset in [
    ('resourceKey', 8), ('flags', 0x48), ('attachmentKey4c', 0x4c), ('attachmentKey50', 0x50),
    ('field80', 0x80), ('field84', 0x84), ('field88', 0x88), ('field8c', 0x8c), ('field90', 0x90), ('field94', 0x94)]}
BYTES = {'field98': 0x98, 'field99': 0x99}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']: parser.add_argument(name, type=Path)
    args = parser.parse_args()
    decoder = args.cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    inputs = {}
    def read(path):
        raw = path.read_bytes(); inputs[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    scene_path = args.cache / 'public/latest-scene/manifest.json'
    scene = read(scene_path)
    creation_path = args.cache / 'public/latest-effect-creation/package.json'
    placement_path = args.cache / 'public/latest-effect-placement/package.json'
    creation, placement = read(creation_path), read(placement_path)
    objects = read(args.cache / 'research/effect-creation-objects-native.json')
    requests = read(args.cache / 'research/effect-creation-native.json')
    vectors = read(args.cache / 'research/effect-placement-native.json')
    if (scene['build'] != n.profile['clientVersion'] or scene['protocol'] != n.profile['protocolDigest'] or
            placement['sceneManifestSha256'] != inputs[str(scene_path.resolve())] or
            vectors['packageSha256'] != inputs[str(placement_path.resolve())] or
            requests['packageSha256'] != inputs[str(creation_path.resolve())] or
            creation['decoderImageSha256'] != n.profile['decoderImageSha256']):
        raise ValueError('Descriptor preparation provenance differs')
    n.u.mem_write(GRID, bytes(0x100))
    for offset, axis, bound in [(0xbc, 0, 'min'), (0xc4, 2, 'min'), (0xc8, 0, 'max'), (0xd0, 2, 'max')]:
        n.put(GRID + offset, 'f', scene['map'][bound][axis])
    n.fragment(0x16b6f6c, 0x16b6fc9, {r.UC_X86_REG_R12: GRID})
    records = []
    for key, observation in objects['observations'].items():
        if observation['status'] != 'complete': raise ValueError('Incomplete native descriptor packet')
        obj, heap = bytes.fromhex(observation['object']), bytes.fromhex(observation['heap'])
        def at(pointer, length):
            offset = pointer - 0x10200000
            if offset < 0 or offset + length > len(heap): raise ValueError('Descriptor input arena bound')
            return heap[offset:offset + length]
        gp, gc = struct.unpack_from('<QI', obj, 0x10)
        for gi in range(gc):
            group = at(gp + gi * 0x50, 0x50); ep, ec = struct.unpack_from('<QI', group, 0x38)
            cp, cc = struct.unpack_from('<QI', group, 0x28)
            contexts = list(struct.unpack('<' + 'I' * cc, at(cp, cc * 4))) if cc else []
            for ei in range(ec):
                entry = at(ep + ei * 0xb8, 0xb8)
                n.u.mem_write(ENTRY, entry); n.u.mem_write(GROUP, group)
                n.u.mem_write(FRAME - 0x200, bytes(0x200)); n.put(FRAME - 0x38, 'Q', GROUP)
                n.fragment(*POSITIONS, {r.UC_X86_REG_RBX: ENTRY, r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_R13: n.base + 0x20d7d30})
                primary_height = n.u.reg_read(r.UC_X86_REG_R15D)
                secondary_height = n.u.reg_read(r.UC_X86_REG_R12D)
                n.fragment(*PREFIX, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_R15D: primary_height, r.UC_X86_REG_R12D: secondary_height})
                data = bytes(n.u.mem_read(FRAME - 0x190, 0xc0))
                index = len(records); expected = requests['records'][index]
                if (expected['key'], expected['groupIndex'], expected['entryIndex']) != (key, gi, ei):
                    raise ValueError('Descriptor/native request ordering differs')
                if [list(struct.unpack_from('<III', data, offset)) for offset in [0x54, 0x60]] != vectors['records'][index]['vectorBits'][:2]:
                    raise ValueError('Descriptor positions disagree with original prefix')
                values = {name: struct.unpack_from('<I', data, offset)[0] for name, offset in WORDS.items()}
                records.append({'key': key, 'groupIndex': gi, 'entryIndex': ei, 'entityId': expected['entityId'],
                    'descriptorHex': data.hex(), 'mutatedEntryHex': bytes(n.u.mem_read(ENTRY, 0xb8)).hex(),
                    'unresolvedAuxiliaryContextIds': contexts, **values,
                    'scalarBits': {name: struct.unpack_from('<I', data, offset)[0] for name, offset in SCALARS.items()},
                    'vector6cBits': list(struct.unpack_from('<III', data, 0x6c))})
    ranges = [PREFIX, POSITIONS, (0x16b3290, 0x16b3308), (0x16b6f6c, 0x16b6fc9)]
    for a,b in ranges:
        if n.image[a:b] != n.source.image[a:b]: raise ValueError('Descriptor code differs from pristine client')
    source = sha(Path(__file__).read_bytes())
    package = {'schema': 1, 'kind': 'native-particle-creation-descriptor-prefix', 'build': creation['build'], 'protocol': creation['protocol'],
        'decoderImageSha256': n.profile['decoderImageSha256'], 'constructorImageSha256': n.profile['constructorImageSha256'],
        'sliceSha256': n.profile['sliceSha256'], 'creationPackageSha256': inputs[str(creation_path.resolve())],
        'placementPackageSha256': inputs[str(placement_path.resolve())], 'sceneManifestSha256': inputs[str(scene_path.resolve())],
        'entryAddress': ENTRY, 'groupAddress': GROUP, 'frameAddress': FRAME, 'prefixBlock': list(PREFIX),
        'descriptorFrameOffset': -0x190, 'descriptorBytes': 0xc0, 'scalarFields': SCALARS, 'wordFields': WORDS, 'byteFields': BYTES,
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges], 'preparerSha256': source,
        'scope': {'entityPointersSuppliedZero': True, 'packetVectorInputsNative': True, 'resourceLookupExecuted': False,
            'auxiliaryContextLookupExecuted': False, 'worldRegistryExecuted': False, 'factoryExecuted': False, 'renderingIntegrated': False}}
    raw = json.dumps(package, indent=2).encode()
    destination = args.cache / 'public/latest-effect-descriptor/package.json'
    destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(raw)
    counts = {'entries': len(records), 'descriptorBytesCompared': len(records) * 0xc0,
        'nondefaultScalar78': sum(x['scalarBits']['scalar78'] != 0x3f800000 for x in records),
        'nondefaultScalar7c': sum(x['scalarBits']['scalar7c'] != 0x3f800000 for x in records),
        'nonzeroScalarA0': sum(x['scalarBits']['scalarA0'] != 0 for x in records),
        'nonzeroVector6c': sum(any(bits & 0x7fffffff for bits in x['vector6cBits']) for x in records),
        'flagCounts': dict(collections.Counter(str(x['flags']) for x in records)),
        'auxiliaryContextIds': sum(len(x['unresolvedAuxiliaryContextIds']) for x in records)}
    result = {'schema': 1, 'kind': 'native-particle-descriptor-observations', 'build': package['build'], 'protocol': package['protocol'],
        'packageSha256': sha(raw), 'preparerSha256': source, 'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
        'records': records, 'counts': counts, 'scope': package['scope']}
    (args.cache / 'research/effect-descriptor-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(raw), 'counts': counts}))


if __name__ == '__main__':
    main()
