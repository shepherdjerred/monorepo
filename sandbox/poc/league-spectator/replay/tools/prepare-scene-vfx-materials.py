"""Complete eligible material corpus from isolated original-selector workers."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys

from animation_runtime_identity import animation_runtime_identity
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'native', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if any(args.output.iterdir()):
        raise ValueError('Material authority requires a fresh empty owned output')
    for source in [args.package.resolve(), args.native.resolve(), args.client.resolve().parent]:
        if args.output.resolve().is_relative_to(source) or source.is_relative_to(args.output.resolve()):
            raise ValueError('Material output overlaps original inputs')
    raw = (args.native/'manifest.json').read_bytes()
    native = json.loads(raw)
    if native['kind'] != 'original-scene-vfx-native-authority' or native['nativeSpectatorAdmitted']:
        raise ValueError('Complete original native VFX authority required')
    eligible = [entry for entry in native['emitters'] if entry['status'] == 'native-bound-quad-prepared']
    if not eligible:
        raise ValueError('No exact native material source graphs')
    runtime = animation_runtime_identity()
    observer = Path(__file__).with_name('observe-scene-vfx-materials.py')
    source_paths = {Path(__file__), observer, Path(__file__).with_name('animation_runtime_identity.py'), Path(__file__).with_name('macho.py')}
    source_paths.update(Path(inspect.getfile(base)) for base in NativeVfxMaterial.__mro__ if base is not object)
    sources = {path.name: sha(path.read_bytes()) for path in sorted(source_paths)}
    worker_sources = {name: digest for name, digest in sources.items() if name != Path(__file__).name}
    parts = args.output/'parts'
    parts.mkdir()
    starts = list(range(0, len(eligible), 100))
    env = {key: value for key, value in os.environ.items() if key != 'OP_SERVICE_ACCOUNT_TOKEN'}

    def run_worker(start):
        output = parts/f'{start:06d}.json'
        count = min(100, len(eligible)-start)
        subprocess.run([sys.executable, str(observer), str(args.package), str(args.client), str(args.native), str(output), '--start', str(start), '--limit', str(count)], check=True, env=env)
        return output

    records, children, catalog, catalog_ids, blocks, statuses = [], [], [], {}, {}, Counter()
    executor = ThreadPoolExecutor(max_workers=2)
    pending = {start: executor.submit(run_worker, start) for start in starts[:2]}
    try:
        for position, start in enumerate(starts):
            output = pending.pop(start).result()
            child_bytes = output.read_bytes()
            child = json.loads(child_bytes)
            count = min(100, len(eligible)-start)
            if child['nativeAuthoritySha256'] != sha(raw) or child['runtime'] != runtime or child['sources'] != worker_sources or child['start'] != start or child['limit'] != count or child['eligibleGraphs'] != len(eligible) or len(child['emitters']) != count:
                raise ValueError('Incomplete or changed original material worker corpus')
            remap = {}
            for index, value in enumerate(child['resultCatalog']):
                key = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
                if key not in catalog_ids:
                    catalog_ids[key] = len(catalog)
                    catalog.append(value)
                remap[index] = catalog_ids[key]
            for actual, expected in zip(child['emitters'], eligible[start:start+count], strict=True):
                graph = expected['resources']['boundQuad']
                if actual['effectId'] != expected['effectId'] or actual['emitterIndex'] != expected['emitterIndex'] or actual['sourceDefinitionSha256'] != expected['sourceDefinitionSha256'] or actual['graphSha256'] != graph['sha256'] or actual['graphFile'] != graph['file']:
                    raise ValueError('Original material worker graph identity differs')
                if actual['status'] == 'original-material-selector-observed':
                    if len(actual['probes']) != 17:
                        raise ValueError('Original material controlled predicate inventory incomplete')
                    actual = {**actual, 'probes': [{**probe, 'result': remap[probe['result']]} for probe in actual['probes']]}
                elif actual['status'] != 'unsupported-original-custom-material-factory':
                    raise ValueError('Unknown original material capability boundary')
                records.append(actual)
                statuses[actual['status']] += 1
            for block in child['originalBlocks']:
                if block['rva'] in blocks and blocks[block['rva']] != block:
                    raise ValueError('Original material instruction hash differs between workers')
                blocks[block['rva']] = block
            children.append({'file': 'parts/'+output.name, 'bytes': len(child_bytes), 'sha256': sha(child_bytes)})
            print(json.dumps({'prepared': len(records), 'total': len(eligible), 'statuses': dict(statuses)}), flush=True)
            if position+2 < len(starts):
                following = starts[position+2]
                pending[following] = executor.submit(run_worker, following)
    finally:
        for future in pending.values():
            future.cancel()
        executor.shutdown(wait=True, cancel_futures=True)
    if (args.native/'manifest.json').read_bytes() != raw or animation_runtime_identity() != runtime:
        raise ValueError('Original material/native authority changed during preparation')
    for source in source_paths:
        if sha(source.read_bytes()) != sources[source.name]:
            raise ValueError('Original material evaluator source changed')
    for entry in children:
        data = (args.output/entry['file']).read_bytes()
        if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
            raise ValueError('Original material child proof changed before publication')
    result = {'schema': 1, 'kind': 'original-scene-vfx-material-authority', 'build': native['build'], 'protocol': native['protocol'],
        'sceneManifestSha256': native['sceneManifestSha256'], 'effectsManifestSha256': native['effectsManifestSha256'],
        'nativeAuthoritySha256': sha(raw), 'sources': sources, 'runtime': runtime, 'emitters': records,
        'resultCatalog': catalog, 'statuses': dict(statuses), 'originalBlocks': list(blocks.values()), 'children': children,
        'files': children, 'scope': {'completeEligibleGraphInventory': True, 'completeInputDispositions': False,
            'boundedOriginalSelectorWorkers': True, 'actualScenePredicates': False, 'resourceAcquisition': False,
            'materialFactory': False, 'shaderSubmission': False, 'matchActivation': False}, 'nativeSpectatorAdmitted': False}
    (args.output/'manifest.json').write_text(json.dumps(result, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'eligibleGraphs': len(records), 'resultCatalog': len(catalog), 'statuses': dict(statuses), 'nativeSpectatorAdmitted': False}), flush=True)


if __name__ == '__main__':
    main()
