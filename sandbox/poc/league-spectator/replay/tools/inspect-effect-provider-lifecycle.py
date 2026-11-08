"""Read-only exact-build evidence for provider state and generation getters.

This records original instruction/data relationships. It does not execute a
death/revive event or claim that those field names have been established.
"""
import argparse
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    ranges = [
        ('root-provider-dispatch', 0x1766768, 0x176679e),
        ('ordinary-provider-construction', 0x1755a80, 0x1755ae8),
        ('ordinary-provider-false-state', 0x177dad0, 0x177dad8),
        ('ordinary-provider-false-generation', 0x177dae0, 0x177dae8),
        ('entity-provider-state-getter', 0x54d410, 0x54d4b6),
        ('entity-provider-generation-getter', 0x54d4c0, 0x54d595),
        ('entity-provider-generation-snapshot', 0x54cf51, 0x54cf7a),
        ('ai-base-state-virtual-getter', 0xd14a0, 0xd14af),
        ('ai-base-negative-state-generation-reset', 0xbfa60, 0xbfae8),
    ]
    blocks = []
    for label, start, end in ranges:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]:
            raise ValueError('Provider evidence differs from pristine original client')
        instructions = list(md.disasm(raw, start))
        if sum(i.size for i in instructions) != len(raw):
            raise ValueError('Provider evidence range must end at an instruction boundary: ' + label)
        blocks.append({'label': label, 'rva': start, 'bytes': len(raw), 'sha256': sha(raw),
                       'instructions': [{'rva': i.address, 'mnemonic': i.mnemonic, 'operands': i.op_str}
                                        for i in instructions]})
    tables = []
    entity_tables = [0x2336698, 0x23367b8, 0x23368d8, 0x2336a00,
                     0x2336b28, 0x2336c50, 0x2336d78, 0x2336e98]
    for table in [*entity_tables, 0x23f7228, 0x22ec2d0]:
        slots = [0x28] if table == 0x22ec2d0 else [0x88, 0x90]
        targets = {hex(slot): struct.unpack_from('<Q', n.image, table + slot)[0] - n.base
                   for slot in slots}
        expected = ({'0x28': 0xd14a0} if table == 0x22ec2d0 else
                    {'0x88': 0x177dad0, '0x90': 0x177dae0} if table == 0x23f7228 else
                    {'0x88': 0x54d410, '0x90': 0x54d4c0})
        if targets != expected:
            raise ValueError('Original provider virtual slot target differs')
        raw = n.image[table:table + max(slots) + 8]
        if raw != n.source.image[table:table + len(raw)]:
            raise ValueError('Original provider vtable differs from pristine client')
        tables.append({'rva': table, 'bytes': len(raw), 'sha256': sha(raw), 'slotTargets': targets})
    report = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'tables': tables, 'blocks': blocks,
              'observedInstructionBehavior': [
                  'Root wrapper passes provider virtual +0x88 and +0x90 low bytes to original 0x1762d90.',
                  'The ordinary 0x68-byte provider returns zero for both virtual getters.',
                  'Entity provider +0x88 locks its weak entity then calls entity virtual +0x28.',
                  'AI-base entity virtual +0x28 returns bit31 of entity+0x154.',
                  'Entity provider constructor snapshots decoded entity+0x14c into provider+0x18.',
                  'Entity provider +0x90 compares decoded entity+0x14c against provider+0x18.',
                  'AI-base original 0xbfa60 increments decoded entity+0x14c only from a negative +0x154 state, then writes +0x154=0x1f63d0ed.',
              ],
              'inputs': fixture.inputs,
              'sources': {Path(__file__).name: sha(Path(__file__).read_bytes())},
              'scope': {'readOnlyOriginalInstructionEvidence': True,
                        'runtimeStateTransitionsExecuted': False,
                        'semanticDeathReviveNamesEstablished': False,
                        'actualEntityProviderSelected': False,
                        'acceptedReplayState': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/effect-provider-lifecycle-evidence.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'tables': len(tables), 'instructionRanges': len(blocks),
                      'instructions': sum(len(b['instructions']) for b in blocks), 'scope': report['scope']}))


if __name__ == '__main__':
    main()
