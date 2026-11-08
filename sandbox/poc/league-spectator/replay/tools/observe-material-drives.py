"""Observe erosion-drive replacement and cross-graph native material restoration."""
import argparse
import inspect
import json
from pathlib import Path
import struct

from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['decoder', 'client', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    meta_raw = (args.decoder / 'vfx-bound-quads.json').read_bytes()
    meta = json.loads(meta_raw)
    samples, actor_counts = [], {}
    for ref in meta['templates']:
        graph_raw = (args.decoder / ref['file']).read_bytes()
        if sha(graph_raw) != ref['sha256']:
            raise ValueError('Erosion-drive graph changed')
        graph = json.loads(graph_raw)
        if not struct.unpack_from('<Q', bytes.fromhex(graph['assetObjectHex']), 0x38)[0]:
            continue
        actor = '/'.join(ref['effectId'].split('/')[:3])
        if actor_counts.get(actor, 0) < 2:
            samples.append((ref, graph))
            actor_counts[actor] = actor_counts.get(actor, 0) + 1
    if not samples or len(samples) > 100:
        raise ValueError('Invalid bounded erosion-drive sample population')
    n = NativeVfxMaterial(args.decoder, args.client)
    cases = []
    for ref, graph in samples:
        n.prepare_material(graph)
        baseline = n.erosion_parameters(.5)
        outputs = []
        for drive in [-1., -0., 0., 1.e-7, .25, .5, 1., 2.]:
            parameters = n.erosion_parameters(drive)
            if parameters[0]['bytesHex'][:8] != struct.pack('<f', drive).hex() or parameters[0]['bytesHex'][8:] != baseline[0]['bytesHex'][8:] or parameters[1] != baseline[1]:
                raise ValueError('Native erosion parameters change beyond the supplied drive lane')
            outputs.append({'driveHex': struct.pack('<f', drive).hex(), 'parameters': parameters})
        n.finish()
        cases.append({'effectId': ref['effectId'], 'emitterIndex': ref['emitterIndex'], 'graphSha256': ref['sha256'], 'outputs': outputs})
    restored = []
    for ref, graph in reversed(samples[:3]):
        n.prepare_material(graph)
        parameters = n.erosion_parameters(.5)
        n.finish()
        original = next(c for c in cases if c['graphSha256'] == ref['sha256'])
        expected = next(o['parameters'] for o in original['outputs'] if o['driveHex'] == struct.pack('<f', .5).hex())
        if parameters != expected:
            raise ValueError('Native erosion result changed after another graph')
        restored.append(ref['sha256'])
    dependencies = {Path(inspect.getfile(cls)) for cls in NativeVfxMaterial.__mro__ if cls is not object}
    dependencies.update([Path(__file__), Path(__file__).with_name('macho.py')])
    result = {'schema': 1, 'kind': 'native-material-drive-observations', 'build': meta['build'],
        'quadPackageSha256': sha(meta_raw), 'sources': {p.name: sha(p.read_bytes()) for p in sorted(dependencies)},
        'cases': cases, 'restoredGraphs': restored, 'actorSamples': actor_counts,
        'originalBlocks': sorted(n.material_blocks.values(), key=lambda b: b['rva']),
        'counts': {'graphs': len(cases), 'drives': sum(len(c['outputs']) for c in cases), 'restored': len(restored)},
        'scope': {'externalMathCalls': 0, 'runtimeAssetBytesUnchanged': True,
            'originalPerDrawCallsite': 0x1740310, 'callerSchedulingRecovered': False,
            'browserRun': False, 'referencePixelsCompared': False}}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
