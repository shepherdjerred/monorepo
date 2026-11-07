"""Observe original map initialization, creation vectors and grid conversion."""
import argparse
import json
from pathlib import Path
import struct
from unicorn import x86_const as r

from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import sha

ENTRY, FRAME, GRID = 0x100f1000, 0x100f5000, 0x100f6000
INIT = (0x16b6f6c, 0x16b6fc9)
POSITIONS = (0x84f033, 0x84f4f8)
GLOBALS = 0x2539f80
FIELDS = {
    'secondXGridBits': (0xa4, 2, 0x84f16f, 0x84f1cc, 'EDI'),
    'secondHeightBits': (0x3c, 4, 0x84f1d1, 0x84f2d6, 'R12D'),
    'secondZGridBits': (0x40, 2, 0x84f2d6, 0x84f30f, 'EDI'),
    'thirdXGridBits': (0xa6, 2, 0x84f31c, 0x84f383, 'EDI'),
    'thirdHeightBits': (0x10, 4, 0x84f390, 0x84f46e, 'EBX'),
    'thirdZGridBits': (8, 2, 0x84f472, 0x84f4d5, 'EDI'),
}


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
    manifest_path = args.cache / 'public/latest-scene/manifest.json'
    manifest = read(manifest_path)
    creation = read(args.cache / 'public/latest-effect-creation/package.json')
    objects = read(args.cache / 'research/effect-creation-objects-native.json')
    requests = read(args.cache / 'research/effect-creation-native.json')
    if (manifest['build'] != n.profile['clientVersion'] or manifest['protocol'] != n.profile['protocolDigest'] or
            creation['decoderImageSha256'] != n.profile['decoderImageSha256'] or
            objects['constructorImageSha256'] != n.profile['constructorImageSha256'] or
            requests['packageSha256'] != sha((args.cache / 'public/latest-effect-creation/package.json').read_bytes())):
        raise ValueError('Placement input provenance differs')
    n.u.mem_write(GRID, bytes(0x100))
    for offset, axis, bound in [(0xbc, 0, 'min'), (0xc4, 2, 'min'), (0xc8, 0, 'max'), (0xd0, 2, 'max')]:
        n.put(GRID + offset, 'f', manifest['map'][bound][axis])
    n.fragment(*INIT, {r.UC_X86_REG_R12: GRID})
    globals_hex = bytes(n.u.mem_read(n.base + GLOBALS, 6)).hex()
    initialized, _, origin_x, origin_z = struct.unpack('<BBhh', bytes.fromhex(globals_hex))
    if initialized != 1 or [origin_x, origin_z] != manifest['map']['movementOrigin']:
        raise ValueError('Original quantization initialization disagrees with prepared map')

    def getter(name, data):
        offset, width, start, end, register = FIELDS[name]
        n.u.mem_write(ENTRY, bytes(data))
        n.fragment(start, end, {r.UC_X86_REG_RBX: ENTRY, r.UC_X86_REG_RDX: ENTRY,
            r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_R13: n.base + 0x20d7d30})
        return n.u.reg_read(getattr(r, 'UC_X86_REG_' + register)) & ((1 << (8 * width)) - 1)
    codecs, probes = {}, []
    for name, (offset, width, start, end, register) in FIELDS.items():
        columns = [[None] * 256 for _ in range(width)]
        for value in range(256):
            data = bytearray(0xb8); data[offset:offset + width] = bytes([value] * width)
            result = getter(name, data).to_bytes(width, 'little')
            for lane in range(width): columns[lane][value] = result[lane]
        if any(len(set(column)) != 256 for column in columns): raise ValueError('Placement codec not bijective')
        for index in range(512):
            encoded = bytes((index * 73 + lane * 61 + (index >> 8) * 29) & 255 for lane in range(width))
            data = bytearray(0xb8); data[offset:offset + width] = encoded
            result = getter(name, data)
            if result != int.from_bytes(bytes(columns[lane][value] for lane, value in enumerate(encoded)), 'little'):
                raise ValueError('Mixed placement getter differs')
            probes.append({'field': name, 'encodedHex': encoded.hex(), 'value': result})
        codecs[name] = {'offset': offset, 'width': width, 'getterBlock': [start, end], 'decode': columns}

    # Every possible signed16 packet coordinate, on both axes, using original
    # helpers after original map initialization. Store raw float bits as oracle.
    conversion = bytearray()
    for helper in [0x16b3290, 0x16b32d0]:
        for coordinate in range(-32768, 32768):
            n.call(helper, {r.UC_X86_REG_EDI: coordinate & 0xffffffff})
            conversion.extend(struct.pack('<I', n.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))
    oracle_path = args.cache / 'research/effect-placement-grid-native.bin'
    oracle_path.write_bytes(conversion)
    records = []
    for key, obs in objects['observations'].items():
        if obs['status'] != 'complete': raise ValueError('Incomplete placement object')
        heap, obj = bytes.fromhex(obs['heap']), bytes.fromhex(obs['object'])
        def at(pointer, length):
            off = pointer - 0x10200000
            if off < 0 or off + length > len(heap): raise ValueError('Placement arena bound')
            return heap[off:off + length]
        gp, gc = struct.unpack_from('<QI', obj, 0x10)
        for gi in range(gc):
            group = at(gp + gi * 0x50, 0x50); ep, ec = struct.unpack_from('<QI', group, 0x38)
            for ei in range(ec):
                entry = at(ep + ei * 0xb8, 0xb8); n.u.mem_write(ENTRY, entry)
                n.fragment(*POSITIONS, {r.UC_X86_REG_RBX: ENTRY, r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_R13: n.base + 0x20d7d30})
                def word(address): return struct.unpack('<I', n.u.mem_read(address, 4))[0]
                vectors = [[word(FRAME - 0x50), n.u.reg_read(r.UC_X86_REG_R15D), word(FRAME - 0xa4)],
                    [word(FRAME - 0x70), n.u.reg_read(r.UC_X86_REG_R12D), word(FRAME - 0xa0)],
                    list(struct.unpack('<III', n.u.mem_read(FRAME - 0xb0, 12)))]
                fields = {name: getter(name, entry) for name in FIELDS}
                records.append({'key': key, 'groupIndex': gi, 'entryIndex': ei, 'vectorBits': vectors, 'fields': fields})
    ranges = [INIT, POSITIONS, (0x16b3290, 0x16b3308), (0x20ca4a8, 0x20ca4ac), (0x20cade4, 0x20cade8)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]: raise ValueError('Placement code differs from pristine client')
    source = sha(Path(__file__).read_bytes())
    package = {'schema': 1, 'kind': 'native-particle-placement-fields', 'build': creation['build'], 'protocol': creation['protocol'],
        'decoderImageSha256': creation['decoderImageSha256'], 'constructorImageSha256': creation['constructorImageSha256'],
        'sliceSha256': creation['sliceSha256'], 'creationPackageSha256': requests['packageSha256'],
        'sceneManifestSha256': inputs[str(manifest_path.resolve())], 'mapId': manifest['map']['id'], 'mapVariant': manifest['map']['variant'],
        'mapMin': manifest['map']['min'], 'mapMax': manifest['map']['max'], 'quantizationGlobalsRva': GLOBALS,
        'quantizationGlobalsHex': globals_hex, 'origin': [origin_x, origin_z],
        'scaleBits': struct.unpack_from('<I', n.image, 0x20cade4)[0], 'fields': codecs,
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'preparerSha256': source, 'scope': {'mapInitializationExecuted': True, 'packetVectorGettersExecuted': True,
            'entityOverrideExecuted': False, 'attachmentPoseExecuted': False, 'factoryExecuted': False, 'mainViewerIntegrated': False}}
    raw = json.dumps(package, indent=2).encode()
    destination = args.cache / 'public/latest-effect-placement/package.json'
    destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(raw)
    counts = {'entries': len(records), 'vectors': len(records) * 3, 'floatLanes': len(records) * 9,
        'mixedProbes': len(probes), 'gridCoordinates': len(conversion) // 4}
    result = {'schema': 1, 'kind': 'native-particle-placement-observations', 'build': package['build'], 'protocol': package['protocol'],
        'packageSha256': sha(raw), 'preparerSha256': source, 'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
        'gridOracleSha256': sha(conversion), 'mixedProbes': probes, 'records': records, 'counts': counts, 'scope': package['scope']}
    (args.cache / 'research/effect-placement-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(raw), 'origin': package['origin'], 'scaleBits': package['scaleBits'], 'counts': counts}))


if __name__ == '__main__':
    main()
