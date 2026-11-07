"""Bounded static ownership-role evidence; never infer a particle creator.

Uses the pristine exact-build instruction image and cached decoded/native
packet fixtures. No game code executes and no production package is written.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from macho import MachImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    sha = lambda raw: hashlib.sha256(raw).hexdigest()
    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    decoder = cache / 'public/decoder-16.21-macos'
    profile = read(decoder / 'profile.json')
    image = raw(decoder / 'image.bin')
    original = MachImage(raw(args.client.resolve()))
    if (profile['clientVersion'] != '16.21.829.8620' or profile['protocolDigest'] != '20e09df23c66b85e' or
            sha(image) != profile['decoderImageSha256'] or original.base != profile['imageBase']):
        raise ValueError('Exact original build/image required')
    ranges = [
        ('ordinary-resource-input-order', 0x83e2a7, 0x83e2f4),
        ('source-transform-provider', 0x83ebdd, 0x83ebf1),
        ('special-unit-lookup', 0x83e197, 0x83e1d8),
        ('override-key-selection', 0x83de80, 0x83df23),
        ('conditional-override-resolution', 0x83e3e0, 0x83e442),
        ('descriptor-affiliation-and-reference', 0x83f361, 0x83f393),
        ('reference-affiliation-setter', 0x549500, 0x54957b),
        ('reference-affiliation-refresh', 0x548c40, 0x548cd1),
        ('affiliation-byte-setter-and-comparison', 0x549480, 0x5494b2),
        ('effect-own-id-registration', 0x8504db, 0x8504ee),
        ('registered-id-setter-prefix', 0x627700, 0x627719),
        ('packet-view-mask-setter', 0x85116a, 0x85117a),
        ('wrapper-view-mask-copy', 0x36b920, 0x36b935),
        ('wrapper-view-mask-consumer', 0x36b7f9, 0x36b861),
        ('view-mask-bit-test', 0x6cf1c0, 0x6cf1ce),
    ]
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    blocks, instructions = [], {}
    for label, start, end in ranges:
        data = image[start:end]
        if data != original.image[start:end]:
            raise ValueError('Role instructions differ from pristine client: ' + label)
        decoded = list(md.disasm(data, start))
        if sum(i.size for i in decoded) != len(data):
            raise ValueError('Role range must end at an instruction boundary: ' + label)
        rows = [{'rva': i.address, 'mnemonic': i.mnemonic, 'operands': i.op_str} for i in decoded]
        instructions.update({i.address: (i.mnemonic, i.op_str) for i in decoded})
        blocks.append({'label': label, 'startRva': start, 'endRva': end, 'sha256': sha(data), 'instructions': rows})
    expected = {
        0x83e2ab: ('mov', 'r13, qword ptr [r14 + 0x10]'),
        0x83e2af: ('mov', 'r15, qword ptr [r14 + 0x28]'),
        0x83e2ef: ('call', '0x377550'),
        0x83ebe1: ('mov', 'rsi, qword ptr [rax + 0x20]'),
        0x83ebec: ('call', '0x54f630'),
        0x83e197: ('mov', 'esi, dword ptr [r14 + 0x8c]'),
        0x83e1a5: ('call', '0x548f00'),
        0x83f365: ('movzx', 'esi, byte ptr [rax + 0x80]'),
        0x83f37d: ('mov', 'esi, dword ptr [rax + 0x84]'),
        0x83f38e: ('call', '0x549500'),
        0x549504: ('mov', 'dword ptr [rdi + 0x94], esi'),
        0x54955a: ('movzx', 'eax, byte ptr [rax + 0x90]'),
        0x549579: ('jmp', 'rcx'),
        0x549484: ('mov', 'byte ptr [rdi + 0x90], sil'),
        0x5494a1: ('cmp', 'al, 6'),
        0x8504e9: ('call', '0x627700'),
        0x627714: ('call', '0x549580'),
        0x36b92d: ('mov', 'dword ptr [rdi + 0x1c4], eax'),
        0x36b85c: ('jmp', '0x6cf1c0'),
        0x6cf1c6: ('bt', 'eax, esi'),
    }
    for address, instruction in expected.items():
        if instructions.get(address) != instruction:
            raise ValueError('Original role instruction changed: ' + hex(address))
    creation = read(cache / 'research/effect-creation-native.json')
    descriptor = read(cache / 'research/effect-descriptor-native.json')
    if (creation['build'] != profile['clientVersion'] or descriptor['build'] != profile['clientVersion'] or
            creation['protocol'] != profile['protocolDigest'] or descriptor['protocol'] != profile['protocolDigest'] or
            len(creation['records']) != len(descriptor['records'])):
        raise ValueError('Matching cached native packet observations required')
    rows = []
    for c, d in zip(creation['records'], descriptor['records']):
        if any(c[k] != d[k] for k in ['key', 'groupIndex', 'entryIndex', 'entityId']):
            raise ValueError('Cached native creation/descriptor order differs')
        if 69 <= c['time'] <= 99:
            rows.append({'source': {k: c[k] for k in ['key', 'time', 'groupIndex', 'entryIndex', 'entityId', 'contextId']},
                         **{k: d[k] for k in ['field80', 'field84', 'field88', 'field8c', 'field90', 'field94']}})
    if len(rows) != 1110:
        raise ValueError('Complete primary comparison request count required')
    result = {'schema': 1, 'kind': 'read-only-effect-creation-entity-roles', 'build': profile['clientVersion'],
              'protocol': profile['protocolDigest'], 'inputs': inputs, 'blocks': blocks,
              'assertedInstructions': len(expected), 'rows': rows,
              'counts': {'requests': len(rows), 'fields': {k: dict(collections.Counter(str(r[k]) for r in rows))
                       for k in ['field80', 'field84', 'field88', 'field8c', 'field90', 'field94']},
                        'transportContexts': dict(collections.Counter(str(r['source']['contextId']) for r in rows))},
              'observedRoles': [
                  'Descriptor10/28 are ordered resource resolution inputs; descriptor20 selects source transform provider.',
                  'Descriptor80 supplies the byte stored by the affiliation virtual setter.',
                  'Descriptor84 supplies an entity reference whose byte90 is copied through the same virtual setter; this establishes affiliation inheritance, not creation causality.',
                  'Descriptor8c supplies an additional world lookup before checked AI conversion and extra resource/provider handling.',
                  'Descriptor90/94 select conditional override resolution keys; descriptor88 selects its fallback route.',
                  'The handler registers the created effect using its own decoded entry38 identity through627700/549580.',
                  'Entry2c is copied to wrapper1c4 and consumed by a per-view bit test, not a world identity lookup.',
              ],
              'scope': {'readOnlyOriginalInstructions': True, 'gameCodeExecuted': False,
                        'cachedNativeFixtureCounts': True, 'creatorOwnershipRecovered': False,
                        'affiliationReferenceEqualsCreator': False, 'allPacketFieldsSemanticallyRecovered': False,
                        'serverProducerRecovered': False, 'runtimeAdmissionChanged': False}}
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Read-only role input drift')
    result['sources'] = {p.name: sha(p.read_bytes()) for p in [Path(__file__), Path(__file__).with_name('macho.py')]}
    output = cache / 'research/effect-creation-roles-evidence.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'blocks': len(blocks), 'assertedInstructions': len(expected), 'counts': result['counts'], 'scope': result['scope']}))


if __name__ == '__main__':
    main()
