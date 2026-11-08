"""Original group4 base-flag varuint boundaries, including noncanonical lengths.

The optional observer configuration is explicitly cached false, matching the
pinned schema control. No live entity constructor or packet acceptance is run.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    schema_path = cache / 'public/latest-champion-state/package.json'
    schema_bytes = schema_path.read_bytes()
    schema = json.loads(schema_bytes)
    n = NativeSpawn(cache / 'public/decoder-16.21-macos', args.client)
    if schema['decoderImageSha256'] != sha(n.image) or schema['groups']['4']['offsets'][0] != 0xc50:
        raise ValueError('Matching original base-flag schema required')
    entity = n.allocate(0x10100)
    n.u.mem_write(entity + 0x10000, b'\xa5' * 0x100)
    n.put(entity, 'Q', n.base + 0x22f80e0)
    n.u.mem_write(n.base + 0x255b7d0, b'\x01\x00\x00\x00')
    n.call(0x13e690, {r.UC_X86_REG_RDI: entity})
    replicator = n.q(entity + 0x2400)
    descriptor = n.q(replicator + 8 + 2 * 8)
    raw_descriptor = bytes(n.u.mem_read(descriptor, 0x198))
    if raw_descriptor.hex() != schema['groups']['4']['descriptorHex']:
        raise ValueError('Original registered group4 descriptor differs')
    source, slot = n.allocate(0x100), n.allocate(8)
    n.put(slot, 'Q', descriptor)
    rows = []
    for fifth in range(256):
      for tail in [b'', b'\x00', b'\x80\x00', b'\x80\x80\x00', b'\x80\x80\x80']:
        supplied = b'\xff\xff\xff\xff' + bytes([fifth]) + tail
        # Padding belongs to this input allocation. The returned consumed length
        # determines the exact standalone group body compared by JavaScript.
        n.u.mem_write(source, supplied + bytes(16))
        n.put(entity + 0xc50, 'I', 0xa5a5a5a5)
        n.call(0x1db4e0, {r.UC_X86_REG_RDI: slot, r.UC_X86_REG_RSI: entity,
                         r.UC_X86_REG_RDX: 1, r.UC_X86_REG_RCX: source})
        consumed = n.u.reg_read(r.UC_X86_REG_RAX)
        if not 1 <= consumed <= 8:
            raise ValueError('Original uint32 varuint escaped its eight-byte grammar')
        body = bytes(n.u.mem_read(source, consumed))
        value = struct.unpack('<I', n.u.mem_read(entity + 0xc50, 4))[0]
        rows.append({'suppliedBytesHex': supplied.hex(), 'fifthByte': fifth,
                     'dataHex': body.hex(), 'consumed': consumed, 'value': value,
                     'endsWithContinuationBit': bool(body[-1] & 128)})
    if bytes(n.u.mem_read(entity + 0x10000, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original base-flags reader escaped its owned entity')
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    blocks = []
    for start, end in [(0x13e690, 0x140450), (0x1db4e0, 0x1db640)]:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]:
            raise ValueError('Original varuint registration/reader bytes differ')
        blocks.append({'rva': start, 'bytes': len(raw), 'sha256': sha(raw)})
    report = {'schema': 1, 'kind': 'original-target-base-flags-varuint-boundaries',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image),
              'inputs': {str(schema_path): sha(schema_bytes)},
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'blocks': blocks, 'descriptorSha256': sha(raw_descriptor), 'controls': rows,
              'scope': {'originalRegisteredGroup4ReaderExecuted': True, 'suppliedOptionalObserverCachedFalse': True,
                        'allFifthByteValues': True, 'maximumEightByteConsumptionVerified': True,
                        'noncanonicalLengthsPreserved': True, 'liveReplicationAccepted': False}}
    output = cache / 'research/target-baseflag-varuint-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(rows),
                      'consumedLengths': sorted({row['consumed'] for row in rows}),
                      'unterminatedAtEight': sum(row['consumed'] == 8 and row['endsWithContinuationBit'] for row in rows)}))


if __name__ == '__main__':
    main()
