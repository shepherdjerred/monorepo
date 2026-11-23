"""Compile exact745 byte permutations from original argument instructions.

Dependency probes, every input byte value, mixed lanes and every captured
object must agree. This does not execute navigation readiness or the factory.
"""
import argparse
import inspect
import json
import random
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha

ARENA, FRAME = 0x10200000, 0x100f5000
FIELDS = [('entityId', 4), ('requestedSkinId', 4), ('nativeTeamEnum', 1),
          ('scalarArgumentBits', 4), ('firstVectorArgument', 12), ('secondVectorArgument', 12)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'capture', 'arguments', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    capture_bytes, argument_bytes = args.capture.read_bytes(), args.arguments.read_bytes()
    capture, proof = json.loads(capture_bytes), json.loads(argument_bytes)
    if (capture['kind'] != 'original-packet-family-capture' or capture['opcodes'] != [745] or
            proof['kind'] != 'original-neutral-creation-factory-arguments' or proof['boundary'] is not None or
            proof['captureSha256'] != sha(capture_bytes) or
            not 0 < len(capture['records']) == len(proof['records']) <= 10000):
        raise ValueError('Matching complete original745 capture/argument proof required')
    for file, digest in {**capture['inputs'], **proof['sources']}.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original745 proof input changed: '+file)
    n = NativeSpawn(args.cache/'public/decoder-16.21-macos', args.client)
    if (capture['build'] != '16.21.829.8620' or capture['protocol'] != '20e09df23c66b85e' or
            sha(n.image) != capture['decoderImageSha256']):
        raise ValueError('Exact original745 image/build required')

    def run(heap):
        n.u.mem_write(ARENA, bytes(heap))
        n.u.mem_write(FRAME-0x100, bytes(0x200))
        n.call(0x6ea041, {r.UC_X86_REG_RBX: ARENA, r.UC_X86_REG_RBP: FRAME}, 0x6ea0fc)
        identity = n.u.reg_read(r.UC_X86_REG_ESI)
        n.call(0x6ea115, {r.UC_X86_REG_RBX: ARENA, r.UC_X86_REG_RBP: FRAME,
                          r.UC_X86_REG_R12: n.base+0x20d6660}, 0x6ea7dd)
        return (struct.pack('<IIBI', identity, n.u.reg_read(r.UC_X86_REG_EDX),
                            n.u.reg_read(r.UC_X86_REG_ECX), n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff) +
                bytes(n.u.mem_read(n.u.reg_read(r.UC_X86_REG_R8), 12)) +
                bytes(n.u.mem_read(n.u.reg_read(r.UC_X86_REG_R9), 12)))

    source = bytearray.fromhex(capture['records'][0]['heapHex'])
    baseline = run(source)
    dependencies = [set() for _ in baseline]
    for offset in range(200):
        for mask in [1, 255]:
            data = bytearray(source)
            data[offset] ^= mask
            result = run(data)
            for index, (left, right) in enumerate(zip(baseline, result)):
                if left != right:
                    dependencies[index].add(offset)
    if any(len(offsets) != 1 for offsets in dependencies):
        raise ValueError('Original neutral fields are not independent single-byte permutations')
    offsets = [next(iter(values)) for values in dependencies]
    tables = [[None]*256 for _ in baseline]
    for offset in sorted(set(offsets)):
        affected = [index for index, dependency in enumerate(offsets) if dependency == offset]
        for value in range(256):
            data = bytearray(source)
            data[offset] = value
            result = run(data)
            for index in affected:
                tables[index][value] = result[index]
    if any(len(set(table)) != 256 for table in tables):
        raise ValueError('Original neutral byte codec is not bijective')

    def decoded(heap):
        return bytes(table[heap[offset]] for offset, table in zip(offsets, tables))

    rng = random.Random(0x16210745)
    mixed = []
    for index in range(1024):
        data = bytearray(source)
        for offset in set(offsets):
            data[offset] = rng.randrange(256)
        expected = run(data)
        if decoded(data) != expected:
            raise ValueError('Mixed native745 byte fields disagree')
        mixed.append({'objectHex': bytes(data[:200]).hex(), 'decodedHex': expected.hex()})
    for item, original in zip(capture['records'], proof['records']):
        heap = bytes.fromhex(item['heapHex'])
        expected = struct.pack('<IIBI', item['param'], original['skinId'], original['teamArgument'], original['scalarArgumentBits'])
        expected += struct.pack('<fff', *original['firstVectorArgument']) + struct.pack('<fff', *original['secondVectorArgument'])
        if decoded(heap) != expected or run(heap) != expected:
            raise ValueError('Original captured745 argument comparison differs')
    fields, at = {}, 0
    for name, size in FIELDS:
        fields[name] = {'bytes': size, 'inputOffsets': offsets[at:at+size], 'decode': tables[at:at+size]}
        at += size
    ranges = [(0x6ea041, 0x6ea0fc), (0x6ea115, 0x6ea7dd), (0x6eb783, 0x6eb7a3)]
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original neutral argument instructions differ')
    package = {'schema': 1, 'kind': 'native-neutral-factory-argument-fields', 'build': capture['build'],
               'protocol': capture['protocol'], 'decoderImageSha256': sha(n.image),
               'constructorImageSha256': capture['constructorImageSha256'], 'sliceSha256': n.profile['sliceSha256'],
               'opcode': 745, 'objectBytes': 200, 'heapBase': ARENA, 'fields': fields,
               'strings': {'initialAnimation': 0x18, 'name': 0x38, 'secondaryName': 0x68, 'character': 0x98},
               'sourceBlocks': [{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])} for start, end in ranges],
               'preparerSha256': sha(Path(__file__).read_bytes()),
               'scope': {'originalArgumentInstructionsExecuted': True, 'allByteValuesCompared': True,
                         'mixedByteLanesCompared': True, 'factoryExecuted': False,
                         'initialAnimationRequestDataflowStaticOnly': True,
                         'finalResourceSkinResolutionIncluded': False, 'nativeWorldAcceptanceIncluded': False}}
    raw = json.dumps(package, indent=2).encode()
    destination = args.output/'public/latest-neutral-creation/package.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
    sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    observation = {'schema': 1, 'kind': 'native-neutral-creation-codec-observations',
                   'packageSha256': sha(raw), 'captureSha256': sha(capture_bytes), 'argumentProofSha256': sha(argument_bytes),
                   'capturedObjectsCompared': len(capture['records']), 'dependencyProbeCalls': 400,
                   'mixedProbes': mixed, 'allValueProbeCalls': len(set(offsets))*256,
                   'originalBlocks': list(n.blocks.values()),
                   'sources': {str(file.resolve()): sha(file.read_bytes()) for file in sorted(sources)}}
    output = args.output/'research/neutral-creation-codecs-native.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(observation, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(raw), 'capturedObjectsCompared': len(capture['records']),
                      'fields': {name: field['inputOffsets'] for name, field in fields.items()}}), flush=True)


if __name__ == '__main__':
    main()
