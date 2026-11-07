"""Register a cold constructed AI client with the original local world index.

This supplies a control object, not a replay entity creation/acceptance route.
Local generation handles and network IDs remain distinct.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from ai_client_native import NativeAIClientInputs
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha
from ai_world_registration_native import register_control


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, NativeAIClientInputs)
    n = fixture.native
    boundary = None
    registered = None
    try:
        n.initialize_audio_facade()
        n.initialize_ui_data_prefix()
        unit = n.allocate(0x4100)
        n.u.mem_write(unit + 0x4000, b'\xa5' * 0x100)
        n.call(0xea3c0, {r.UC_X86_REG_RDI: unit})
        fixture.check_guard(unit)
        world = n.allocate(0x268)
        n.u.mem_write(world + 0x168, b'\xa5' * 0x100)
        n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
        registered = register_control(n, world, unit)
        if bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100:
            raise ValueError('Original local registration escaped its world allocation')
        fixture.check_guard(unit)
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'rva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    finally:
        if hasattr(n, 'close_files'):
            n.close_files()
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)), Path(inspect.getfile(register_control)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-cold-ai-local-world-registration',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'registration': registered, 'boundary': boundary, 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'coldControlObject': True, 'acceptedReplayEntity': False,
                        'appearanceExecuted': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/ai-world-registration-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'registration': registered, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
