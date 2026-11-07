"""Classify original root flag evidence without changing runtime admission."""
import argparse
import json
from pathlib import Path
import struct

import capstone
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        b = path.read_bytes()
        inputs[str(path)] = sha(b)
        return b

    def read(path):
        return json.loads(raw(path))

    native_path = cache / 'research/direct-root-flags-native.json'
    native = read(native_path)
    baseline = read(cache / 'research/direct-root-identity-activation-native.json')
    if native['baselineSha256'] != inputs[str(cache / 'research/direct-root-identity-activation-native.json')]:
        raise ValueError('Root flag baseline changed')
    for path, expected in native['inputs'].items():
        if sha(raw(Path(path))) != expected:
            raise ValueError('Root flag native input changed: ' + path)
    for name, expected in native['sources'].items():
        if sha(raw(Path(__file__).with_name(name))) != expected:
            raise ValueError('Root flag native producer changed: ' + name)
    decoder = cache / 'public/decoder-16.21-macos'
    profile = read(decoder / 'profile.json')
    image = raw(decoder / 'image.bin')
    if sha(image) != profile['decoderImageSha256'] or profile['decoderImageSha256'] != baseline['decoderImageSha256']:
        raise ValueError('Root flag instruction image differs from native observations')
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    cs.detail = True
    last_key = None
    names = []
    for instruction in cs.disasm(image[0x16ea9e1:0x16eab48], 0x16ea9e1):
        if instruction.mnemonic == 'lea' and instruction.operands[0].reg == capstone.x86.X86_REG_RCX:
            operand = instruction.operands[1]
            if operand.type != capstone.CS_OP_MEM or operand.mem.base != capstone.x86.X86_REG_RIP:
                raise ValueError('Original legacy root flag key is not RIP-relative')
            address = instruction.address + instruction.size + operand.mem.disp
            last_key = {'nameRva': address, 'name': image[address:image.index(0, address)].decode('ascii'),
                        'loadRva': instruction.address}
        if instruction.mnemonic == 'or' and instruction.operands[0].type == capstone.CS_OP_MEM:
            destination, flag = instruction.operands
            if destination.mem.disp != 0xc2 or flag.type != capstone.CS_OP_IMM or last_key is None:
                raise ValueError('Original root flag bit/name binding changed')
            names.append({**last_key, 'bit': flag.imm, 'storeRva': instruction.address,
                          'codeSha256': sha(image[last_key['loadRva']:instruction.address + instruction.size])})
            last_key = None
    if {n['bit'] for n in names} != {1, 2, 4, 8, 32, 64, 128}:
        raise ValueError('Original root flag name inventory incomplete')
    interpreted = []
    component_fields = {'substeps', 'rngHex', 'parentHex', 'actors', 'draws'}
    for case in native['cases']:
        component_differences = [f for f in case['frames'] if component_fields & set(f['differences'])]
        first = case['firstMismatch']
        object_differences = []
        if first is not None:
            expected = bytes.fromhex(first['expected']['objectHex'])
            actual = bytes.fromhex(first['actual']['objectHex'])
            object_differences = [i for i, (a, b) in enumerate(zip(expected, actual)) if a != b]
            if struct.unpack_from('<H', actual, 0x68)[0] != case['flags']:
                raise ValueError('Original object does not preserve its root flags')
        interpreted.append({'flags': case['flags'], 'frames': len(case['frames']),
                            'componentPayloadMatchesBaselineEveryFrame': not component_differences,
                            'componentDifferentFrames': len(component_differences),
                            'firstComponentDifference': component_differences[:1],
                            'firstSampleObjectChangedOffsets': object_differences,
                            'firstSampleOnlyObjectCopyWord68Changed': bool(first) and
                                bool(object_differences) and all(i in [0x68, 0x69] for i in object_differences),
                            'booleanControls': case['booleanControls'], 'flagReadSites': case['flagReads']})
    # These are ROOT flags at definition+c2, distinct from descriptor flags
    # mapped into parent+f8 by the packet factory.
    sites = [(0x1766768, 0x176679e, 'provider+170 queries virtual+88/+90 then calls 1762d90'),
             (0x1762da4, 0x1762def, 'ROOT bits2/4 gate parent+f8 bit8 from supplied integer/byte arguments'),
             (0x176330a, 0x1763359, 'ROOT bit64 forces a substep when ordinary accumulated count is zero'),
             (0x1761b41, 0x1761bad, 'ROOT bit16 gates cleanup of native sound slots298/29c'),
             (0x1766f7b, 0x1766f91, 'original wrapper/object state copies ROOT uint16 into object+68')]
    source_sites = [{'startRva': a, 'endRva': b, 'interpretation': meaning,
                     'bytesHex': image[a:b].hex(), 'sha256': sha(image[a:b])} for a, b, meaning in sites]
    result = {'schema': 1, 'kind': 'root-flag-native-evidence-classification',
              'build': native['build'], 'protocol': native['protocol'],
              'decoderImageSha256': profile['decoderImageSha256'],
              'nativeReportSha256': inputs[str(native_path)],
              'originalLegacyNames': names, 'unnamedObservedBits': [16],
              'cases': interpreted, 'sourceSites': source_sites,
              'inputs': inputs, 'sources': {Path(__file__).name: sha(Path(__file__).read_bytes())},
              'scope': {'rootDefinitionFlagWordOffset': 0xc2, 'packetParentFlagWordOffset': 0xf8,
                        'legacyNamesRecoveredFromOriginalInstructionsAndStrings': True,
                        'deathReviveProviderImplementationsIdentified': False,
                        'providerVirtualSlotsKnown': [0x88, 0x90],
                        'offscreenWrapperCadenceExecuted': False, 'soundHandlesPresent': False,
                        'callbackQueueEmptyInBooleanControls': True,
                        'compilerAdmissionChanged': False, 'matchCoverage': False}}
    output = cache / 'research/direct-root-flags-classification.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'names': names,
                      'matchingComponentFlags': [c['flags'] for c in interpreted if c['componentPayloadMatchesBaselineEveryFrame']],
                      'differentComponentFlags': [c['flags'] for c in interpreted if not c['componentPayloadMatchesBaselineEveryFrame']]}))


if __name__ == '__main__':
    main()
