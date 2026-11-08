"""Prepare opcode-187 fields and observe original particle removal routing."""
import argparse
import json
from pathlib import Path
import struct
from unicorn import x86_const as r

from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A, sha

GETTER = (0x8520e4, 0x852157)
ROUTE = (0x852188, 0x8521b2)
PROPAGATE = (0x1765bfe, 0x1765cce)
PACKET, ENTITY, OBJECT = 0x100f1000, 0x100f2000, 0x100f3000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    decoder = args.cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    bound = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    system = n.checked_json('vfx-system.json', 'vfxSystemSha256')
    inputs = {}
    def read(path):
        raw = path.read_bytes(); inputs[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    samples = read(args.cache / 'research/effect-removal-input.json')
    objects = read(args.cache / 'research/effect-removal-objects-native.json')
    cohort = read(args.cache / 'research/vfx-retirement-native.json')
    ref = cohort['cases'][0]['ref']
    graph = read(decoder / ref['file'])
    if (inputs[str((decoder / ref['file']).resolve())] != ref['sha256'] or samples['build'] != n.profile['clientVersion'] or
            samples['protocol'] != n.profile['protocolDigest'] or objects['decoderImageSha256'] != n.profile['decoderImageSha256'] or
            objects['constructorImageSha256'] != n.profile['constructorImageSha256']):
        raise ValueError('Removal fixture/decoder provenance differs')
    # The original dispatcher reads opcode +8 and indexes this signed-RVA table.
    table = 0x6e70dc
    opcodes = [index + 7 for index in range(0x4eb) if table + struct.unpack_from('<i', n.image, table + 4 * index)[0] == 0x6d5bbd]
    if opcodes != [187] or struct.unpack_from('<Q', n.image, 0x231c048)[0] != n.base + 0x36a5a0:
        raise ValueError('Native effect-removal dispatch or particle virtual method changed')
    def field(value):
        n.u.mem_write(PACKET, bytes(value))
        n.fragment(*GETTER, {r.UC_X86_REG_RBX: PACKET})
        return n.u.reg_read(r.UC_X86_REG_ESI)
    # Recover every byte/lane, then check mixed vectors against original getter.
    columns = [[None] * 256 for _ in range(4)]
    for value in range(256):
        packet = bytearray(24); packet[0x14:0x18] = bytes([value] * 4)
        result = struct.pack('<I', field(packet))
        for lane in range(4): columns[lane][value] = result[lane]
    if any(len(set(column)) != 256 for column in columns):
        raise ValueError('Removal entity ID storage is not a byte bijection')
    probes = []
    for index in range(512):
        encoded = bytes(((index * 73 + lane * 61 + (index >> 8) * 29) & 255) for lane in range(4))
        packet = bytearray(24); packet[0x14:0x18] = encoded
        native = field(packet)
        decoded = int.from_bytes(bytes(columns[lane][value] for lane, value in enumerate(encoded)), 'little')
        if native != decoded: raise ValueError('Mixed removal ID disagrees with original getter')
        probes.append({'encodedHex': encoded.hex(), 'entityId': native})
    records = []
    for key, sample in samples['packets'].items():
        observation = objects['observations'][key]
        if (sample['opcode'] != 187 or observation['status'] != 'complete' or
                observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex'])) or observation['param'] != sample['param']):
            raise ValueError('Incomplete native effect-removal object')
        packet = bytes.fromhex(observation['object'])
        if len(packet) != 24 or struct.unpack_from('<I', packet, 8)[0] != 187:
            raise ValueError('Removal object layout changed')
        records.append({'key': key, 'time': sample['time'], 'chunkId': sample['chunkId'], 'blockOffset': sample['blockOffset'],
                        'stream': sample['stream'], 'contextId': sample['param'], 'entityId': field(packet), 'reasonByte': packet[0x10],
                        'requestedFlagMask': 0x800 if packet[0x10] == 0x3d else 0x10000000})
    n.reset_parent(graph, 1, 0, bound, system)
    routing = []
    for reason in range(256):
        for initial in [0, 0x4000, 0xffffffff, 0x10000000]:
            for present in [False, True]:
                n.u.mem_write(PACKET, bytes(24)); n.put(PACKET + 0x10, 'B', reason)
                n.u.mem_write(ENTITY, bytes(0x300)); n.put(ENTITY, 'Q', n.base + 0x231be40)
                n.u.mem_write(OBJECT, bytes(0x238)); n.put(OBJECT + 0x18, 'I', initial); n.put(OBJECT + 0x28, 'Q', A['system'])
                n.put(ENTITY + 0x178, 'Q', OBJECT if present else 0)
                n.put(A['system'] + 0x2a9, 'H', 0); n.put(A['manager'] + 0x1d8, 'I', 0)
                n.fragment(*ROUTE, {r.UC_X86_REG_RBX: PACKET, r.UC_X86_REG_RAX: ENTITY})
                flags = struct.unpack('<I', n.u.mem_read(OBJECT + 0x18, 4))[0]
                if present:
                    n.fragment(*PROPAGATE, {r.UC_X86_REG_RBX: OBJECT})
                life = n.lifecycle()
                routing.append({'reasonByte': reason, 'initialObjectFlags': initial, 'effectPresent': present,
                                'objectFlags': flags, 'entityEffectPointer': n.q(ENTITY + 0x178),
                                'rootFlags': life['flags'], 'queued': life['lists']['retiring']['count']})
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in ['prepare-effect-removal.py', 'vfx_retirement_native.py']}
    ranges = [GETTER, ROUTE, PROPAGATE, (0x6d5975, 0x6d5997), (0x6d5bbd, 0x6d5bcf), (0x8520d0, 0x8521c6),
              (0x36a5a0, 0x36a60d), (0x36a890, 0x36a8fd), (0x17556c0, 0x17556ca), (0x17674d0, 0x17674da)]
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]: raise ValueError('Removal instructions differ from pristine client')
    package = {'schema': 1, 'kind': 'native-particle-entity-removal', 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': n.profile['decoderImageSha256'], 'sliceSha256': n.profile['sliceSha256'],
        'constructorImageSha256': n.profile['constructorImageSha256'], 'opcode': 187, 'objectSize': 24,
        'decoderRva': n.profile['packets']['187']['entryRva'], 'entityIdOffset': 0x14, 'entityIdDecode': columns,
        'reasonOffset': 0x10, 'defaultModeReason': 0x3d, 'defaultFlagMask': 0x800, 'otherFlagMask': 0x10000000,
        'handlerRva': 0x8520d0, 'getterBlock': list(GETTER), 'routingBlock': list(ROUTE), 'propagationBlock': list(PROPAGATE),
        'dispatchTableRva': table, 'dispatchTableBytes': 0x4eb * 4, 'dispatchTableSha256': sha(n.image[table:table + 0x4eb * 4]),
        'particleVtableRva': 0x231be40, 'stopVirtualOffset': 0x208,
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a, b in ranges], 'compilerSources': sources,
        'scope': {'particleEntityHandler': True, 'worldLookupResolvedByCaller': True, 'worldRegistryExecuted': False,
            'typeCastExecuted': False, 'callbackAbsent': True, 'rootSiblingsAbsent': True, 'mainViewerIntegrated': False,
            'missilePresentationInterfaceBound': False}}
    raw = json.dumps(package, indent=2).encode()
    destination = args.cache / 'public/latest-effect-removal/package.json'; destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(raw)
    result = {'schema': 1, 'kind': 'native-particle-entity-removal-observations', 'build': package['build'], 'protocol': package['protocol'],
        'packageSha256': sha(raw), 'inputs': inputs, 'sources': sources, 'originalBlocks': list(n.blocks.values()),
        'mixedProbes': probes, 'records': records, 'routing': routing, 'counts': {'records': len(records), 'mixedProbes': len(probes), 'routing': len(routing)},
        'scope': {**package['scope'], 'browserRun': False, 'leagueReferenceCompared': False}}
    (args.cache / 'research/effect-removal-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(raw), 'counts': result['counts']}))


if __name__ == '__main__':
    main()
