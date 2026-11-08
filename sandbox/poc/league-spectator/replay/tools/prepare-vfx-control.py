"""Prepare exact-build emission suspension and controlled continuous examples."""
import argparse
import json
from pathlib import Path
import struct

from vfx_control_native import NativeVfxControl, CONTROL, ACTOR_LIST, SETTER, PROPAGATE
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['decoder', 'client', 'effects', 'output', 'evidence']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    n = NativeVfxControl(args.decoder, args.client)
    meta = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    effects_raw = (args.effects / 'manifest.json').read_bytes()
    effects = json.loads(effects_raw)
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in ['prepare-vfx-control.py', 'vfx_control_native.py']}
    for name, expected in meta['compilerSources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != expected:
            raise ValueError(f'Native bound preparer changed: {name}')
    blocks = [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a, b in [SETTER, PROPAGATE]]
    for block in blocks:
        a, b = block['startRva'], block['endRva']
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Control instructions differ from the matching executable')
    inputs = {str((args.effects / 'manifest.json').resolve()): sha(effects_raw)}
    definitions = {}
    selected, actors = [], set()
    for ref in meta['templates']:
        actor = ref['effectId'].rsplit('/', 1)[0]
        if actor in actors:
            continue
        entry = effects['definitions'][ref['effectId']]
        if ref['effectId'] not in definitions:
            path = args.effects / entry['file']
            raw = path.read_bytes()
            if sha(raw) != ref['sourceDefinitionSha256']:
                raise ValueError('Continuous emitter definition changed')
            definitions[ref['effectId']] = json.loads(raw)
            inputs[str(path.resolve())] = sha(raw)
        emitter = definitions[ref['effectId']]['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
        rate, life = emitter.get('rate', {}), emitter.get('particleLifetime', {})
        if (emitter.get('isSingleParticle') or type(rate.get('constantValue')) not in [int, float] or
                not 1 <= rate['constantValue'] <= 40 or rate.get('dynamics') or life.get('dynamics') or
                type(life.get('constantValue')) not in [int, float] or not .1 <= life['constantValue'] <= .6 or
                type(emitter.get('lifetime')) not in [int, float] or not 2 <= emitter['lifetime'] <= 6):
            continue
        selected.append({'ref': ref, 'rate': rate['constantValue'], 'life': life['constantValue'], 'emitterLifetime': emitter['lifetime']})
        actors.add(actor)
        if len(selected) == 12:
            break
    if len(selected) < 4:
        raise ValueError('Insufficient distinct controlled continuous examples')
    first = selected[0]['ref']
    graph_raw = (args.decoder / first['file']).read_bytes()
    if sha(graph_raw) != first['sha256']:
        raise ValueError('Initial control graph changed')
    n.reset_bound(json.loads(graph_raw), 1, 0, meta)
    flags = []
    for initial in range(256):
        for suspended in [False, True, True, False]:
            n.put(A['actor'] + 0x18, 'B', initial)
            before = n.snapshot()
            result = n.suspend(suspended)
            after = n.snapshot()
            # Only the one actor flag byte is allowed to change. Pool/RNG and
            # every other actor byte must remain untouched by this operation.
            actor_before, actor_after = bytearray.fromhex(before['actorHex']), bytearray.fromhex(after['actorHex'])
            actor_after[0x18] = actor_before[0x18]
            if (actor_before != actor_after or any(before[k] != after[k] for k in ['vectors', 'rngHex', 'poolHex'])):
                raise ValueError('Emission suspension changed persistent simulation data')
            flags.append({'initial': initial, 'suspended': suspended, 'result': result})
    cases = []
    for selection in selected:
        ref = selection['ref']
        graph_raw = (args.decoder / ref['file']).read_bytes()
        if sha(graph_raw) != ref['sha256']:
            raise ValueError('Continuous control graph changed')
        inputs[str((args.decoder / ref['file']).resolve())] = sha(graph_raw)
        graph = json.loads(graph_raw)
        for schedule in ['running', 'suspend-resume', 'suspend-drain']:
            n.reset_bound(graph, 1, 0, meta)
            frames = []
            for tick in range(61):
                time = tick / 30
                suspended = schedule != 'running' and tick >= 9 and (schedule == 'suspend-drain' or tick < 36)
                control = n.suspend(suspended)
                value = {'time': time, 'previous': [0, 0, 0], 'current': [0, 0, 0],
                    'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1],
                    'multTexturePresent': ref['hasMultDefinition']}
                output = n.frame_bound(value)
                if suspended and output['state']['births']:
                    raise ValueError('Original frame emitted while births were suppressed')
                frames.append({'input': value, 'suspended': suspended, 'control': control, 'output': output,
                               'libraryInputs': list(n.library_inputs)})
            # The bounded, constant lifetime provides a native-observable tail.
            if schedule == 'suspend-drain' and any(f['output']['state']['vectors']['life']['count'] for f in frames[31:]):
                raise ValueError('Suppressed constant-lifetime example failed to drain')
            cases.append({**selection, 'schedule': schedule, 'graphSha256': ref['sha256'], 'seedHex': '0000000000000001', 'quality': 0, 'frames': frames})
        print(json.dumps({'graphs': len(cases) // 3, 'cases': len(cases), 'effect': ref['effectId']}), flush=True)
    package = {'schema': 1, 'kind': 'native-emitter-birth-suppression', 'build': meta['build'], 'protocol': meta['protocol'],
        'sliceSha256': meta['sliceSha256'], 'decoderImageSha256': meta['decoderImageSha256'], 'runtimeSha256': meta['runtimeSha256'],
        'quadPackageSha256': n.profile['vfxBoundQuadsSha256'], 'controlAddress': CONTROL, 'actorListAddress': ACTOR_LIST,
        'scratchBytes': 0x500, 'setterRva': SETTER[0], 'propagationBlock': list(PROPAGATE), 'sourceBlocks': blocks, 'compilerSources': sources,
        'scope': {'reversibleBirthSuppression': True, 'suppliedBoolean': True, 'complexEmitters': 1, 'meshSiblings': 0,
            'systemRetirement': False, 'replayEventMapping': False, 'mainViewerIntegrated': False}}
    package_raw = json.dumps(package, indent=2).encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(package_raw)
    evidence = {'schema': 1, 'kind': 'native-emission-control-observations', 'build': meta['build'], 'protocol': meta['protocol'],
        'packageSha256': sha(package_raw), 'quadPackageSha256': n.profile['vfxBoundQuadsSha256'], 'sources': sources,
        'inputs': inputs, 'originalBlocks': list(n.blocks.values()), 'flags': flags, 'cases': cases,
        'counts': {'flagProbes': len(flags), 'graphs': len(selected), 'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases)},
        'scope': {'suppliedClock': '30 Hz', 'suppliedSeed': 1, 'suppliedQuality': 0, 'unitSceneInputs': True,
            'replayEventMapping': False, 'systemRetirement': False, 'originalDarwinMath': False, 'browserRun': False, 'mainViewerIntegrated': False}}
    args.evidence.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(package_raw), 'counts': evidence['counts']}))


if __name__ == '__main__':
    main()
