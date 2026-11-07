"""Typed base-context/overlay mutation controls plus original direct callers.

Supplied empty resolver objects isolate mutation semantics. No character asset
readiness, accepted hero, replay stack or overlay absence is inferred.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from unicorn import x86_const as r
from unit_base_context_native import NativeUnitBaseContexts
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    n = NativeUnitBaseContexts(cache / 'public/decoder-16.21-macos', args.client)
    unit = n.create_unit()
    maps, contexts = [], []
    for index in range(3):
        resolver = n.allocate(24)
        n.call(0x16659b0, {r.UC_X86_REG_RDI: resolver})
        if n.q(resolver + 8) or n.u32(resolver + 0x10):
            raise ValueError('Original typed empty resolver differs')
        maps.append(resolver)
        context = n.character_context('ProducerControl' + str(index), index)
        # Explicit typed input, not a recovered actor/default/cache/readiness.
        n.put(context['object'] + 0x60, 'Q', resolver if index < 2 else 0)
        contexts.append(context)
    def stored():
        group = unit['group']
        return {'context': n.q(unit['object'] + 0x110), 'base': n.q(group + 0x10),
                'overlays': [n.q(at) for at in range(n.q(group + 0x18), n.q(group + 0x20), 8)]}
    operations = [
        ('context-a', 0x548bf0, contexts[0]['object']),
        ('overlay-a', 0x377390, maps[0]),
        ('overlay-null', 0x377390, 0),
        ('overlay-b', 0x377390, maps[1]),
        ('overlay-a-reappend', 0x377390, maps[0]),
        ('context-b-preserves-overlays', 0x548bf0, contexts[1]['object']),
        ('remove-b', 0x3774f0, maps[1]),
        ('remove-absent', 0x3774f0, maps[2]),
        ('remove-null', 0x3774f0, 0),
        ('null-context-retains-base', 0x548bf0, 0),
        ('typed-context-null-resolver-clears-base', 0x548bf0, contexts[2]['object']),
    ]
    expected = stored()
    controls = []
    for label, entry, argument in operations:
        before = stored()
        receiver = unit['object'] if entry == 0x548bf0 else unit['group']
        n.call(entry, {r.UC_X86_REG_RDI: receiver, r.UC_X86_REG_RSI: argument})
        if entry == 0x548bf0:
            expected['context'] = argument
            if argument:
                expected['base'] = n.q(argument + 0x60)
        else:
            if argument in expected['overlays']:
                expected['overlays'].remove(argument)
            if entry == 0x377390:
                expected['overlays'].append(argument)
        actual = stored()
        if actual != expected:
            raise ValueError('Original resource mutation differs: ' + label)
        controls.append({'label': label, 'entryRva': entry, 'argument': argument,
                         'before': before, 'after': actual})
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    callers = []
    for target in [0x377380, 0x377390, 0x3774f0]:
        for opcode in [0xe8, 0xe9]:
            offset = 0
            while (offset := n.image.find(bytes([opcode]), offset, 0x1fef000)) >= 0:
                source = offset
                offset += 1
                if source + 5 + struct.unpack_from('<i', n.image, source + 1)[0] != target:
                    continue
                raw = n.image[source:source + 5]
                instruction = list(md.disasm(raw, source))
                if (raw != n.source.image[source:source + 5] or len(instruction) != 1 or
                        instruction[0].mnemonic not in ['call', 'jmp']):
                    raise ValueError('Original direct resource mutation caller differs')
                callers.append({'rva': source, 'targetRva': target,
                                'kind': instruction[0].mnemonic, 'bytes': 5, 'sha256': sha(raw)})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'controls': controls, 'directCallers': sorted(callers, key=lambda x: x['rva']),
              'counts': {'typedMutationControls': len(controls), 'directCallSites': len(callers),
                         'byTarget': {hex(target): sum(c['targetRva'] == target for c in callers)
                                      for target in [0x377380, 0x377390, 0x3774f0]}},
              'typedInputs': {'unit': unit, 'emptyResolverObjects': maps, 'contexts': contexts},
              'originalBlocks': list(n.blocks.values()),
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'scope': {'originalMutationFunctionsExecuted': True, 'suppliedTypedEmptyResolvers': True,
                        'directRelativeCallGraphOnly': True, 'indirectProducersExcluded': False,
                        'assetReadinessVerified': False, 'acceptedHeroVerified': False,
                        'liveOverlayAbsenceEstablished': False, 'acceptedReplayState': False,
                        'mainViewerExpanded': False}}
    output = cache / 'research/resource-stack-producers-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'counts': result['counts'], 'scope': result['scope']}))


if __name__ == '__main__':
    main()
