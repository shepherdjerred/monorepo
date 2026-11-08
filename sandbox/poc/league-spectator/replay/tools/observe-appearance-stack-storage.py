"""Execute original appearance push storage before resource projection.

Each replay push is an independent control with an originally constructed
empty stack. This does not claim a full live transition or seekable unit state.
No appearance/resource callback is substituted.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from appearance_stack_native import NativeAppearanceStackInputs
from vfx_spawn_native import ADDRESSES, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    source = cache/'research/appearance-stack-inputs-comparison.json'
    evidence = json.loads(source.read_bytes())
    if evidence['mismatchCount'] != 0 or evidence['scope']['fullAppearanceTransitionExecuted']:
        raise ValueError('Scoped matching appearance inputs required')
    root = Path(__file__).resolve().parents[1]
    for path, digest in evidence['inputs'].items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Appearance input evidence changed: '+path)
    for path, digest in evidence['sources'].items():
        if sha((root/path).read_bytes()) != digest:
            raise ValueError('Appearance input source changed: '+path)
    n = NativeAppearanceStackInputs(cache/'public/decoder-16.21-macos', args.client)
    cases = []

    def cstring(value):
        encoded = value.encode('utf-8')+b'\0'
        at = n.allocate(len(encoded))
        n.u.mem_write(at, encoded)
        return at

    def read_string(at):
        length = n.u32(at+8)
        value = bytes(n.u.mem_read(n.q(at), length+1))
        if value[-1] != 0 or b'\0' in value[:-1]:
            raise ValueError('Original stored appearance string differs')
        return value[:-1].decode('utf-8', errors='strict')

    for event in evidence['records']:
        if event['opcode'] != 984:
            continue
        if event['preloadFlag'] or event['modifierNames']:
            raise ValueError('This storage observation requires explicit no-preload empty-modifier input')
        stack, modifiers = n.allocate(0x130), n.allocate(16)
        n.call(0x66230, {r.UC_X86_REG_RDI: stack, r.UC_X86_REG_RSI: 0})
        n.call(0x67120, {r.UC_X86_REG_RDI: stack, r.UC_X86_REG_RSI: modifiers})
        strings = {key: cstring(value) for key,value in event['strings'].items()}
        arguments = [event['flagStack0'], event['preloadFlag'], event['flagStack2'], event['flagStack3'],
                     event['gearIndex'], strings['alternateCharacterA'], event['alternateSkinA'],
                     strings['alternateCharacterB'], event['alternateSkinB'], 0, event['overrideMask'], strings['namespace']]
        for i,value in enumerate(arguments):
            n.put(ADDRESSES['stack']+8+i*8, 'Q', int(value))
        n.call(0x66310, {r.UC_X86_REG_RDI: stack, r.UC_X86_REG_RSI: strings['character'],
                        r.UC_X86_REG_RDX: event['skinId'], r.UC_X86_REG_RCX: event['entryId'],
                        r.UC_X86_REG_R8: int(event['flagR8']), r.UC_X86_REG_R9: int(event['flagR9'])}, 0x667f1)
        entry, end, capacity = n.q(stack), n.q(stack+8), n.q(stack+16)
        if not entry or end-entry != 0xa0 or capacity < end:
            raise ValueError('Original appearance vector insertion differs')
        actual = {'entryId': n.u32(entry+0x80), 'skinId': n.u32(entry+0x20),
                  'alternateSkinA': n.u32(entry+0x48), 'alternateSkinB': n.u32(entry+0x70),
                  'gearIndex': n.u.mem_read(entry+0x84,1)[0], 'overrideMask': n.u32(entry+0x98),
                  'strings': {name: read_string(entry+offset) for name,offset in
                              [('character',0),('namespace',0x10),('alternateCharacterA',0x28),('alternateCharacterB',0x50)]},
                  'flags': list(n.u.mem_read(entry+0x78,5)), 'modifierCount': n.u32(entry+0x90),
                  'pendingModifierDirty': n.u.mem_read(stack+0x108,1)[0]}
        expected = {key:event[key] for key in ['entryId','skinId','alternateSkinA','alternateSkinB','gearIndex','overrideMask','strings']}
        expected.update(flags=[int(event[key]) for key in ['flagR8','flagR9','flagStack0','flagStack2','flagStack3']],
                        modifierCount=0,pendingModifierDirty=0)
        if actual != expected:
            raise ValueError('Original appearance storage differs: '+json.dumps({'actual':actual,'expected':expected}))
        cases.append({'transportSequence':event['transportSequence'], 'entityId':event['entityId'], 'time':event['time'],
                      'stored':actual, 'entryHex':bytes(n.u.mem_read(entry,0xa0)).hex()})
    ranges = [(0x66230,0x66310),(0x66310,0x667f6),(0x67120,0x67210),(0x72de0,0x72f70),(0x756d0,0x75b50)]
    for a,b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original appearance storage code differs')
    report = {'schema':1, 'kind':'original-appearance-push-storage-observations',
              'build':n.profile['clientVersion'], 'protocol':n.profile['protocolDigest'],
              'inputs':{str(source):sha(source.read_bytes())},
              'sources':{Path(__file__).name:sha(Path(__file__).read_bytes())},
              'originalBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])} for a,b in ranges],
              'counts':{'independentReplayPushes':len(cases),'storedFieldsCompared':len(cases)*10},
              'cases':cases,'mismatchCount':0,
              'scope':{'originalStackConstructorExecuted':True,'originalPushPrefixExecuted':True,
                       'independentEmptyStackControls':True,'pendingModifiersExplicitlyEmpty':True,
                       'stoppedBeforeResourceProjection':True,'unitCallbacksExecuted':False,
                       'popClearCopyExecuted':False,'fullAppearanceTransitionExecuted':False,
                       'liveResourceStackReconstructed':False,'mainViewerExpanded':False}}
    (cache/'research/appearance-stack-storage-native.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'counts':report['counts'],'mismatchCount':0}))


if __name__ == '__main__':
    main()
