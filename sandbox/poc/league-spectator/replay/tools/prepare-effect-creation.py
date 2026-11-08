"""Recover opcode-756 field codecs from original creation-handler fragments.

No League process, world registry, graphics factory or attachment lookup runs.
Position getters stop before map-origin conversion; those results remain grid
coordinates, not fabricated world positions.
"""
import argparse
import collections
import json
from pathlib import Path
import struct
from unicorn import x86_const as r

from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import sha

ENTRY, GROUP, FRAME = 0x100f1000, 0x100f2000, 0x100f5000
TABLE = 0x20d7d30
# Field names follow their actual descriptor destination or retain the offset
# when the remaining native consumer is not yet understood.
FIELDS = {
    'entityId': ('entry', 0x38, 4, 0x84eb3b, 0x84ec29, 'ESI'),
    'resourceContextEntityId': ('entry', 0x24, 4, 0x84ec42, 0x84ecf6, 'ESI'),
    'attachmentEntityId': ('entry', 0x48, 4, 0x84ecfe, 0x84edc1, 'ESI'),
    'lookup14EntityId': ('entry', 0x14, 4, 0x84edd0, 0x84ee3d, 'ESI'),
    'lookupA8EntityId': ('entry', 0xa8, 4, 0x84ee42, 0x84ef1d, 'ESI'),
    'positionXGridBits': ('entry', 0xb4, 2, 0x84f033, 0x84f09f, 'EDI'),
    'positionHeightBits': ('entry', 0x90, 4, 0x84f0a4, 0x84f118, 'R15D'),
    'positionZGridBits': ('entry', 0x94, 2, 0x84f118, 0x84f162, 'EDI'),
    'resourceKey': ('group', 0x48, 4, 0x84f56f, 0x84f63b, None),
    'alternateNameKey': ('group', 0x10, 4, 0x8502fd, 0x85035a, 'EDI'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    decoder = args.cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    inputs = {}
    def read(path):
        raw = path.read_bytes(); inputs[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    samples = read(args.cache / 'research/effect-creation-input.json')
    objects = read(args.cache / 'research/effect-creation-objects-native.json')
    removals = read(args.cache / 'research/effect-removal-native.json')
    if (samples['build'] != n.profile['clientVersion'] or samples['protocol'] != n.profile['protocolDigest'] or
            objects['decoderImageSha256'] != n.profile['decoderImageSha256'] or
            objects['constructorImageSha256'] != n.profile['constructorImageSha256']):
        raise ValueError('Creation fixture provenance differs')
    dispatch = 0x6e70dc
    routes = [i + 7 for i in range(0x4eb) if dispatch + struct.unpack_from('<i', n.image, dispatch + i * 4)[0] == 0x6d814f]
    if routes != [756]: raise ValueError('Creation dispatcher changed')

    def getter(name, data):
        owner, offset, width, start, end, register = FIELDS[name]
        n.u.mem_write(ENTRY if owner == 'entry' else GROUP, bytes(data))
        n.put(FRAME - 0x38, 'Q', GROUP)
        n.fragment(start, end, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RSI: ENTRY,
                    r.UC_X86_REG_RBX: ENTRY, r.UC_X86_REG_R13: n.base + TABLE})
        result = n.u.reg_read(getattr(r, 'UC_X86_REG_' + register)) if register else struct.unpack('<I', n.u.mem_read(FRAME - 0x188, 4))[0]
        return result & ((1 << (8 * width)) - 1)

    codecs, probes = {}, []
    for name, (owner, offset, width, start, end, register) in FIELDS.items():
        columns = [[None] * 256 for _ in range(width)]
        for value in range(256):
            data = bytearray(0xb8 if owner == 'entry' else 0x50)
            data[offset:offset + width] = bytes([value] * width)
            result = getter(name, data).to_bytes(width, 'little')
            for lane in range(width): columns[lane][value] = result[lane]
        if any(len(set(column)) != 256 for column in columns):
            raise ValueError(f'Creation field is not a byte bijection: {name}')
        for index in range(512):
            encoded = bytes((index * 73 + lane * 61 + (index >> 8) * 29) & 255 for lane in range(width))
            data = bytearray(0xb8 if owner == 'entry' else 0x50); data[offset:offset + width] = encoded
            result = getter(name, data)
            translated = int.from_bytes(bytes(columns[lane][value] for lane, value in enumerate(encoded)), 'little')
            if result != translated: raise ValueError(f'Mixed creation getter differs: {name}')
            probes.append({'field': name, 'encodedHex': encoded.hex(), 'value': result})
        codecs[name] = {'owner': owner, 'offset': offset, 'width': width, 'getterBlock': [start, end], 'decode': columns}

    records, group_count = [], 0
    for key, sample in samples['packets'].items():
        observation = objects['observations'][key]
        if (sample['opcode'] != 756 or observation['status'] != 'complete' or
                observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex'])) or observation['param'] != sample['param']):
            raise ValueError('Incomplete native creation object')
        obj, heap = bytes.fromhex(observation['object']), bytes.fromhex(observation['heap'])
        if len(obj) != 32 or struct.unpack_from('<I', obj, 8)[0] != 756: raise ValueError('Creation object changed')
        def at(pointer, length):
            offset = pointer - 0x10200000
            if offset < 0 or offset + length > len(heap): raise ValueError('Creation arena bound')
            return heap[offset:offset + length]
        gp, gc = struct.unpack_from('<QI', obj, 0x10)
        for gi in range(gc):
            group = at(gp + gi * 0x50, 0x50); group_count += 1
            group_values = {name: getter(name, group) for name, spec in FIELDS.items() if spec[0] == 'group'}
            ep, ec = struct.unpack_from('<QI', group, 0x38)
            for ei in range(ec):
                entry = at(ep + ei * 0xb8, 0xb8)
                values = {name: getter(name, entry) for name, spec in FIELDS.items() if spec[0] == 'entry'}
                # Getter fragments are independently bounded, not a run of the
                # world-dependent creation handler.
                records.append({'key': key, 'time': sample['time'], 'chunkId': sample['chunkId'],
                    'blockOffset': sample['blockOffset'], 'stream': sample['stream'], 'contextId': sample['param'],
                    'groupIndex': gi, 'entryIndex': ei, **group_values, **values})
    ranges = [(spec[3], spec[4]) for spec in FIELDS.values()] + [
        (0x6d814f, 0x6d8161), (0x852090, 0x8520d0), (0x851480, 0x8514fc),
        (0x84f635, 0x84f675), (0x8502f4, 0x850386), (0x83ddc0, 0x83e315), (0x377550, 0x377610),
        (TABLE, TABLE + 256), (0x84eb20, 0x851200)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]: raise ValueError('Creation code differs from original client')
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in ['prepare-effect-creation.py', 'vfx_retirement_native.py']}
    package = {'schema': 1, 'kind': 'native-particle-creation-fields', 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': n.profile['decoderImageSha256'],
        'constructorImageSha256': n.profile['constructorImageSha256'], 'sliceSha256': n.profile['sliceSha256'],
        'opcode': 756, 'decoderRva': n.profile['packets']['756']['entryRva'], 'objectSize': 32,
        'arenaBase': 0x10200000, 'groupPointerOffset': 0x10, 'groupCountOffset': 0x18, 'groupStride': 0x50,
        'entryPointerOffset': 0x38, 'entryCountOffset': 0x40, 'entryStride': 0xb8, 'fields': codecs,
        'dispatchTableRva': dispatch, 'dispatchTableBytes': 0x4eb * 4,
        'dispatchTableSha256': sha(n.image[dispatch:dispatch + 0x4eb * 4]),
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'compilerSources': sources, 'scope': {'worldRegistryExecuted': False, 'factoryExecuted': False,
            'mapOriginConversionExecuted': False, 'attachmentPoseExecuted': False, 'mainViewerIntegrated': False}}
    raw = json.dumps(package, indent=2).encode()
    destination = args.cache / 'public/latest-effect-creation/package.json'
    destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(raw)
    created, removed = {x['entityId'] for x in records}, {x['entityId'] for x in removals['records']}
    counts = {'packets': len(samples['packets']), 'groups': group_count, 'entries': len(records), 'uniqueIds': len(created),
        'uniqueResourceKeys': len({x['resourceKey'] for x in records}), 'mixedProbes': len(probes),
        'createdIdsWithRemoval': len(created & removed), 'removedIdsWithoutCreation': len(removed - created)}
    result = {'schema': 1, 'kind': 'native-particle-creation-observations', 'build': package['build'], 'protocol': package['protocol'],
        'packageSha256': sha(raw), 'inputs': inputs, 'sources': sources, 'originalBlocks': list(n.blocks.values()),
        'mixedProbes': probes, 'records': records, 'counts': counts, 'scope': {**package['scope'], 'browserRun': False, 'leagueReferenceCompared': False}}
    (args.cache / 'research/effect-creation-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(raw), 'counts': counts}))


if __name__ == '__main__':
    main()
