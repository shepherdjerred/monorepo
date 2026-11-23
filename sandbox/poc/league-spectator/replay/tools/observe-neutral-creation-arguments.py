"""Execute opcode745's original factory-argument prefix on captured objects.

The original nav-ready gate, prior-entity removal and factory call remain
outside this bounded observation. No readiness bits or accepted entities are
supplied; this establishes argument decoding, not successful native spawning.
"""
import argparse
import inspect
import json
import math
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha

ARENA, FRAME = 0x10200000, 0x100f5000
PREFIX = (0x6ea115, 0x6ea7dd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'capture', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    capture_bytes = args.capture.read_bytes()
    capture = json.loads(capture_bytes)
    n = NativeSpawn(args.cache/'public/decoder-16.21-macos', args.client)
    if (capture['kind'] != 'original-packet-family-capture' or capture['build'] != '16.21.829.8620' or
            capture['protocol'] != '20e09df23c66b85e' or capture['opcodes'] != [745] or
            capture['decoderImageSha256'] != sha(n.image) or not 0 < len(capture['records']) <= 10000):
        raise ValueError('Exact bounded original745 capture required')
    for path, digest in capture['inputs'].items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original capture source changed: '+path)
    table = 0x6d598e + struct.unpack_from('<i', n.image, 0x6d598a)[0]
    case = table + struct.unpack_from('<i', n.image, table+(745-7)*4)[0]
    if table != 0x6e70dc or case != 0x6dd4f5 or n.image[0x6dd502] != 0xe8 or (
            0x6dd507+struct.unpack_from('<i', n.image, 0x6dd503)[0]) != 0x6ea020:
        raise ValueError('Original packet dispatch no longer selects this745 consumer')
    records, boundary = [], None
    active = None
    try:
        for item in capture['records']:
            active = {'time': item['time'], 'transportSequence': item['transportSequence']}
            heap, obj = bytes.fromhex(item['heapHex']), bytes.fromhex(item['objectHex'])
            if len(obj) != 200 or not heap.startswith(obj) or len(heap) > 0x10000 or struct.unpack_from('<II', obj, 8) != (745, item['param']):
                raise ValueError('Bounded original745 object/arena identity differs')
            n.u.mem_write(ARENA, heap)
            n.u.mem_write(FRAME-0x100, bytes(0x200))
            n.call(0x6ea041, {r.UC_X86_REG_RBX: ARENA, r.UC_X86_REG_RBP: FRAME}, 0x6ea0fc)
            previous_lookup_id = n.u.reg_read(r.UC_X86_REG_ESI)
            n.call(PREFIX[0], {r.UC_X86_REG_RBX: ARENA, r.UC_X86_REG_RBP: FRAME,
                              r.UC_X86_REG_R12: n.base+0x20d6660}, PREFIX[1])
            def string(pointer):
                offset = pointer-ARENA
                if offset < 0 or offset >= len(heap):
                    raise ValueError('Original factory string escaped the captured arena')
                end = heap.find(b'\0', offset, min(len(heap), offset+1025))
                if end < 0:
                    raise ValueError('Original factory string is not bounded and terminated')
                return heap[offset:end].decode('ascii')
            def vector(pointer):
                if not FRAME-0x100 <= pointer <= FRAME+0x100-12:
                    raise ValueError('Original factory vector escaped its owned scratch frame')
                result = list(struct.unpack('<fff', n.u.mem_read(pointer, 12)))
                if not all(math.isfinite(value) for value in result):
                    raise ValueError('Original factory vector is nonfinite')
                return result
            stack = n.u.reg_read(r.UC_X86_REG_RSP)
            arguments = list(struct.unpack('<8Q', n.u.mem_read(stack, 64)))
            records.append({key: item[key] for key in ['time', 'param', 'stream', 'chunkId', 'blockOffset', 'transportSequence']} | {
                'name': string(n.u.reg_read(r.UC_X86_REG_RDI)),
                'previousLookupIdArgument': previous_lookup_id,
                'character': string(n.u.reg_read(r.UC_X86_REG_RSI)),
                'skinId': n.u.reg_read(r.UC_X86_REG_EDX),
                'skinIdStatus': 'Original factory-requested skin; final metadata/mode/team resolver not executed',
                'teamArgument': n.u.reg_read(r.UC_X86_REG_ECX),
                'firstVectorArgument': vector(n.u.reg_read(r.UC_X86_REG_R8)),
                'secondVectorArgument': vector(n.u.reg_read(r.UC_X86_REG_R9)),
                'scalarArgumentBits': n.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff,
                'stackArguments': arguments, 'secondaryName': string(arguments[0]),
                'mutatedObjectHex': bytes(n.u.mem_read(ARENA, 200)).hex()})
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    static_ranges = [(0x6d5975, 0x6d5997), (0x6dd4f5, 0x6dd507), (0x6ea020, 0x6ea041),
                     (0x186b10, 0x186b69), (0xc0e91, 0xc0ea6), (0xc0f6e, 0xc0f7f),
                     (0x2f229e, 0x2f22ac), (0x2a8120, 0x2a8143), (0x2a8150, 0x2a8176)]
    for start, end in static_ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original neutral resource dataflow instructions changed')
    result = {'schema': 1, 'kind': 'original-neutral-creation-factory-arguments',
              'build': capture['build'], 'protocol': capture['protocol'], 'replaySha256': capture['replaySha256'],
              'captureSha256': sha(capture_bytes), 'decoderImageSha256': sha(n.image),
              'originalDispatch': {'methodRva': 0x6d5950, 'tableRva': table, 'caseRva': case, 'consumerRva': 0x6ea020},
              'factoryArgumentPrefix': list(PREFIX), 'factoryRva': 0x186b10, 'records': records, 'boundary': boundary,
              'staticDataflowBlocks': [{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])}
                                       for start, end in static_ranges],
              'originalBlocks': list(n.blocks.values()),
              'sources': {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)},
              'scope': {'originalArgumentPrefixExecuted': boundary is None, 'navigationReadyGateExecuted': False,
                        'previousEntityRemovalExecuted': False, 'factoryExecuted': False,
                        'finalResourceSkinResolverExecuted': False,
                        'acceptedReplayEntities': False, 'nativeSpectatorEquivalent': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'records': len(records),
                      'skins': sorted({(row['character'], row['skinId']) for row in records}), 'boundary': boundary}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
