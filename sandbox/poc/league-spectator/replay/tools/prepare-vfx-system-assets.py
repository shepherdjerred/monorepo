"""Prepare complete native system roots, preserving all embedded emitters.

Each bounded child process loads a batch through original constructors, property
readers and post-load callbacks. It emits static build-specific assets only.
"""
import argparse
from collections import Counter
import importlib.metadata
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys

from vfx_system_asset_native import NativeVfxSystemAssets, SYSTEM_TYPE
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']: parser.add_argument(name, type=Path)
    parser.add_argument('--batch-index', type=int)
    args = parser.parse_args()
    cache = args.cache.resolve(); decoder = cache / 'public/decoder-16.21-macos'
    effects = cache / 'public/latest-effects'; output = cache / 'public/latest-vfx-system-assets'
    work = cache / 'research/vfx-system-assets-batches'
    output.mkdir(exist_ok=True); (output / 'graphs').mkdir(exist_ok=True); work.mkdir(exist_ok=True)
    inputs = {}
    def read(path):
        raw = path.read_bytes(); inputs[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    manifest = read(effects / 'manifest.json'); source_package = read(effects / 'package.json')
    profile = read(decoder / 'profile.json'); asset_meta = read(decoder / 'vfx-assets.json')
    if (manifest['build'] != profile['clientVersion'] or manifest['protocol'] != profile['protocolDigest'] or
            inputs[str((decoder / 'vfx-assets.json').resolve())] != profile['vfxAssetsSha256'] or
            inputs[str((effects / 'manifest.json').resolve())] != asset_meta['effectsManifestSha256']):
        raise ValueError('Full-system asset provenance differs')
    keys = sorted(manifest['definitions']); batch_size = 40
    batch_count = (len(keys) + batch_size - 1) // batch_size
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in [
        'prepare-vfx-system-assets.py', 'vfx_system_asset_native.py', 'vfx_postload_native.py', *asset_meta['compilerSources']]}
    if args.batch_index is None:
        for index in range(batch_count):
            subprocess.run([sys.executable, str(Path(__file__).resolve()), str(cache), str(args.client.resolve()),
                '--batch-index', str(index)], check=True)
        systems, blocks, postload_blocks = {}, {}, {}; counts = Counter(); repeats = 0; batches = []
        for index in range(batch_count):
            path = work / f'batch-{index:03d}.json'; batch = read(path)
            if batch['sources'] != sources or batch['keys'] != keys[index * batch_size:(index + 1) * batch_size]:
                raise ValueError('Stale or incomplete system asset batch')
            for name, expected in batch['inputs'].items():
                if sha(Path(name).read_bytes()) != expected: raise ValueError('Batch input changed')
                inputs[name] = expected
            for key, ref in batch['systems'].items():
                if key in systems: raise ValueError('Duplicate full-system asset')
                systems[key] = ref
            counts.update(batch['counts']); repeats += batch['repeatedLoads']
            for table, rows in [(blocks, batch['originalBlocks']), (postload_blocks, batch['postloadBlocks'])]:
                for row in rows:
                    key = f"{row['rva']}:{row['size']}"
                    if key in table and table[key] != row: raise ValueError('Original code changed across asset batches')
                    table[key] = row
            batches.append({'file': str(path), 'sha256': sha(path.read_bytes())})
        if set(systems) != set(keys): raise ValueError('Full-system asset corpus missing a definition')
        package = {'schema': 1, 'kind': 'native-complete-vfx-system-assets', 'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
            'decoderImageSha256': profile['decoderImageSha256'], 'constructorImageSha256': profile['constructorImageSha256'],
            'sliceSha256': profile['sliceSha256'], 'effectsManifestSha256': inputs[str((effects / 'manifest.json').resolve())],
            'nativeAssetInventorySha256': profile['vfxAssetsSha256'], 'rootType': SYSTEM_TYPE, 'rootBytes': 0x160,
            'rootConstructorRva': 0x1786e80, 'fieldReaderRva': 0x14bc830, 'postloadRva': 0x14bc490,
            'systems': systems, 'summary': dict(counts), 'repeatedLoads': repeats, 'compilerSources': sources,
            'scope': {'completeSerializedRoot': True, 'originalPostloadCallbacks': True, 'parentOverridesPreserved': True,
                'resourceAcquisitionExecuted': False, 'runtimeFactoryExecuted': False, 'mainViewerIntegrated': False,
                'browserRun': False, 'leagueReferenceCompared': False}}
        raw = json.dumps(package, separators=(',', ':'), allow_nan=False).encode(); (output / 'package.json').write_bytes(raw)
        evidence = {'schema': 1, 'kind': 'native-complete-vfx-system-asset-observations', 'build': profile['clientVersion'],
            'packageSha256': sha(raw), 'inputs': inputs, 'sources': sources, 'batches': batches, 'counts': dict(counts),
            'repeatedLoads': repeats, 'originalBlocks': list(blocks.values()), 'postloadBlocks': list(postload_blocks.values()), 'scope': package['scope']}
        (cache / 'research/vfx-system-assets-native.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
        print(json.dumps({'packageSha256': sha(raw), 'counts': dict(counts), 'repeatedLoads': repeats}), flush=True)
        return
    index = args.batch_index
    if index < 0 or index >= batch_count: raise ValueError('Invalid full-system asset batch index')
    installed = json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))
    if installed['vcs_info']['commit_id'] != '3367589fdd3ee3d0d01383d2f98dba12b04d1371':
        raise ValueError('Unprepared typed BIN reader')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary, name in [(binfile.hashfile_binfields, 'binfields'), (binfile.hashfile_bintypes, 'bintypes')]:
        path = cache / 'vfx' / f'hashes.{name}.txt'
        if sha(path.read_bytes()) != manifest['toolchain']['dictionaries'][name]: raise ValueError('BIN dictionary changed')
        inputs[str(path)] = sha(path.read_bytes()); dictionary.hashes = names(path)
    for dictionary in [binfile.hashfile_binentries, binfile.hashfile_binhashes, binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]: dictionary.hashes = {}
    class Reader(binfile.BinReader):
        def __init__(self, *a): super().__init__(*a); self.spans = {}
        def read_field(self, htype):
            start = self.f.tell(); field = super().read_field(htype); self.spans[id(field)] = (start, self.f.tell()); return field
    n = NativeVfxSystemAssets(decoder, args.client)
    parsed, systems = {}, {}; counts = Counter(); repeated = 0
    for key in keys[index * batch_size:(index + 1) * batch_size]:
        ref = manifest['definitions'][key]; definition = read(effects / ref['file'])
        if inputs[str((effects / ref['file']).resolve())] != ref['sha256']: raise ValueError('Prepared effect definition changed')
        candidates = []
        for source in definition['sourceBins']:
            provenance = next(item for item in source_package['actors'][definition['actor']]['sourceBins'] if item['path'] == source)
            digest = provenance['sourceSha256']
            if digest not in parsed:
                path = cache / 'research/latest-effects/bins' / f"{digest}-{manifest['toolchain']['parserIdentity'][:16]}.bin"
                raw = path.read_bytes()
                if sha(raw) != digest: raise ValueError('Full-system raw BIN source changed')
                inputs[str(path)] = digest; stream = io.BytesIO(raw)
                if stream.read(4) != b'PROP': raise ValueError('Full-system reader requires unpatched PROP source')
                reader = Reader(stream); version, linked, types = reader.read_binfile_header()
                entries = {entry.path.h: entry for entry in [reader.read_binfile_entry(t) for t in types]}
                if stream.tell() != len(raw): raise ValueError('BIN source left trailing bytes')
                parsed[digest] = raw, reader, entries
            raw, reader, entries = parsed[digest]; entry = entries[int(definition['id'], 16)]
            if entry.type.h != SYSTEM_TYPE or json.loads(json.dumps(entry.to_serializable(), allow_nan=False)) != definition['definition']:
                raise ValueError('Full-system serialized entry differs from prepared definition')
            candidates.append((source, digest, raw, reader, entry))
        source, digest, raw, reader, entry = candidates[0]
        fields = [raw[a:z] for a,z in [reader.spans[id(field)] for field in entry.fields]]
        before = n.load_system(fields); after = n.postload_system()
        data = {'schema': 1, 'build': profile['clientVersion'], 'protocol': profile['protocolDigest'], 'rootType': SYSTEM_TYPE,
            'rootBytes': 0x160, 'effectId': key, 'phase': 'complete-system-native-postload', **after,
            'ignored': before['ignored'], 'mismatched': before['mismatched']}
        graph_raw = json.dumps(data, separators=(',', ':'), allow_nan=False).encode(); digest_graph = sha(graph_raw)
        (output / 'graphs' / f'{digest_graph}.json').write_bytes(graph_raw)
        n.restore_preload_arena()
        counts['systems'] += 1; counts['serializedFields'] += len(fields); counts['objectVisits'] += len(after['visits'])
        counts['callbackVisits'] += sum(visit['callbackRva'] is not None for visit in after['visits'])
        counts['nativeIgnoredFields'] += len(before['ignored']); counts['nativeTypeMismatches'] += len(before['mismatched'])
        counts['pendingLinkFixups'] += after['pendingLinkFixups']; counts['mathCalls'] += len(after['mathCalls'])
        counts['directComplexEmitters'] += int.from_bytes(bytes.fromhex(after['objectHex'])[0x28:0x2c], 'little')
        counts['directSimpleEmitters'] += int.from_bytes(bytes.fromhex(after['objectHex'])[0x38:0x3c], 'little')
        counts['emitterDefinitionVisits'] += sum(visit['type'] == 0x09cde442 for visit in after['visits'])
        systems[key] = {'file': f'graphs/{digest_graph}.json', 'sha256': digest_graph, 'bytes': len(graph_raw),
            'definitionSha256': ref['sha256'], 'rawSource': source, 'rawSourceSha256': digest,
            'rootSha256': sha(bytes.fromhex(after['objectHex'])), 'heapSha256': sha(bytes.fromhex(after['heapHex'])),
            'heapBytes': len(after['heapHex']) // 2, 'visits': len(after['visits']), 'pendingLinkFixups': after['pendingLinkFixups'],
            'nativeIgnoredFields': before['ignored'], 'nativeTypeMismatches': before['mismatched'],
            'fields': [{'hash': field.name.h, 'type': int(field.type), 'offset': reader.spans[id(field)][0], 'bytes': len(blob), 'sha256': sha(blob)} for field,blob in zip(entry.fields, fields)]}
        if counts['systems'] == 1:
            n.load_system(fields); again = n.postload_system()
            if again != after: raise ValueError('Complete system reset/reload differs')
            n.restore_preload_arena(); repeated += 1
    batch = {'schema': 1, 'keys': keys[index * batch_size:(index + 1) * batch_size], 'sources': sources, 'inputs': inputs,
        'systems': systems, 'counts': dict(counts), 'repeatedLoads': repeated,
        'originalBlocks': list(n.blocks.values()), 'postloadBlocks': list(n.postload_blocks.values())}
    (work / f'batch-{index:03d}.json').write_text(json.dumps(batch, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'batch': index + 1, 'batches': batch_count, **dict(counts)}), flush=True)


if __name__ == '__main__':
    main()
