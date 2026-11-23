"""Original movement header readers and conditional unit speed-cache writes.

The captured record is read unchanged. Owned flag/cache controls establish the
original numeric domain without claiming that its actual game entity was
accepted, or that the complete movement controller/frame loop was reproduced.
"""
import argparse
import inspect
import json
import math
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
import animation_provider_native as providers
from vfx_spawn_native import sha


def prefix(n, start, end, registers):
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                        lambda engine, address, size, user: engine.emu_stop(),
                        begin=n.base+end, end=n.base+end)
    try:
        n.call(start, registers, end)
    finally:
        n.u.hook_del(hook)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'boundary', 'snapshot_bindings', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--capture-bindings', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    files = {Path(__file__)}
    for value in vars(providers).values():
        if inspect.isfunction(value) or inspect.isclass(value):
            file = Path(inspect.getfile(value)).resolve()
            if file.parent == root:
                files.add(file)
    for klass in providers.NativeAnimationProvider.__mro__:
        if klass is not object:
            files.add(Path(inspect.getfile(klass)))
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in files}
    captured = args.boundary.read_bytes()
    request = json.loads(captured)
    boundary = request['boundary']
    if (request['kind'] != 'original-movement-parser-boundary' or request['build'] != '16.21.829.8620' or
            request['protocol'] != '20e09df23c66b85e' or boundary['opcode'] not in [649, 657] or
            boundary['error']['name'] != 'MovementRecordError'):
        raise ValueError('Exact original movement boundary capture required')
    capture_bindings_bytes = args.capture_bindings.read_bytes() if args.capture_bindings else None
    capture_bindings = json.loads(capture_bindings_bytes) if capture_bindings_bytes else None
    if capture_bindings is not None and set(capture_bindings) != set(request['inputs']):
        raise ValueError('Complete explicit historical capture input bindings required')
    selected_inputs = {}
    for file, digest in request['inputs'].items():
        selected = capture_bindings[file] if capture_bindings is not None else file
        if sha(Path(selected).read_bytes()) != digest:
            raise ValueError('Original movement capture source changed: '+file)
        selected_inputs[str(Path(selected).resolve())] = digest
    fixture = providers.create_animation_provider_fixture(args.cache, args.client,
        json.loads(args.snapshot_bindings.read_bytes()))
    n = fixture.native
    if request['decoderImageSha256'] != sha(n.image):
        raise ValueError('Original movement image differs')
    object_bytes = bytes.fromhex(boundary['objectHex'])
    heap = bytes.fromhex(boundary['heapHex'])
    pointer = struct.unpack_from('<Q', object_bytes, 24)[0]-0x10200000
    length = struct.unpack_from('<I', object_bytes, 32)[0]
    details = boundary['error']['details']
    offset = details['recordOffset']
    if not 0 <= pointer <= len(heap)-length or not 0 <= offset <= length-10:
        raise ValueError('Captured original movement vector/header escaped bounds')
    header = heap[pointer+offset:pointer+offset+10]
    kind, entity, speed_bits = struct.unpack('<HII', header)
    actual_speed = struct.unpack('<f', header[6:10])[0]
    if (kind != details['recordType'] or entity != details['entityId'] or speed_bits != details['speedBits'] or
            not math.isfinite(actual_speed) or actual_speed <= 5000 or not (kind & 255) >> 1):
        raise ValueError('Captured movement boundary is not the observed finite high-speed domain')
    data, reader = n.allocate(32), n.allocate(8)
    n.u.mem_write(data, header+bytes(22))
    header_reads = []
    for start, end in [(0x559680, 0x559712), (0x559d30, 0x559dc2)]:
        n.put(reader, 'Q', data)
        prefix(n, start, end, {r.UC_X86_REG_RDI: reader})
        frame = n.u.reg_read(r.UC_X86_REG_RBP)
        if n.u32(frame-0x1e4) != speed_bits or n.q(reader) != data+10 or n.u.reg_read(r.UC_X86_REG_EBX) != entity:
            raise ValueError('Original movement header reader changed/limited captured speed bits')
        header_reads.append({'entryRva': start, 'endRva': end, 'speedBits': n.u32(frame-0x1e4),
                             'entityId': n.u.reg_read(r.UC_X86_REG_EBX), 'consumed': 10})
    unit = providers.construct_animation_hero(fixture)
    frame = n.allocate(0x1000)+0x800
    samples = []
    values = [0.0, 5000.0, 5000.5, actual_speed, 10000.0, struct.unpack('<f', bytes.fromhex('ffff7f7f'))[0]]
    for start, end in [(0x559b51, 0x559b84), (0x55a22a, 0x55a25d)]:
        for flags, flags2 in [(0xf, 4), (0xf, 0), (0x10, 4), (0x04000000, 4)]:
            for speed in values:
                n.put(unit+0xc50, 'I', flags)
                n.put(unit+0xc78, 'I', flags2)
                if n.q(unit+0xc68) or n.q(unit+0xc90):
                    raise ValueError('Owned original movement flag control has an external provider')
                n.put(unit+0xf9c, 'I', 0x42f68000)
                n.put(frame-0x1e4, 'f', speed)
                prefix(n, start, end, {r.UC_X86_REG_RBX: unit, r.UC_X86_REG_RBP: frame})
                bits = n.u32(unit+0xf9c)
                expected = struct.unpack('<I', struct.pack('<f', speed))[0] if speed > 0 and flags == 0xf and flags2 == 4 else 0x42f68000
                if bits != expected:
                    raise ValueError('Original positive-speed/unit-flag cache semantics differ')
                samples.append({'entryRva': start, 'baseFlags': flags, 'secondaryFlags': flags2,
                                'speedBits': struct.unpack('<I', struct.pack('<f', speed))[0], 'cacheBits': bits})
    for file, digest in sources.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Movement numeric-domain source changed during observation')
    for file, digest in {**fixture.inputs, **selected_inputs}.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Movement numeric-domain input changed during observation')
    args.output.write_text(json.dumps({'schema': 1, 'kind': 'original-movement-header-speed-domain',
        'build': request['build'], 'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
        'captureSha256': sha(captured), 'inputs': {**fixture.inputs, **selected_inputs}, 'sources': sources,
        'captureInputBindings': capture_bindings,
        'captureInputBindingsSha256': sha(capture_bindings_bytes) if capture_bindings_bytes else None,
        'record': {key: boundary[key] for key in ['opcode','time','stream','transportSequence','chunkId','blockOffset']},
        'header': {'recordType': kind, 'entityId': entity, 'speed': actual_speed, 'speedBits': speed_bits},
        'originalHeaderReads': header_reads, 'samples': samples, 'originalBlocks': list(n.blocks.values()),
        'scope': {'originalHeaderBitsPreserved': True, 'originalPositiveSpeedAndUnitFlagBranchesExecuted': True,
                  'nativeUpper5000LimitObserved': False, 'actualRecordedUnitFlagsEstablished': False,
                  'completeMovementControllerExecuted': False, 'nativeEntityAcceptance': False,
                  'nativeSpectatorAdmitted': False}}, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'record': details, 'originalHeaderReads': len(header_reads), 'nativeCacheBranchSamples': len(samples)}))


if __name__ == '__main__':
    main()
