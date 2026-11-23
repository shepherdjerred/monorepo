"""Original material selectors on explicit scene graphs; no profile mutation."""
import argparse
from collections import Counter
import inspect
import json
from pathlib import Path
import struct

from animation_runtime_identity import animation_runtime_identity
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'native', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--start', type=int, required=True)
    parser.add_argument('--limit', type=int, required=True)
    args = parser.parse_args()
    if args.output.exists() or not 1 <= args.limit <= 100:
        raise ValueError('Fresh bounded native material output required')
    root = args.native.resolve()
    manifest_path = root/'manifest.json'
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest['kind'] not in ['original-scene-vfx-native-authority', 'original-scene-vfx-native-worker'] or manifest['nativeSpectatorAdmitted']:
        raise ValueError('Explicit original scene native graph authority required')
    candidates = [entry for entry in manifest['emitters'] if entry['status'] == 'native-bound-quad-prepared']
    if not 0 <= args.start < len(candidates):
        raise ValueError('Material worker start exceeds complete eligible graph inventory')
    runtime = animation_runtime_identity()
    sources = {Path(__file__), Path(__file__).with_name('animation_runtime_identity.py'), Path(__file__).with_name('macho.py')}
    sources.update(Path(inspect.getfile(base)) for base in NativeVfxMaterial.__mro__ if base is not object)
    source_hashes = {path.name: sha(path.read_bytes()) for path in sorted(sources)}
    n = NativeVfxMaterial(args.package, args.client)
    n.call(0x14aa3bf, {}, end=0x14aa5f9)
    inputs = {str(manifest_path): sha(manifest_raw)}
    for path in [args.package/'profile.json', args.package/'image.bin', args.client]:
        inputs[str(path.resolve())] = sha(path.read_bytes())
    catalog, catalog_ids, records, statuses = [], {}, [], Counter()
    for entry in candidates[args.start:args.start+args.limit]:
        ref = entry['resources']['boundQuad']
        path = (root/ref['file']).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Original material graph escaped selected native root')
        raw = path.read_bytes()
        if len(raw) != ref['bytes'] or sha(raw) != ref['sha256']:
            raise ValueError('Original material graph source changed')
        inputs[str(path)] = sha(raw)
        graph = json.loads(raw)
        if graph['effectId'] != entry['effectId'] or graph['emitterIndex'] != entry['emitterIndex'] or graph['sourceDefinitionSha256'] != entry['sourceDefinitionSha256']:
            raise ValueError('Original native material graph identity differs')
        record = {'effectId': entry['effectId'], 'emitterIndex': entry['emitterIndex'],
            'sourceDefinitionSha256': entry['sourceDefinitionSha256'], 'graphFile': ref['file'], 'graphSha256': ref['sha256'], 'primitiveKind': graph['primitiveKind']}
        obj = bytes.fromhex(graph['assetObjectHex'])
        if len(obj) != 0x470:
            raise ValueError('Original material root object size differs')
        if struct.unpack_from('<Q', obj, 0x68)[0]:
            record.update(status='unsupported-original-custom-material-factory', reason='Native custom-material acquisition has not executed')
            records.append(record)
            statuses[record['status']] += 1
            continue
        n.prepare_material(graph)
        parameters, samplers, erosion = n.parameters(), n.samplers(), n.erosion_parameters(.5)
        mask = sum(1 << bit for bit, offset in enumerate([0x230, 0x48, 0x40]) if struct.unpack_from('<Q', obj, offset)[0])
        baseline = {'pass': 0, 'featuresEnabled': True, 'resourceMask': 0,
            'systemFogMode': 0, 'graphics34b': False, 'graphics29c': 0}
        cases = [dict(baseline, resourceMask=value) for value in range(8)]
        cases += [dict(baseline, resourceMask=mask, **extra) for extra in
            [{'pass': value} for value in range(1, 7)] + [{'featuresEnabled': False},
            {'systemFogMode': 1}, {'graphics34b': True, 'graphics29c': 2}]]
        probes = []
        for case in cases:
            result = {'selection': n.select(case), 'renderState': n.render_state(case['pass'])}
            key = json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False)
            if key not in catalog_ids:
                catalog_ids[key] = len(catalog)
                catalog.append(result)
            probes.append({'input': case, 'result': catalog_ids[key]})
        n.finish()
        record.update(status='original-material-selector-observed', definedObjectMask=mask,
            parameters=parameters, samplers=samplers, erosionAtSuppliedDrive=.5 if erosion else None,
            erosionParameters=erosion, probes=probes)
        records.append(record)
        statuses[record['status']] += 1
    for source in sources:
        if sha(source.read_bytes()) != source_hashes[source.name]:
            raise ValueError('Original native material evaluator source changed')
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original material/native source input changed')
    if animation_runtime_identity() != runtime:
        raise ValueError('Original material evaluator runtime identity changed')
    result = {'schema': 1, 'kind': 'original-scene-vfx-material-observations', 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'nativeAuthoritySha256': sha(manifest_raw), 'runtime': runtime,
        'sources': source_hashes, 'inputs': inputs,
        'originalBlocks': list(n.material_blocks.values()), 'initializer': {'range': [0x14aa3bf, 0x14aa5f9], 'sha256': sha(n.image[0x14aa3bf:0x14aa5f9])},
        'start': args.start, 'limit': args.limit, 'eligibleGraphs': len(candidates), 'emitters': records,
        'resultCatalog': catalog, 'statuses': dict(statuses),
        'scope': {'partialCorpus': True, 'originalSelectorsExecuted': True, 'completeAssetBytesRetained': True,
            'resourceAcquisition': False, 'materialFactory': False, 'shaderSubmission': False,
            'actualScenePredicates': False, 'matchActivation': False, 'nativeRendererAdmitted': False},
        'nativeSpectatorAdmitted': False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
    print(json.dumps({'output': str(args.output), 'emitters': len(records), 'statuses': dict(statuses), 'nativeSpectatorAdmitted': False}), flush=True)


if __name__ == '__main__':
    main()
