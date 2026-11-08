"""Observe the original registered-component prefix on ten initial hero packets.

Only the write before the concrete owner callback is observed. Owned native
registration and the AI-client vtable projection are explicit comparison inputs;
these observations are never a per-match browser runtime state package.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path

from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import ADDRESSES, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    reference = fixture.read(fixture.cache / 'research/latest-semantics-effects.json')
    samples = fixture.read(fixture.cache / 'research/target-visibility-reconstruction-input.json')
    objects = fixture.read(fixture.cache / 'research/target-visibility-reconstruction-native.json')
    if (reference['build'] != n.profile['clientVersion'] or reference['protocol'] != n.profile['protocolDigest'] or
            samples['build'] != reference['build'] or samples['protocol'] != reference['protocol'] or
            objects['decoderImageSha256'] != sha(n.image)):
        raise ValueError('Matching initial hero and original packet fixtures required')
    heroes = reference['heroes']
    if len(heroes) != 10 or len({hero['entityId'] for hero in heroes}) != len(heroes):
        raise ValueError('Ten distinct decoded initial hero identities required')
    n.call(0x66a140, {}, 0x66a16d)
    units, controls = {}, []
    for hero in heroes:
        unit = fixture.construct_ai()
        # This independent original no-call block establishes the concrete
        # client interfaces. It does not execute the full asset-dependent ctor.
        n.call(0xea42f, {r.UC_X86_REG_RBX: unit}, 0xea510)
        if n.q(unit + 0x1d8) - n.base != 0x22f06a0:
            raise ValueError('Original concrete AI-client owner interface differs')
        n.put(unit + 0x78, 'I', hero['entityId'])
        n.call(0x21b103, {r.UC_X86_REG_RBX: unit + 0x1e0, r.UC_X86_REG_RSI: unit + 0x78,
                         r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, 0x21b19c)
        units[hero['entityId']] = unit
    for hero in heroes:
        provenance = hero['provenance']
        eligible = [(key, sample) for key, sample in samples['packets'].items()
                    if sample['opcode'] == 822 and sample['stream'] == 2 and sample['time'] == 0 and
                    sample['chunkId'] == provenance['chunkId'] and sample['param'] == hero['entityId']]
        if len(eligible) != 1 or provenance['time'] != 0:
            raise ValueError('Exactly one matching initial snapshot hero primary required')
        key, sample = eligible[0]
        observed = objects['observations'][key]
        raw = bytes.fromhex(observed['object'])
        heap = bytes.fromhex(observed['heap'])
        if (observed['status'] != 'complete' or observed['opcode'] != 822 or
                observed['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex'])) or
                struct.unpack_from('<I', raw, 12)[0] != hero['entityId']):
            raise ValueError('Matching complete native initial primary object required')
        packet = n.allocate(48)
        n.u.mem_write(packet, raw)
        for offset in [0x10, 0x20]:
            pointer, length, capacity = struct.unpack_from('<QII', raw, offset)
            if length > capacity or (capacity and not 0x10200030 <= pointer <= 0x10200000 + len(heap) - capacity):
                raise ValueError('Initial packet vector escaped its original decoded heap')
            target = n.allocate(capacity) if capacity else 0
            if capacity:
                n.u.mem_write(target, heap[pointer - 0x10200000:pointer - 0x10200000 + capacity])
            n.put(packet + offset, 'Q', target)
        unit = units[hero['entityId']]
        before = {identity: bytes(n.u.mem_read(address + 0x201, 1))[0] for identity, address in units.items()}
        if before[hero['entityId']] != 0:
            raise ValueError('Original component must begin uninitialized')
        status = fixture.run_to(0x21b710, 0x21b75e,
                               {r.UC_X86_REG_RDI: packet + 0x10, r.UC_X86_REG_RSI: hero['entityId']})
        after = {identity: bytes(n.u.mem_read(address + 0x201, 1))[0] for identity, address in units.items()}
        if after[hero['entityId']] != 1 or any(after[i] != before[i] for i in units if i != hero['entityId']):
            raise ValueError('Original component lookup changed another registered generation')
        fixture.check_guard(unit)
        controls.append({'sampleKey': key, 'sourceEventId': f"visibility-request:{sample['transportSequence']}:0",
                         'entityId': hero['entityId'], 'time': sample['time'], 'stream': sample['stream'],
                         'chunkId': sample['chunkId'], 'transportSequence': sample['transportSequence'],
                         'entryOrder': 0, 'sourcePayloadSha256': observed['payloadSha256'],
                         'originalPrefixStatus': status, 'beforeInitializedByte': before[hero['entityId']],
                         'afterInitializedByte': after[hero['entityId']], 'otherRegisteredUnitsUnchanged': True,
                         'concreteOwnerVtableRva': n.q(unit + 0x1d8) - n.base,
                         'nativeAcceptedInternalId': None, 'nativeAcceptance': None})
    unknown_packet = n.allocate(48)
    before = [bytes(n.u.mem_read(unit + 0x201, 1))[0] for unit in units.values()]
    unknown_status = fixture.run_to(0x21b710, 0x21b75e,
                                  {r.UC_X86_REG_RDI: unknown_packet + 0x10, r.UC_X86_REG_RSI: 0}, allow_return=True)
    if unknown_status != 'handler-returned' or before != [bytes(n.u.mem_read(unit + 0x201, 1))[0] for unit in units.values()]:
        raise ValueError('Unknown initial component identity must not modify any unit')
    md, blocks = Cs(CS_ARCH_X86, CS_MODE_64), []
    for label, start, end in [
            ('original-component-registry-construction', 0x66a140, 0x66a16d),
            ('original-concrete-client-interface-projection', 0xea42f, 0xea510),
            ('original-component-network-registration', 0x21b103, 0x21b19c),
            ('original-primary-prefix-before-owner-callback', 0x21b710, 0x21b75e)]:
        raw = n.image[start:end]
        instructions = list(md.disasm(raw, start))
        if raw != n.source.image[start:end] or sum(i.size for i in instructions) != len(raw):
            raise ValueError('Initial component prefix differs from pristine original instructions')
        blocks.append({'label': label, 'rva': start, 'bytes': len(raw), 'sha256': sha(raw),
                       'instructions': [{'rva': i.address, 'mnemonic': i.mnemonic, 'operands': i.op_str} for i in instructions]})
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-initial-ai-component-prefix-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)}, 'blocks': blocks,
              'controls': controls, 'unknownIdentityControl': {'identity': 0, 'status': unknown_status},
              'scope': {'fullOriginalAiBaseConstructor': True, 'originalAiClientVtableProjection': True,
                        'fullAiClientConstructorExecutedHere': False, 'originalComponentMapRegistration': True,
                        'exactInitialPacketInputs': True, 'ownerCallbacksExecuted': False,
                        'nativeWorldAcceptanceRecovered': False, 'browserRuntimeStatePackage': False,
                        'actualProjectileAdmissionExpanded': False}}
    output = fixture.cache / 'research/initial-visibility-prefix-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'registeredHeroControls': len(controls),
                      'unknownIdentityControl': result['unknownIdentityControl'], 'scope': result['scope']}))


if __name__ == '__main__':
    main()
