"""Trace complete original navgrid loading before accepting world readiness."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world
from vfx_spawn_native import sha


class Control(NativeNavgridStream, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    result, boundary = None, None
    try:
        result = initialize_navgrid_world(fixture)
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                  for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    stream = n.navgrid_stream
    report = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'result': result, 'boundary': boundary,
              'loader': getattr(n, 'navgrid_world_observation', None),
              'stream': {k: v for k, v in stream.items() if k != 'bytes'} if stream else None,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'completeOriginalNavgridLoad': boundary is None,
                        'readinessBitsSupplied': False, 'ownerContextRecovered': False,
                        'acceptedReplayEntities': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/navgrid-world-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'result': result, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
