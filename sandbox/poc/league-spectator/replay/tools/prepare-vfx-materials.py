"""Prepare native quad material observations from complete loaded asset graphs.

Static package preparation only. Environment/resource predicates are controlled
probes, not reconstructed resource acquisition or original scene settings.
"""
import argparse
from collections import Counter
import inspect
import json
from pathlib import Path
import struct
import subprocess
import sys
import time

import unicorn
from unicorn import x86_const as r
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['decoder', 'client', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--start', type=int, default=0)
    args = parser.parse_args()
    raw = (args.decoder / 'vfx-bound-quads.json').read_bytes()
    meta = json.loads(raw)
    profile = json.loads((args.decoder / 'profile.json').read_bytes())
    if sha(raw) != profile['vfxBoundQuadsSha256'] or meta['build'] != '16.21.829.8620':
        raise ValueError('Unmatched complete quad asset package')
    if args.limit is None:
        if args.start:
            raise ValueError('A start offset requires an explicit worker limit')
        # The Windows Unicorn build faulted in host code after 1,500 emitters
        # in one instance. The exact failing asset/input succeeds in a fresh
        # instance. Bound each native engine to 100 complete emitter graphs.
        # Every input remains included and any child failure rejects the run.
        parts = args.output.with_name(args.output.stem + '-parts')
        parts.mkdir(parents=True, exist_ok=True)
        catalog, catalog_keys, emitters, blocks, children = [], {}, [], {}, []
        counts, define_counts = Counter(), Counter()
        merged = None
        started = time.perf_counter()
        for start in range(0, len(meta['templates']), 100):
            count = min(100, len(meta['templates']) - start)
            path = parts / f'{start:04d}.json'
            subprocess.run([sys.executable, str(Path(__file__).resolve()), str(args.decoder), str(args.client),
                            str(path), '--start', str(start), '--limit', str(count)], check=True)
            child_raw = path.read_bytes()
            child = json.loads(child_raw)
            if child['quadPackageSha256'] != sha(raw) or child['counts']['emitters'] != count:
                raise ValueError('Incomplete native material child process')
            if merged is None:
                merged = child
            elif child['sources'] != merged['sources']:
                raise ValueError('Native material sources changed between child processes')
            remap = {}
            for i, result in enumerate(child['resultCatalog']):
                key = json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False)
                if key not in catalog_keys:
                    catalog_keys[key] = len(catalog)
                    catalog.append(result)
                remap[i] = catalog_keys[key]
            for ref, entry in zip(meta['templates'][start:start + count], child['emitters'], strict=True):
                if (ref['effectId'], ref['emitterIndex'], ref['sha256']) != (entry['effectId'], entry['emitterIndex'], entry['graphSha256']):
                    raise ValueError('Native material child graph coverage changed')
                for probe in entry['probes']:
                    probe['result'] = remap[probe['result']]
                emitters.append(entry)
            counts.update(child['counts'])
            define_counts.update(child['defineOccurrences'])
            for block in child['originalBlocks']:
                key = (block['rva'], block['size'])
                if key in blocks and blocks[key] != block:
                    raise ValueError('Native material code changed between child processes')
                blocks[key] = block
            children.append({'file': str(path.resolve()), 'sha256': sha(child_raw), 'start': start, 'emitters': count})
            print(json.dumps({'completedEmitters': len(emitters), 'total': len(meta['templates'])}), flush=True)
        merged.update({'counts': dict(counts), 'defineOccurrences': dict(define_counts), 'resultCatalog': catalog,
                       'emitters': emitters, 'originalBlocks': [blocks[key] for key in sorted(blocks)],
                       'childProcesses': children, 'elapsedSeconds': time.perf_counter() - started})
        merged['scope']['partialCorpus'] = False
        merged['scope']['maximumEmittersPerNativeEngine'] = 100
        args.output.write_text(json.dumps(merged, indent=2, allow_nan=False), encoding='utf-8')
        print(json.dumps({'counts': dict(counts), 'catalog': len(catalog), 'blocks': len(blocks)}), flush=True)
        return
    if args.limit <= 0 or args.limit > 100 or not 0 <= args.start < len(meta['templates']):
        raise ValueError('Native material worker exceeds its engine-lifetime bound')
    n = NativeVfxMaterial(args.decoder, args.client)
    try:
        n.u.mem_read(0x20000000, 1)
    except unicorn.UcError as error:
        if error.errno != unicorn.UC_ERR_READ_UNMAPPED:
            raise
    else:
        raise ValueError('Resource-presence marker must be unmapped')
    graphs = meta['templates'][args.start:args.start + args.limit]
    catalog, catalog_keys, emitters = [], {}, []
    counts, defines = Counter(), Counter()
    started = time.perf_counter()
    for graph_index, ref in enumerate(graphs):
        graph_raw = (args.decoder / ref['file']).read_bytes()
        if sha(graph_raw) != ref['sha256']:
            raise ValueError('Complete native material asset graph changed')
        graph = json.loads(graph_raw)
        n.prepare_material(graph)
        try:
            parameters = n.parameters()
            samplers = n.samplers()
            erosion = n.erosion_parameters(.5)
            obj = bytes.fromhex(graph['assetObjectHex'])
            defined = sum(1 << bit for bit, offset in enumerate([0x230, 0x48, 0x40]) if struct.unpack_from('<Q', obj, offset)[0])
            baseline = {'pass': 0, 'featuresEnabled': True, 'resourceMask': 0,
                        'systemFogMode': 0, 'graphics34b': False, 'graphics29c': 0}
            cases = [dict(baseline, resourceMask=mask) for mask in range(8)]
            cases += [dict(baseline, resourceMask=defined, **extra) for extra in
                      [{'pass': value} for value in range(1, 7)] +
                      [{'featuresEnabled': False}, {'systemFogMode': 1},
                       {'graphics34b': True, 'graphics29c': 2}]]
            probes = []
            for case_index, value in enumerate(cases):
                selected = n.select(value)
                state = n.render_state(value['pass'])
                result = {'selection': selected, 'renderState': state}
                encoded = json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False)
                if encoded not in catalog_keys:
                    catalog_keys[encoded] = len(catalog)
                    catalog.append(result)
                probes.append({'input': value, 'result': catalog_keys[encoded]})
                counts['shaderSelections'] += 1
                for define in state['defines']:
                    defines[define['name'] + '=' + define['value']] += 1
                if case_index == 0:
                    counts['baselineAlphaTestAdditions'] += any(d['name'] == 'ALPHA_TEST' for d in state['defines']) and not any(d['name'] == 'ALPHA_TEST' for d in selected['defines'])
            emitters.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'],
                'sourceDefinitionSha256': ref['sourceDefinitionSha256'], 'graphFile': ref['file'],
                'graphSha256': ref['sha256'], 'primitiveKind': ref['primitiveKind'],
                'definedObjectMask': defined, 'parameters': parameters, 'samplers': samplers,
                'erosionAtSuppliedDrive': .5 if erosion else None, 'erosionParameters': erosion, 'probes': probes})
            counts['emitters'] += 1
            counts['parameters'] += len(parameters)
            counts['erosionEmitters'] += bool(erosion)
            counts['softEmitters'] += len(parameters) == 5
            n.finish()
        except Exception as error:
            at = n.u.reg_read(r.UC_X86_REG_RIP) - n.base
            raise ValueError(f"Native material failed for {ref['effectId']} emitter {ref['emitterIndex']}, input {value if 'value' in locals() else None}, RIP {at:x}: {error}") from error
        if (graph_index + 1) % 100 == 0:
            print(json.dumps({'emitters': graph_index + 1, 'of': len(graphs), 'seconds': round(time.perf_counter() - started, 2)}), flush=True)
    dependencies = {Path(inspect.getfile(cls)) for cls in NativeVfxMaterial.__mro__ if cls is not object}
    dependencies.add(Path(__file__).with_name('macho.py'))
    sources = {p.name: sha(p.read_bytes()) for p in sorted(dependencies)}
    sources[Path(__file__).name] = sha(Path(__file__).read_bytes())
    result = {'schema': 1, 'kind': 'native-quad-material-observations', 'build': meta['build'],
        'protocol': meta['protocol'], 'sliceSha256': profile['sliceSha256'],
        'decoderImageSha256': profile['decoderImageSha256'], 'quadPackageSha256': sha(raw),
        'sources': sources, 'originalBlocks': sorted(n.material_blocks.values(), key=lambda b: b['rva']),
        'entrypoints': {'shaderSelection': 0x16dff20, 'atlas': [0x16de93f, 0x16dea09],
            'pushPull': [0x16deec2, 0x16def04], 'softParticles': [0x16def04, 0x16df040],
            'erosion': [0x173d020, 0x173d0b6], 'samplers': [0x16e3910, 0x16e3a53],
            'renderState': [0x16df1e0, 0x16df180], 'renderStateSetter': 0x17bb570},
        'counts': dict(counts), 'defineOccurrences': dict(defines), 'resultCatalog': catalog, 'emitters': emitters,
        'elapsedSeconds': time.perf_counter() - started,
        'scope': {'partialCorpus': args.limit is not None, 'assetBytesUnchanged': True,
            'resourcePresenceMarkerUnmapped': True, 'externalMathCalls': 0,
            'resourceAcquisition': False, 'materialFactory': False, 'gpuSubmitted': False,
            'browserRun': False, 'mainViewerIntegrated': False, 'referencePixelsCompared': False,
            'environment': 'Pass, feature enablement, resource-presence predicates and named raw scene/graphics fields are supplied probes. Every loaded asset byte is retained.',
            'erosion': 'Supplied drive 0.5. Original per-draw parameter computation samples the color mixer at its original zero-time argument. Full activation and draw scheduling remain separate.'}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'counts': dict(counts), 'catalog': len(catalog), 'blocks': len(n.material_blocks)}), flush=True)


if __name__ == '__main__':
    main()
