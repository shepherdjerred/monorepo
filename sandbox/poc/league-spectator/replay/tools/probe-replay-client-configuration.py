"""Check original ROFL configuration construction without supplying mode fields."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from replay_client_configuration_native import initialize_replay_client_configuration
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    paths = {Path(__file__), Path(inspect.getfile(initialize_replay_client_configuration)),
             Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    rejects = []
    for value in [None, '', 'fixture.txt', 'fixture\0.rofl', '\u00e9.rofl', 'a' * 1019 + '.rofl']:
        before = n.next_heap
        try:
            initialize_replay_client_configuration(n, value)
        except ValueError:
            rejects.append({'input': repr(value), 'allocationUnchanged': n.next_heap == before})
        else:
            raise ValueError('Invalid launch input was admitted')
        if n.next_heap != before or n.q(n.base + 0x24705d0):
            raise ValueError('Invalid launch input changed original state')
    setup = initialize_replay_client_configuration(n, 'controlled-fixture.rofl')
    before = n.next_heap
    try:
        initialize_replay_client_configuration(n, 'controlled-fixture.rofl')
    except ValueError:
        rejects.append({'input': 'duplicate-initialization', 'allocationUnchanged': n.next_heap == before})
    else:
        raise ValueError('Duplicate client configuration was admitted')
    if n.next_heap != before:
        raise ValueError('Duplicate initialization allocated data')
    unit = fixture.construct_ai()
    controls = []
    for override in [False, True]:
        if override:
            n.call(0x21b670, {r.UC_X86_REG_RDI: unit + 0x1e0})
        n.call(0x213c00, {r.UC_X86_REG_RDI: unit + 0x1e0, r.UC_X86_REG_RSI: 0})
        result = n.u.reg_read(r.UC_X86_REG_RAX) & 255
        if result != 0 or n.u32(setup['object'] + 8) != 3:
            raise ValueError('Original ROFL query used the mode-zero override')
        controls.append({'originalOverrideSetterExecuted': override, 'queryResult': result})
    fixture.check_guard(unit)
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Replay configuration producer changed: ' + path)
    for path, digest in list(fixture.inputs.items()):
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Replay configuration input changed: ' + path)
    output = fixture.cache / 'research/replay-client-configuration-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'setup': setup, 'controls': controls,
        'rejects': rejects, 'sources': sources, 'inputs': fixture.inputs,
        'originalBlocks': list(n.blocks.values()),
        'scope': {'suppliedLaunchPath': True, 'modeFieldsWrittenByHost': False,
                  'remainingCommandLinePassExecuted': False,
                  'actualClientPreferencesRecovered': False, 'mainProbeIntegrated': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'rejects': len(rejects)}))


if __name__ == '__main__':
    main()
