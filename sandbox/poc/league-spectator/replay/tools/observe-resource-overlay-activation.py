"""Original game-state gate and mode-keyed registration of TFT resource managers.

Mode strings are supplied controls, not decoded match configuration. Factories
stop before subsystem creation; this does not admit empty live unit overlays.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from unit_base_context_native import NativeUnitBaseContexts
from vfx_spawn_native import sha

FRAME, MODE = 0x100f5000, 0x100e0000


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    n = NativeUnitBaseContexts(cache/'public/decoder-16.21-macos', args.client)
    if struct.unpack_from('<Q', n.image, 0x2364340+0x28)[0] != n.base+0x910710:
        raise ValueError('Original registered subsystem update slot differs')
    state = n.allocate(0x80)
    n.call(0x625a20, {r.UC_X86_REG_RDI: state})
    if n.q(n.base+0x2470600) != state:
        raise ValueError('Original game-state constructor did not install its global')
    states = []
    for value in range(6):
        # Invert the original obfuscated enum arithmetic to supply every state.
        rotated = value ^ 0x3dc9cb21
        encoded = ((((rotated >> 21) | (rotated << 11)) & 0xffffffff)-0x3ab42910) & 0xffffffff
        n.put(state+0x10, 'I', encoded)
        n.call(0x625dac, {r.UC_X86_REG_RBX: state}, 0x625dbc)
        decoded = n.u.reg_read(r.UC_X86_REG_RAX) & 0xffffffff
        ptr = n.q(n.base+0x23456c0+decoded*8)-n.base
        if decoded != value or not 0x2100000 <= ptr < 0x22d0000:
            raise ValueError('Original game-state enum decode/string table differs')
        label = n.image[ptr:n.image.index(b'\0', ptr)].decode('ascii')
        # The true branch stops before the manager reads its object or roster.
        n.call(0x931620, {r.UC_X86_REG_RDI: 0}, 0x931642 if value == 2 else None)
        states.append({'encoded': encoded, 'decoded': decoded, 'label': label,
                       'managerEntryAdmitted': value == 2})
    if next(v for v in states if v['encoded'] == 0x13a4f0de)['label'] != 'GAMESTATE_GAMELOOP':
        raise ValueError('Resource overlay gate is not the observed game-loop state')

    # Execute the original registration prefix and C++ callback map insertion.
    # Both callbacks are copied by their original std::function machinery.
    n.u.mem_write(FRAME-0x500, bytes(0x500))
    n.call(0x9239ba, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: FRAME-0xf0,
                    r.UC_X86_REG_R14: FRAME-0x50}, 0x923a15)
    config = n.allocate(0xa0)
    n.put(n.base+0x246d020, 'Q', config)
    modes = []
    for mode in ['CLASSIC', 'ARAM', 'KIWI', 'CHERRY', 'TFT']:
        n.u.mem_write(MODE, mode.encode('ascii')+b'\0')
        n.put(config+0x90, 'Q', MODE)
        # Original getter/hash/table selection. Stop before the matching case
        # invokes callbacks or creates the full TFT subsystem.
        n.call(0x40be50, {}, 0x40bfc5 if mode == 'TFT' else None)
        if mode == 'TFT':
            node = n.u.reg_read(r.UC_X86_REG_R8)
            callback = n.q(node+0x40)
            if n.u32(node+0x10) != 0xb8ffaf71 or n.q(callback+8) != n.base+0x91fec0:
                raise ValueError('Mode registry selected another subsystem factory')
        modes.append({'suppliedMode': mode, 'tftFactorySelected': mode == 'TFT',
                      'subsystemFactoryExecuted': False})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in NativeUnitBaseContexts.__mro__ if c is not object]}
    ranges = [(0x625dac, 0x625dbc), (0x93162e, 0x931642), (0x9239ba, 0x923a15),
              (0x40be50, 0x40c080), (0x620940, 0x620950), (0x23456c0, 0x23456f0),
              (0x91fec0, 0x91fef0), (0x2364340, 0x23643a0), (0x910710, 0x910870)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original subsystem activation code differs from executable')
    result = {'schema': 1, 'kind': 'original-resource-overlay-activation-observations',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image),
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'originalBlocks': list(n.blocks.values()), 'states': states, 'modes': modes,
        'registration': {'modeKey': 0xb8ffaf71, 'factoryRva': 0x91fec0,
                         'updateRva': 0x910710, 'updateResourceManagerRvas': [0x931620, 0x349fc0, 0x9c0740]},
        'counts': {'gameStateCases': len(states), 'configuredModeCases': len(modes)},
        'scope': {'originalGameStateDecodeExecuted': True, 'originalStateGateExecuted': True,
                  'originalModeRegistryInsertionExecuted': True, 'originalModeSelectionExecuted': True,
                  'suppliedModeStrings': True, 'matchModeDecoded': False,
                  'subsystemFactoryExecuted': False, 'liveOverlayAbsenceEstablished': False,
                  'otherOverlayProducersExcluded': False, 'mainViewerExpanded': False}}
    (cache/'research/resource-overlay-activation-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'counts': result['counts'], 'states': states, 'modes': modes}))


if __name__ == '__main__':
    main()
