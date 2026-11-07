"""Verify the complete original RelativeTeamColors startup constructor."""
import argparse
import inspect
import json
from pathlib import Path
from native_ai_unit_fixture import NativeAIUnitFixture
from legacy_effect_native import NativeLegacyEffectInputs
from relative_team_colors_native import initialize_relative_team_colors
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, NativeLegacyEffectInputs)
    n = fixture.native
    state = initialize_relative_team_colors(n)
    try:
        initialize_relative_team_colors(n)
    except ValueError:
        duplicate_rejected = True
    else:
        raise ValueError('Duplicate startup service initialization was accepted')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_relative_team_colors)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-relative-team-colors-startup-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'state': state, 'duplicateRejected': duplicate_rejected,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalConstructorAndGettersExecuted': True,
                        'modeFlagsChangedByHost': False, 'matchAppearanceVerified': False}}
    output = fixture.cache / 'research/relative-team-colors-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'state': state, 'duplicateRejected': duplicate_rejected}))
    n.close_files()


if __name__ == '__main__':
    main()
