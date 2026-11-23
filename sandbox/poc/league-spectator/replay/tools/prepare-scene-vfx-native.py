"""Output-only complete original field/postload/quad inputs in bounded workers."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys

from vfx_asset_native import UnsupportedAssetClass
from vfx_postload_native import NativeVfxPostload
from vfx_bound_quad_native import NativeBoundQuad, LoadedQuadAdmissionError
from vfx_spawn_native import sha


def encoded(value):
    return json.dumps(value, separators=(',', ':'), allow_nan=False).encode()


def globals_changed(owner):
    start = 0x1fef000
    before = bytes(owner.u.mem_read(owner.base+start, len(owner.image)-start))
    owner.call(0x14aa3bf, {}, end=0x14aa5f9)
    after = bytes(owner.u.mem_read(owner.base+start, len(owner.image)-start))
    segments = []
    for index, (left, right) in enumerate(zip(before, after)):
        if left == right:
            continue
        at = start+index
        if segments and segments[-1]['rva']+len(bytes.fromhex(segments[-1]['bytesHex'])) == at:
            segments[-1]['bytesHex'] += bytes([right]).hex()
        else:
            segments.append({'rva': at, 'bytesHex': bytes([right]).hex()})
    return segments


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'fields', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    root = args.fields.resolve()
    manifest_bytes = (root/'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest['kind'] != 'original-scene-vfx-field-inputs' or manifest['nativeSpectatorAdmitted']:
        raise ValueError('Exact original VFX field inputs required')
    files = {entry['file']: entry for entry in manifest['files']}
    consumed = {str(root/'manifest.json'): sha(manifest_bytes)}

    def read(file):
        path = (root/file).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Native VFX input escaped its owned source root')
        data = path.read_bytes()
        expected = files[file]
        if len(data) != expected['bytes'] or sha(data) != expected['sha256']:
            raise ValueError('Original native VFX input changed')
        consumed[str(path)] = sha(data)
        return data

    request = json.loads(read(manifest['input']))
    source_paths = {Path(__file__)}
    for kernel in [NativeVfxPostload, NativeBoundQuad]:
        source_paths.update(Path(inspect.getfile(base)) for base in kernel.__mro__ if base is not object)
    sources = {path.name: sha(path.read_bytes()) for path in sorted(source_paths)}
    if args.limit is None:
        if args.start or any(args.output.iterdir()):
            raise ValueError('Native VFX output must be a fresh empty owned directory')
        for source in [args.package.resolve(), args.fields.resolve(), args.client.resolve().parent]:
            if args.output.resolve().is_relative_to(source) or source.is_relative_to(args.output.resolve()):
                raise ValueError('Native VFX outputs must be disjoint from original inputs')
        parts = args.output/'parts'
        parts.mkdir()
        children, records, blocks, statuses, initialized, inventory = [], [], {}, Counter(), None, {}
        env = {key: value for key, value in os.environ.items() if key != 'OP_SERVICE_ACCOUNT_TOKEN'}
        executor = ThreadPoolExecutor(max_workers=2)
        pending = {}
        def run_worker(start):
            count = min(100, len(request['emitters'])-start)
            output = parts/f'{start:06d}'
            subprocess.run([sys.executable, str(Path(__file__).resolve()), str(args.package), str(args.client), str(args.fields), str(output), '--start', str(start), '--limit', str(count)], check=True, env=env)
            return output
        starts = list(range(0, len(request['emitters']), 100))
        for start in starts[:2]:
            pending[start] = executor.submit(run_worker, start)
        try:
          for position, start in enumerate(starts):
            count = min(100, len(request['emitters'])-start)
            output = pending.pop(start).result()
            child_bytes = (output/'manifest.json').read_bytes()
            child = json.loads(child_bytes)
            if child['inputManifestSha256'] != sha(manifest_bytes) or child['sources'] != sources or len(child['emitters']) != count or [entry['inputIndex'] for entry in child['emitters']] != list(range(start, start+count)):
                raise ValueError('Incomplete or changed native VFX worker closure')
            if initialized is None:
                initialized = child['initializer']
            elif initialized != child['initializer']:
                raise ValueError('Native VFX worker initializer identity differs')
            prefix = f'parts/{start:06d}/'
            for record in child['emitters']:
                for resource in record.get('resources', {}).values():
                    resource_bytes = (output/resource['file']).read_bytes()
                    if len(resource_bytes) != resource['bytes'] or sha(resource_bytes) != resource['sha256']:
                        raise ValueError('Native VFX worker output readback differs')
                    target = prefix+resource['file']
                    inventory[target] = {'file': target, 'bytes': len(resource_bytes), 'sha256': sha(resource_bytes)}
            records.extend([{**entry, 'resources': {role: {**resource, 'file': prefix+resource['file']} for role, resource in entry.get('resources', {}).items()}} for entry in child['emitters']])
            statuses.update(entry['status'] for entry in child['emitters'])
            for block in child['originalBlocks']:
                if block['rva'] in blocks and blocks[block['rva']] != block:
                    raise ValueError('Original VFX worker instruction hash changed')
                blocks[block['rva']] = block
            children.append({'file': prefix+'manifest.json', 'bytes': len(child_bytes), 'sha256': sha(child_bytes)})
            inventory[prefix+'manifest.json'] = children[-1]
            print(json.dumps({'prepared': len(records), 'total': len(request['emitters']), 'statuses': dict(statuses)}), flush=True)
            if position+2 < len(starts):
                following = starts[position+2]
                pending[following] = executor.submit(run_worker, following)
        finally:
            for future in pending.values():
                future.cancel()
            executor.shutdown(wait=True, cancel_futures=True)
        for path in source_paths:
            if sha(path.read_bytes()) != sources[path.name]:
                raise ValueError('Native VFX producer changed during complete preparation')
        for file in files:
            read(file)
        for file, digest in consumed.items():
            if sha(Path(file).read_bytes()) != digest:
                raise ValueError('Native VFX input authority changed during complete preparation')
        result = {'schema': 1, 'kind': 'original-scene-vfx-native-authority', 'build': request['build'], 'protocol': request['protocol'],
            'sceneManifestSha256': request['sceneManifestSha256'], 'effectsManifestSha256': request['effectsManifestSha256'],
            'inputManifestSha256': sha(manifest_bytes), 'sources': sources, 'initializer': initialized,
            'emitters': records, 'children': children, 'files': list(inventory.values()), 'statuses': dict(statuses), 'originalBlocks': list(blocks.values()),
            'scope': {'completeInputInventory': True, 'originalFieldReader': True, 'originalPostload': True,
                'fullPristineMathInitializer': True, 'nativeQuadConstructionUnderSuppliedUnitEnvironment': True,
                'assetLoading': False, 'materialAcquisition': False, 'shaderSubmission': False,
                'dynamicStateProgram': False, 'matchActivation': False}, 'nativeSpectatorAdmitted': False}
        (args.output/'manifest.json').write_bytes(encoded(result))
        print(json.dumps({'output': str(args.output), 'emitters': len(records), 'statuses': dict(statuses), 'nativeSpectatorAdmitted': False}), flush=True)
        return
    if not 1 <= args.limit <= 100 or not 0 <= args.start < len(request['emitters']):
        raise ValueError('Bounded native VFX worker range required')
    args.output.mkdir(parents=True, exist_ok=False)
    field_kernel = NativeVfxPostload(args.package, args.client)
    quad_kernel = NativeBoundQuad(args.package, args.client)
    initializer = {'range': [0x14aa3bf, 0x14aa5f9], 'sourceSha256': sha(field_kernel.image[0x14aa3bf:0x14aa5f9]),
        'fieldsGlobals': globals_changed(field_kernel), 'quadGlobals': globals_changed(quad_kernel)}
    native_inputs = {str(path.resolve()): sha(path.read_bytes()) for path in [args.package/'profile.json', args.package/'image.bin', args.client]}
    records = []

    def write(file, value):
        data = encoded(value)
        (args.output/file).write_bytes(data)
        return {'file': file, 'bytes': len(data), 'sha256': sha(data)}

    for input_index in range(args.start, min(len(request['emitters']), args.start+args.limit)):
        entry = request['emitters'][input_index]
        record = {'inputIndex': input_index, 'effectId': entry['effectId'], 'emitterIndex': entry['emitterIndex'],
            'kind': entry['kind'], 'classHash': entry['classHash'], 'sourceDefinitionSha256': entry['definitionSha256'],
            'sourceBinSha256': entry['binSha256'], 'resources': {}}
        if entry['kind'] != 'complex' or entry['classHash'] != '09cde442':
            record.update(status='unsupported-original-emitter-class', reason='This native helper admits only the original complex-emitter root class')
            records.append(record)
            continue
        data = read(entry['binFile'])
        if sha(data) != entry['binSha256']:
            raise ValueError('Original VFX source BIN changed')
        fields = []
        for span in entry['fields']:
            if not 0 <= span['offset'] < span['offset']+span['bytes'] <= len(data):
                raise ValueError('Original VFX field span exceeds source bounds')
            field = data[span['offset']:span['offset']+span['bytes']]
            if len(field) != span['bytes'] or sha(field) != span['sha256'] or len(field) < 5 or int.from_bytes(field[:4], 'little') != int(span['fieldHash'], 16):
                raise ValueError('Complete original VFX field span differs')
            fields.append(field)
        try:
            before = field_kernel.load(fields)
        except UnsupportedAssetClass as error:
            record.update(status='unsupported-original-asset-class', reason=str(error))
            records.append(record)
            continue
        before.update(schema=1, build=request['build'], protocol=request['protocol'], phase='serialized-fields-before-postload')
        record['resources']['fields'] = write(f'{input_index}-fields.json', before)
        after = field_kernel.postload()
        after.update(schema=1, build=request['build'], protocol=request['protocol'], phase='native-postload-callbacks-executed')
        record['resources']['postload'] = write(f'{input_index}-postload.json', after)
        field_kernel.restore_preload_arena()
        record.update(nativeIgnoredFields=before['ignored'], nativeTypeMismatches=before['mismatched'])
        if after['pendingLinkFixups'] or after['mathCalls']:
            record.update(status='unsupported-native-quad-postload-boundary', reason='Original postload retains resource/link or external-math boundaries', pendingLinkFixups=after['pendingLinkFixups'], mathCalls=after['mathCalls'])
            records.append(record)
            continue
        try:
            graph = quad_kernel.prepare_bound(after)
        except LoadedQuadAdmissionError as error:
            record.update(status='unsupported-native-quad-environment', reason=str(error))
            records.append(record)
            continue
        graph.update(build=request['build'], protocol=request['protocol'], effectId=entry['effectId'], emitterIndex=entry['emitterIndex'], sourceDefinitionSha256=entry['definitionSha256'], postloadGraphSha256=record['resources']['postload']['sha256'])
        record['resources']['boundQuad'] = write(f'{input_index}-quad.json', graph)
        record['status'] = 'native-bound-quad-prepared'
        records.append(record)
    for file, digest in {**consumed, **native_inputs}.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original VFX input changed during worker execution')
    for source in source_paths:
        if sha(source.read_bytes()) != sources[source.name]:
            raise ValueError('Native VFX worker producer source changed')
    blocks = {block['rva']: block for owner in [field_kernel, quad_kernel] for block in owner.blocks.values()}
    result = {'schema': 1, 'kind': 'original-scene-vfx-native-worker', 'build': request['build'], 'protocol': request['protocol'],
        'decoderImageSha256': sha(field_kernel.image), 'inputManifestSha256': sha(manifest_bytes), 'sources': sources,
        'initializer': initializer, 'emitters': records, 'originalBlocks': list(blocks.values()), 'inputs': {**consumed, **native_inputs}, 'nativeSpectatorAdmitted': False}
    (args.output/'manifest.json').write_bytes(encoded(result))


if __name__ == '__main__':
    main()
