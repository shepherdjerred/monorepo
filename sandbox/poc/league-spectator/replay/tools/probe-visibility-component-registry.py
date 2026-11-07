"""Verify original registry startup and isolated native component selection."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from visibility_component_registry_native import initialize_visibility_component_registry
from vfx_spawn_native import ADDRESSES, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    paths = {Path(__file__), Path(inspect.getfile(initialize_visibility_component_registry)),
             Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    setup = initialize_visibility_component_registry(n)
    rejected = False
    try:
        initialize_visibility_component_registry(n)
    except ValueError:
        rejected = True
    if not rejected:
        raise ValueError('Duplicate registry publication was admitted')
    units = {}
    for identity in [1, 0x4000003d, 0xffffffff]:
        unit = fixture.construct_ai()
        # Supplied identities exercise registry routing only. No native world
        # admission, packet acceptance or original network setter is claimed.
        n.put(unit + 0x78, 'I', identity)
        n.call(0x21b103, {r.UC_X86_REG_RBX: unit + 0x1e0,
                          r.UC_X86_REG_RSI: unit + 0x78,
                          r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, 0x21b19c)
        units[identity] = unit
    payload = n.allocate(32)
    controls = []
    for identity in units:
        before = {key: n.u.mem_read(unit + 0x201, 1)[0] for key, unit in units.items()}
        status = fixture.run_to(0x21b710, 0x21b75e,
            {r.UC_X86_REG_RDI: payload, r.UC_X86_REG_RSI: identity})
        after = {key: n.u.mem_read(unit + 0x201, 1)[0] for key, unit in units.items()}
        if after[identity] != 1 or any(after[key] != before[key] for key in units if key != identity):
            raise ValueError('Original registry prefix selected the wrong component')
        fixture.check_guard(units[identity])
        controls.append({'suppliedIdentity': identity, 'before': before, 'after': after,
                         'originalPrefixStatus': status})
    before = [n.u.mem_read(unit + 0x201, 1)[0] for unit in units.values()]
    status = fixture.run_to(0x21b710, 0x21b75e,
        {r.UC_X86_REG_RDI: payload, r.UC_X86_REG_RSI: 0}, allow_return=True)
    if status != 'handler-returned' or before != [n.u.mem_read(unit + 0x201, 1)[0] for unit in units.values()]:
        raise ValueError('Unknown registry identity changed a registered component')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Registry producer changed during execution: ' + path)
    output = fixture.cache / 'research/visibility-component-registry-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'setup': setup, 'controls': controls, 'unknownIdentityRejected': True,
        'duplicateStartupRejected': rejected, 'sources': sources, 'inputs': fixture.inputs,
        'originalBlocks': list(n.blocks.values()),
        'scope': {'suppliedNetworkIdentities': True, 'ownerPayloadCallbackExecuted': False,
                  'actualWorldAdmissionEstablished': False, 'replayVisibilityRecovered': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'registeredControls': len(controls),
                     'unknownIdentityRejected': True, 'duplicateStartupRejected': rejected}))


if __name__ == '__main__':
    main()
