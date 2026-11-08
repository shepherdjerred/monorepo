"""Read-only singleton preflight over exact Mach-O function boundaries."""
import argparse
import bisect
import hashlib
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP
from macho import MachImage


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    image_path = args.cache / 'public/decoder-16.21-macos/image.bin'
    profile = json.loads((args.cache / 'public/decoder-16.21-macos/profile.json').read_text())
    image = image_path.read_bytes()
    source = MachImage(args.client.read_bytes())
    if sha(image) != profile['decoderImageSha256']:
        raise ValueError('Exact prepared decoder image required')
    data, offset = source.binary, 32
    table = None
    for _ in range(struct.unpack_from('<I', data, 16)[0]):
        command, size = struct.unpack_from('<II', data, offset)
        if command == 0x26:
            if table is not None:
                raise ValueError('Duplicate original function-start table')
            table = struct.unpack_from('<II', data, offset + 8)
        offset += size
    if table is None:
        raise ValueError('Original LC_FUNCTION_STARTS required')
    cursor, end = table[0], sum(table)
    functions, address = [], 0
    while cursor < end:
        delta = shift = 0
        while True:
            byte = data[cursor]
            cursor += 1
            delta |= (byte & 127) << shift
            shift += 7
            if byte < 128:
                break
            if shift > 63:
                raise ValueError('Original function-start delta exceeds uint64')
        if not delta:
            break
        address += delta
        functions.append(address)
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    def function(start):
        index = bisect.bisect_right(functions, start) - 1
        first, last = functions[index:index + 2]
        if first != start or source.image[first:last] != image[first:last]:
            raise ValueError('Pinned original function boundary/instructions differ')
        instructions = []
        for ins in decoder.disasm(image[first:last], source.base + first):
            globals_ = [ins.address + ins.size + operand.mem.disp - source.base
                        for operand in ins.operands if operand.type == X86_OP_MEM and
                        operand.mem.base == X86_REG_RIP and
                        0x2460000 <= ins.address + ins.size + operand.mem.disp - source.base < 0x2570000]
            if globals_ or ins.mnemonic == 'call':
                instructions.append({'rva': ins.address - source.base, 'mnemonic': ins.mnemonic,
                    'operands': ins.op_str, 'globalRvas': globals_,
                    'directCallTarget': ins.operands[0].imm - source.base
                        if ins.mnemonic == 'call' and ins.operands[0].type == X86_OP_IMM else None})
        return {'startRva': first, 'endRva': last,
                'sha256': sha(image[first:last]), 'instructions': instructions}
    selected = [0x6e8f40, 0x169900, 0x169a00, 0x169900, 0x16cac0,
                0x16e150, 0x2f2ce0, 0x2f3560, 0x36c110, 0x36c2e0,
                0x36cc60, 0x36cc70, 0x1c1f40, 0x6ff430, 0x15edc30]
    rows = [function(value) for value in dict.fromkeys(selected)]
    snapshot_path = args.cache / 'research/game-mode-data-native.json'
    snapshot = json.loads(snapshot_path.read_text())
    services = []
    for global_rva, name, ctor, startup in [
        (0x246cb48, 'effect-callback-manager', 0x36c110, [0x60c601, 0x60c628]),
        (0x246e1a8, 'keyed-unit-pointer-registry', 0x2f2ce0, [0x66a795, 0x66a7b1]),
        (0x2470b70, 'local-controller', 0x6fb580, [0x6ff430, 0x6ff4a0]),
        (0x246d000, 'clock-context', 0x15edc30, None),
    ]:
        patch = next((p for p in snapshot['snapshot']['imagePatches'] if p['rva'] <= global_rva < p['rva'] + 4096), None)
        value = struct.unpack_from('<Q', bytes.fromhex(patch['bytesHex']), global_rva - patch['rva'])[0] if patch else None
        services.append({'globalRva': global_rva, 'descriptiveName': name,
                         'constructorRva': ctor, 'startupRange': startup,
                         'baselineSnapshotValue': value,
                         'baselineIsCurrentMainState': False})
    output = args.cache / 'research/hero-handler-prerequisites.json'
    output.write_text(json.dumps({'schema': 1, 'build': profile['clientVersion'],
        'protocol': profile['protocolDigest'], 'decoderImageSha256': sha(image),
        'functionBoundarySource': 'LC_FUNCTION_STARTS', 'functions': rows, 'services': services,
        'inputs': {str(image_path.resolve()): sha(image), str(args.client.resolve()): sha(args.client.read_bytes()),
                   str(snapshot_path.resolve()): sha(snapshot_path.read_bytes()),
                   str(Path(__file__).resolve()): sha(Path(__file__).read_bytes())},
        'scope': {'readOnlyInstructionEvidence': True, 'gameExecutionPerformed': False,
                  'directGlobalsAndCallsOnly': True, 'indirectCallClosureEstablished': False,
                  'allPrerequisitesEstablished': False, 'mainViewerExpanded': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'functions': len(rows), 'services': services}))


if __name__ == '__main__':
    main()
