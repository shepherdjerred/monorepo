"""Compare replay-composed full asset graph state/geometry with native code.

The browser's default host-math approximation is compared without tolerance.
Any disagreement remains an explicit result, not a skipped or corrected input.
"""
import argparse
import json
from pathlib import Path

from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['decoder', 'client', 'playback', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.playback.read_bytes()
    playback = json.loads(raw)
    root = Path(__file__).resolve().parent.parent
    for name, digest in playback['sources'].items():
        if sha((root / name).read_bytes()) != digest:
            raise ValueError(f'Composed playback source changed: {name}')
    for path, digest in playback['inputs'].items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError(f'Composed playback input changed: {path}')
    if playback['inspectorSha256'] != sha(Path(__file__).with_name('inspect-bound-vfx-playback.mjs').read_bytes()):
        raise ValueError('Composed playback inspector changed')
    native = NativeBoundQuad(args.decoder, args.client)
    meta = native.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    if playback['runtime']['definitionSha256'] != native.profile['vfxBoundQuadsSha256']:
        raise ValueError('Complete graph package differs')
    for name, digest in meta['compilerSources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError(f'Native full-graph preparer changed: {name}')
    graphs, observations, mismatches = {}, [], []
    frames = live = empty = geometry_checks = 0
    for index, sample in enumerate(playback['samples']):
        digest = sample['graphSha256']
        if digest not in graphs:
            ref = next(entry for entry in meta['templates'] if entry['sha256'] == digest)
            data = (args.decoder / ref['file']).read_bytes()
            if sha(data) != digest:
                raise ValueError('Composed native graph changed')
            graphs[digest] = json.loads(data)
        native.reset_bound(graphs[digest], int(sample['seedHex'], 16), sample['quality'], meta)
        for value in sample['inputs']:
            output = native.frame_bound(value)
            frames += 1
        keys = ['vectors', 'rngHex', 'actorHex', 'poolHex']
        changed = [key for key in keys if output['state'][key] != sample['state'][key]]
        if output['state']['vectors']['life']['count']:
            live += 1
        else:
            empty += 1
        geometry_changed = []
        if 'geometry' in sample:
            geometry_checks += 1
            geometry_changed = [key for key in ['verticesHex', 'indicesHex', 'drawHex'] if output['geometry'][key] != sample['geometry'][key]]
        if changed or geometry_changed:
            mismatches.append({'sample': index, 'sequence': sample['sequence'], 'emitterIndex': sample['emitterIndex'], 'stateFields': changed, 'geometryFields': geometry_changed})
        observations.append({'sample': index, 'state': {key: output['state'][key] for key in keys},
            'geometry': output['geometry'] if 'geometry' in sample else None})
        if index % 100 == 0:
            print(json.dumps({'samples': index, 'frames': frames, 'mismatches': len(mismatches)}), flush=True)
    result = {'schema': 1, 'kind': 'native-complete-quad-replay-comparison', 'build': playback['build'], 'protocol': playback['protocol'],
        'playbackSha256': sha(raw), 'definitionSha256': native.profile['vfxBoundQuadsSha256'],
        'observerSha256': sha(Path(__file__).read_bytes()), 'sources': playback['sources'], 'compilerSources': meta['compilerSources'],
        'originalBlocks': list(native.blocks.values()), 'counts': {'graphs': len(graphs), 'samples': len(observations), 'frames': frames,
            'liveSamples': live, 'emptySamples': empty, 'geometryChecks': geometry_checks, 'mismatches': len(mismatches)},
        'mismatches': mismatches, 'observations': observations,
        'scope': {'zeroTolerance': True, 'defaultPreviewMathCompared': True, 'originalDarwinMathCompared': False,
            'suppliedInputs': playback['scope'], 'browserRun': False, 'shaderPixelsCompared': False, 'leagueReferenceCompared': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'counts': result['counts'], 'firstMismatches': mismatches[:4]}))


if __name__ == '__main__':
    main()
