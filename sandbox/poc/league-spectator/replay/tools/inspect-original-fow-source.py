"""Bounded source-only FoW global references; no scene state is supplied."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_AC_WRITE
from capstone.x86_const import X86_OP_MEM, X86_REG_RIP


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh source inventory required')
    profile_bytes = (args.package/'profile.json').read_bytes()
    profile = json.loads(profile_bytes)
    image = (args.package/'image.bin').read_bytes()
    if (profile['clientVersion'] != '16.21.829.8620' or
            profile['protocolDigest'] != '20e09df23c66b85e' or
            sha(image) != '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7' or
            sha(image) != profile['decoderImageSha256']):
        raise ValueError('Exact original FoW image required')
    targets = {0x24967c8: 'disable-byte', 0x24967d0: 'gpu-controller', 0x24967d8: 'cpu-grid',
               0x247c680: 'map-container-provider',
               **{address: 'map-extent-region' for address in range(0x25699c0, 0x25699e1, 4)}}
    # These prefixes identify candidate RIP operands, never function extents.
    signatures = [bytes.fromhex(value) for value in [
        'c605', '803d', '8805', '880d', '8815', '488905', '488b05',
        '48890d', '488b0d', '488915', '488b15', '0fb605', '0fb60d', '0fb615',
        'c705', '833d', '807d', '48833d', '48813d', '80b9', '40883d',
        '488d05', '488d0d', '488d15', 'f30f1105', 'f30f1005',
    ]]
    signatures += [bytes([rex, op, modrm]) for rex in [0x48, 0x4c]
                   for op in [0x8d, 0x8b, 0x89] for modrm in range(5, 64, 8)]
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True
    found = {}
    for signature in signatures:
        at = 0x9000
        while True:
            at = image.find(signature, at, 0x1fef000)
            if at < 0:
                break
            instruction = next(md.disasm(image[at:at+15], at, count=1), None)
            if instruction:
                for operand in instruction.operands:
                    if operand.type != X86_OP_MEM or operand.mem.base != X86_REG_RIP:
                        continue
                    target = instruction.address+instruction.size+operand.mem.disp
                    if target not in targets:
                        continue
                    frame = image.rfind(bytes.fromhex('554889e5'), max(0x9000, at-1024), at+1)
                    start = frame if frame >= 0 else max(0x9000, at-32)
                    code = image[start:at+instruction.size+64]
                    found[at] = {
                        'rva': at, 'targetRva': target, 'target': targets[target],
                        'writes': bool(operand.access & CS_AC_WRITE),
                        'instructionHex': instruction.bytes.hex(),
                        'mnemonic': instruction.mnemonic, 'operands': instruction.op_str,
                        'candidateFrameRva': frame if frame >= 0 else None,
                        'sourceStartRva': start, 'sourceBytes': len(code), 'sourceSha256': sha(code),
                        'instructions': [{'rva': i.address, 'hex': i.bytes.hex(), 'mnemonic': i.mnemonic,
                                          'operands': i.op_str} for i in md.disasm(code, start)],
                    }
            at += 1
    calls = []
    for target in [0x21bfe0, 0x21c140, 0x21c150, 0x21c160]:
        at = 0x9000
        while True:
            at = image.find(b'\xe8', at, 0x1fef000)
            if at < 0:
                break
            if at+5+struct.unpack_from('<i', image, at+1)[0] == target:
                frame = image.rfind(bytes.fromhex('554889e5'), max(0x9000, at-1024), at+1)
                start = frame if frame >= 0 else max(0x9000, at-64)
                code = image[start:at+69]
                calls.append({'callRva': at, 'targetRva': target,
                              'candidateFrameRva': frame if frame >= 0 else None,
                              'sourceStartRva': start, 'sourceBytes': len(code), 'sourceSha256': sha(code),
                              'instructions': [{'rva': i.address, 'hex': i.bytes.hex(), 'mnemonic': i.mnemonic,
                                                'operands': i.op_str} for i in md.disasm(code, start)]})
            at += 1
    source = Path(__file__).read_bytes()
    result = {'schema': 1, 'kind': 'original-fow-global-source-candidates',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'decoderImageSha256': sha(image), 'profileSha256': sha(profile_bytes),
              'producerSha256': sha(source), 'records': sorted(found.values(), key=lambda row: row['rva']),
              'directCalls': calls,
              'scope': {'sourceOnly': True, 'candidateInstructionPrefixesExhaustive': False,
                        'functionExtentsProved': False, 'spectatorFlagProducerExecuted': False,
                        'actualFowStateAdmitted': False}}
    if ((args.package/'profile.json').read_bytes() != profile_bytes or
            (args.package/'image.bin').read_bytes() != image or Path(__file__).read_bytes() != source):
        raise ValueError('FoW source changed during inventory')
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'records': len(found), 'directCalls': len(calls),
                      'writes': [{'rva': row['rva'], 'target': row['target'], 'operands': row['operands']}
                                 for row in result['records'] if row['writes']]}))


if __name__ == '__main__':
    main()
