"""Complete opcode129 listener over an originally registered form component.

The lazy producer's existing-component branch is executed, not bypassed. This
does not establish that a replay unit already owns that component, nor prove
the distinct missing-component/graphics preparation branch.
"""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from unit_resource_native import NativeUnitResources
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    package_path = cache/'public/latest-unit-form-inputs/package.json'
    encoded = package_path.read_bytes()
    package = json.loads(encoded)
    n = NativeUnitResources(cache/'public/decoder-16.21-macos', args.client)
    if (package['build'] != n.profile['clientVersion'] or
            package['protocol'] != n.profile['protocolDigest'] or
            package['decoderImageSha256'] != sha(n.image)):
        raise ValueError('Exact native form decoder package required')
    for block in package['sourceBlocks']:
        if sha(n.image[block['startRva']:block['endRva']]) != block['sha256']:
            raise ValueError('Form decoder original source pin differs')
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    maps = []
    for _ in range(2):
        obj = n.allocate(24)
        n.call(0x16659b0, {r.UC_X86_REG_RDI: obj})
        maps.append(obj)
    unit = n.create_unit(maps[0], [maps[1], 0])
    n.call(0xd7b90, {r.UC_X86_REG_RDI: unit['componentManager']})
    component = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.allocations.get(component) != 0xd0 or n.q(component)-n.base != 0x23175f8:
        raise ValueError('Original registered form component differs')
    packet = n.allocate(package['objectSize'])
    visits = {}
    def observe(uc, address, size, user):
        at = address-n.base
        visits[at] = visits.get(at, 0)+1
        if at in [0x377380, 0x377390, 0x3774f0, 0x548bf0]:
            raise ValueError('Negative listener invoked a resource-stack mutation')
    watched = [0xbf8b0, 0xbf93a, 0x30d220, 0x30ed00, 0x377380, 0x377390, 0x3774f0, 0x548bf0]
    hooks = [n.u.hook_add(unicorn.UC_HOOK_CODE, observe, begin=n.base+at, end=n.base+at) for at in watched]
    def state():
        group = unit['group']
        return {'context': n.q(unit['object']+0x110), 'base': n.q(group+0x10),
                'overlays': [n.q(at) for at in range(n.q(group+0x18), n.q(group+0x20), 8)],
                'groupHex': bytes(n.u.mem_read(group, 0x30)).hex(),
                'componentHex': bytes(n.u.mem_read(component, 0xd0)).hex()}
    initial = state()
    controls = []
    try:
        for index in range(128, 256):
            for flag in [False, True]:
                body = bytearray(package['objectSize'])
                body[0x10] = package['decode']['index'].index(index)
                body[0x11] = package['decode']['nativeFlag'].index(flag)
                n.u.mem_write(packet, bytes(body))
                before_heap, before_allocations = n.next_heap, dict(n.allocations)
                visits = {}
                n.call(0xfdd00, {r.UC_X86_REG_RDI: unit['object'], r.UC_X86_REG_RSI: packet})
                if ((n.u.reg_read(r.UC_X86_REG_RAX)&255) != 1 or state() != initial or
                        n.next_heap != before_heap or n.allocations != before_allocations or
                        visits != {0xbf8b0: 1, 0x30ed00: 1}):
                    raise ValueError('Complete negative listener changed conditional resource state')
                controls.append({'index': index, 'nativeFlag': flag, 'bytesHex': body.hex(),
                                 'listenerReturned': True, 'resourceStackUnchanged': True,
                                 'registeredComponentUnchanged': True, 'heapUnchanged': True})
    finally:
        for hook in hooks:
            n.u.hook_del(hook)
    ranges = [(0xfdd00, 0xfde02), (0xbf8b0, 0xbf980), (0xd7b90, 0xd7c70),
              (0x30ed00, 0x30ed2b), (0x30edd6, 0x30edfe)]
    blocks = []
    for a, z in ranges:
        if n.image[a:z] != n.source.image[a:z]:
            raise ValueError('Original listener source differs from matching client')
        blocks.append({'rva': a, 'size': z-a, 'sha256': sha(n.image[a:z])})
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Native listener producer changed: '+path)
    if sha(package_path.read_bytes()) != sha(encoded):
        raise ValueError('Native form package changed during control')
    result = {'schema': 1, 'kind': 'original-negative-form-listener-existing-component-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': {str(package_path): sha(encoded)},
              'sources': sources, 'sourceBlocks': blocks, 'originalBlocks': list(n.blocks.values()),
              'unit': unit, 'component': component, 'initial': initial, 'controls': controls,
              'scope': {'completeOriginalListenerExecuted': True,
                        'originalLazyExistingComponentBranchExecuted': True,
                        'originalComponentConstructorAndRegistrationExecuted': True,
                        'all128NegativeIndicesBothFlags': True,
                        'conditionalResourceIdentityPreserved': True,
                        'missingComponentBranchEstablished': False,
                        'actualReplayComponentPresenceEstablished': False,
                        'wholePacketVisualNoOpEstablished': False,
                        'nativeReplayAcceptance': None, 'productionEligibilityChanged': False},
              'omissions': ['Missing form component still invokes original30d220/30d510 preparation.',
                            'Supplied resolver handles do not establish a replay resource stack.']}
    output = cache/'research/negative-form-listener-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls),
                      'fullListenerConditionalResourceIdentity': True,
                      'missingComponentBranchEstablished': False}))


if __name__ == '__main__':
    main()
