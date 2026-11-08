"""Prepare full CameraTrail assets separately from the frozen decoder profile."""
import argparse
import inspect
import json
from collections import Counter
from pathlib import Path

from trail_particle_native import NativeTrailParticles
from vfx_loaded_quad_native import LoadedQuadAdmissionError
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    decoder = cache / 'public/decoder-16.21-macos'
    native = NativeTrailParticles(decoder, args.client)
    post = native.checked_json('vfx-postload.json', 'vfxPostloadSha256')
    bound = native.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    output = cache / 'public/latest-trail-particles'
    (output / 'graphs').mkdir(parents=True, exist_ok=True)
    templates, rejected = [], []
    for key, ref in post['emitters'].items():
        raw = (decoder / ref['file']).read_bytes()
        if sha(raw) != ref['sha256']:
            raise ValueError('Trail post-load graph changed')
        state = json.loads(raw)
        try:
            graph = native.prepare_trail(state)
        except LoadedQuadAdmissionError as error:
            rejected.append({'key': key, 'reason': str(error)})
            continue
        if graph['assetObjectHex'] != state['objectHex'] or graph['segments'][1]['bytesHex'] != state['heapHex']:
            raise ValueError('Complete trail asset changed')
        graph.update({'build': native.profile['clientVersion'], 'protocol': native.profile['protocolDigest'],
            'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
            'sourceDefinitionSha256': ref['definitionSha256'], 'postloadGraphSha256': ref['sha256']})
        raw = json.dumps(graph, separators=(',', ':'), allow_nan=False).encode()
        digest = sha(raw)
        (output / 'graphs' / f'{digest}.json').write_bytes(raw)
        templates.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
            'sourceDefinitionSha256': ref['definitionSha256'], 'postloadGraphSha256': ref['sha256'],
            'file': f'graphs/{digest}.json', 'sha256': digest, 'bytes': len(raw),
            'primitiveKind': graph['primitiveKind'], 'uvFlags': graph['uvFlags'],
            'hasMultDefinition': graph['hasMultDefinition']})
    dependencies = {Path(inspect.getfile(cls)) for cls in NativeTrailParticles.__mro__ if cls is not object}
    dependencies.update([Path(__file__), Path(__file__).with_name('macho.py')])
    blocks = [(0x1756780, 0x1756a26), (0x1757f10, 0x1758a70),
        (0x1737570, 0x17394f0), (0x16e1d6d, 0x16e2396), (0x23f6520, 0x23f6650)]
    meta = {'schema': 1, 'kind': 'complete-native-camera-trails',
        **{k: native.profile[k] for k in ['sliceSha256', 'decoderImageSha256',
            'vfxBoundQuadsSha256', 'vfxPostloadSha256', 'vfxSpawnSha256', 'vfxEmitterSha256']},
        'build': native.profile['clientVersion'], 'protocol': native.profile['protocolDigest'],
        'runtimeSha256': bound['runtimeSha256'], 'frameRva': 0x1757f10,
        'writerRva': 0x1737570, 'primitiveVtableRva': 0x23f6520,
        'maximumParticles': 1024, 'texturePresenceMarker': bound['texturePresenceMarker'],
        'initializedGlobals': bound['initializedGlobals'], 'templates': templates,
        'rejected': rejected, 'rejectionCounts': dict(Counter(x['reason'] for x in rejected)),
        'counts': {'sourceEmitters': len(post['emitters']), 'preparedEmitters': len(templates)},
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(native.image[a:b])} for a, b in blocks],
        'compilerSources': {p.name: sha(p.read_bytes()) for p in sorted(dependencies)},
        'scope': {'completePostloadedAsset': True, 'assetBytesUnchanged': True,
            'sceneInputsSupplied': True, 'materialAcquisition': False, 'fullEffectActivation': False,
            'mainViewerIntegrated': False, 'referencePixelsCompared': False}}
    raw = json.dumps(meta, indent=2).encode()
    (output / 'package.json').write_bytes(raw)
    print(json.dumps({'packageSha256': sha(raw), 'counts': meta['counts'], 'rejections': meta['rejectionCounts']}))


if __name__ == '__main__':
    main()
