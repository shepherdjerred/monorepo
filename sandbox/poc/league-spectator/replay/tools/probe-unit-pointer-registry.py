"""Verify original registry startup and keyed pointer emplace controls."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from unit_pointer_registry_native import initialize_unit_pointer_registry
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    setup, controls, boundary = {}, [], None
    phase = 'original-startup'
    try:
        setup = initialize_unit_pointer_registry(n)
        obj = setup['object']
        values = [n.allocate(8), n.allocate(8)]
        source = n.allocate(8)
        expected = {}
        phase = 'supplied-pointer-emplace-controls'
        for key, value in [(0x12340001, values[0]), (0x12340002, values[1]), (0x12340001, values[1])]:
            n.put(source, 'Q', value)
            n.call(0x2f3560, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: key, r.UC_X86_REG_RDX: source})
            expected.setdefault(key, value)
            node = n.q(obj + 0x50)
            observed, seen = {}, set()
            while node:
                if node in seen or len(seen) >= 16 or n.allocations.get(node) != 0x20:
                    raise ValueError('Original emplace nodes escaped bounded owned linked storage')
                seen.add(node)
                observed[n.u32(node + 0x10)] = n.q(node + 0x18)
                node = n.q(node)
            if observed != expected or n.q(obj + 0x58) != len(expected):
                raise ValueError('Original keyed pointer emplace or duplicate retention differs')
            controls.append({'key': key, 'pointer': value, 'entries': observed,
                             'count': len(expected), 'suppliedControlIdentity': True})
    except Exception as error:
        boundary = {'phase': phase, 'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_unit_pointer_registry)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    output = fixture.cache / 'research/unit-pointer-registry-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'setup': setup, 'controls': controls, 'boundary': boundary,
        'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()), 'scope': {
            'originalStartupCompleted': bool(setup), 'originalEmplaceVerified': len(controls) == 3 and boundary is None,
            'suppliedOpaquePointerControls': True, 'eventDispatchVerified': False,
            'acceptedReplayEntity': False, 'mainViewerExpanded': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'setup': setup, 'controls': len(controls), 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
