"""Complete unchanged typed emitters with original multiply-UV birth and writers.

Texture presence is an explicit CPU-writer control, not resource acquisition.
Original GPU bindings are fingerprinted separately; match activation is unproven.
"""
import argparse
import inspect
import json
import struct
import sys
from pathlib import Path
from vfx_postload_native import NativeVfxPostload
from vfx_bound_quad_native import NativeBoundQuad
from vfx_uv_animation_native import NativeUvAnimation
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    a = p.parse_args()
    cache = a.cache.resolve()
    assets = cache / 'public'
    decoder = assets / 'decoder-16.21-macos'
    tools = Path(__file__).resolve().parent
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Multiply-UV input drift: ' + str(path))
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    paths = {Path(__file__), a.client}
    for cls in [NativeVfxPostload, NativeBoundQuad, NativeUvAnimation]:
        paths.update(Path(inspect.getfile(c)) for c in cls.__mro__ if c is not object)
    paths.update(Path(m.__file__) for m in tuple(sys.modules.values())
                 if getattr(m, '__file__', None) and Path(m.__file__).suffix == '.py'
                 and Path(m.__file__).resolve().is_relative_to(tools))
    for path in paths:
        raw(path)
    profile = read(decoder / 'profile.json')
    image = raw(decoder / 'image.bin')
    manifest_bytes = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(manifest_bytes)
    inventory_bytes = raw(decoder / 'vfx-assets.json')
    inventory = json.loads(inventory_bytes)
    if (sha(image) != profile['decoderImageSha256']
            or sha(inventory_bytes) != profile['vfxAssetsSha256']
            or inventory['effectsManifestSha256'] != sha(manifest_bytes)):
        raise ValueError('Exact-build field inventory required')
    loader = NativeVfxPostload(decoder, a.client)
    n = NativeBoundQuad(decoder, a.client)
    meta = read(decoder / 'vfx-bound-quads.json')
    selected, cases, matrix_controls = [], [], []
    targets = [('champions/vladimir/39/9fbafd14', i) for i in [2, 4, 5, 8]]
    targets += [('champions/akshan/20/433102d7', 17),
                ('champions/viego/43/14d9be11', 14),
                ('champions/viego/43/0235ff91', 0),
                ('champions/karthus/10/8ad0cea5', 6)]
    for effect_id, index in targets:
        ref = manifest['definitions'][effect_id]
        encoded = raw(assets / 'latest-effects' / ref['file'])
        if sha(encoded) != ref['sha256']:
            raise ValueError('Source definition differs')
        source = json.loads(encoded)['definition']['complexEmitterDefinitionData'][index]
        field_meta = inventory['emitters'][f'{effect_id}:{index}']
        if field_meta['definitionSha256'] != ref['sha256'] or field_meta['status'] != 'loaded-fields':
            raise ValueError('Typed field identity differs')
        blob = raw(cache / 'research/latest-effects/bins' /
                   f"{field_meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob) != field_meta['rawSourceSha256']:
            raise ValueError('Original BIN identity differs')
        fields = []
        for row in field_meta['fields']:
            field = blob[row['offset']:row['offset'] + row['bytes']]
            if sha(field) != row['sha256']:
                raise ValueError('Typed original field differs')
            fields.append(field)
        before = loader.load(fields)
        after = loader.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
            raise ValueError('Complete original postload required')
        graph = n.prepare_bound({'phase': 'native-postload-callbacks-executed', **after})
        selected.append({'effectId': effect_id, 'emitterIndex': index,
                         'sourceDefinitionSha256': ref['sha256'], 'source': source,
                         'uvFlags': graph['uvFlags'], 'primitiveKind': graph['primitiveKind'],
                         'fieldCount': len(fields), 'typedRootSha256': sha(bytes.fromhex(after['objectHex']))})
        for seed in [1, 0x12345]:
            for pose in ['identity', 'changing']:
                for present in [False, True]:
                    n.reset_bound(graph, seed, 0, meta)
                    frames = []
                    previous = [0, 0, 0]
                    for tick in range(31):
                        time = tick / 60
                        current = [23 + time * 130, -11 + time * 3, 81 + time * 70]
                        basis = ([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
                                 if pose == 'changing' and (tick // 8) % 2 else
                                 [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                        value = {'time': time, 'previous': previous, 'current': current,
                                 'basis': basis, 'viewPosition': [300, 900, 1200],
                                 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0],
                                 'viewAxis': [0, 0, 1], 'multTexturePresent': present}
                        output = n.frame_bound(value)
                        state = output['state']
                        output = {'state': {k: state[k] for k in ['births', 'vectors', 'rngHex']},
                                  'geometry': {k: output['geometry'][k]
                                               for k in ['verticesHex', 'indicesHex', 'drawHex']}}
                        frames.append({'input': value, 'output': output})
                        previous = current
                    if not any(f['output']['state']['births'] for f in frames):
                        raise ValueError('Actual original particle births required')
                    cases.append({'effectId': effect_id, 'emitterIndex': index,
                                  'primitiveKind': graph['primitiveKind'], 'seedHex': f'{seed:016x}',
                                  'pose': pose, 'multTexturePresent': present, 'frames': frames})
        loader.restore_preload_arena()
        print(json.dumps({'effectId': effect_id, 'emitterIndex': index,
                          'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases)}), flush=True)
    uv = NativeUvAnimation(decoder, a.client)
    for angle in [-360, -180, -90, 0, 7.5, 90, 180, 360]:
        for offset in [[0, 0], [.25, 0], [-1.25, 2.75]]:
            for scale in [[1, 1], [2, .5], [-.75, 1.25]]:
                source = {'textureMult': {'__type': 'VfxTextureMultDefinitionData', 'textureMult': 'control.tex',
                                         'UvRotationMult': {'__type': 'ValueFloat', 'constantValue': angle},
                                         'birthUVOffsetMult': {'__type': 'ValueVector2', 'constantValue': offset},
                                         'uvScaleMult': {'__type': 'ValueVector2', 'constantValue': scale}}}
                graph = uv.assemble(source)
                birth = uv.birth({'chance': .625, 'emitterAge': .4})
                frames = []
                for age in [0, .125, .5, 1]:
                    value = {'age': age, 'normalizedAge': age, 'lifetime': 1, 'chance': .625}
                    frames.append({'input': value, 'output': uv.sample(birth['records'], value)})
                matrix_controls.append({'source': source, 'flags': graph['flags'], 'birth': birth, 'frames': frames})
    for path, digest in list(inputs.items()):
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Final multiply-UV input drift: ' + path)
    report = {'schema': 1, 'kind': 'original-complete-multiply-uv-controls',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'decoderImageSha256': profile['decoderImageSha256'],
              'effectsManifestSha256': sha(manifest_bytes), 'selected': selected, 'cases': cases,
              'matrixControls': matrix_controls,
              'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
              'scope': {'completeUnchangedTypedSources': True,
                        'originalUvClassificationBirthUpdateAndVertexWriters': True,
                        'suppliedClockBasisQualityAndSeeds': True,
                        'suppliedOpaqueTexturePresence': True,
                        'gpuResourcesAcquired': False, 'nativeMatchAcceptance': None,
                        'browserAcceptance': False}}
    output = cache / 'research/direct-mult-uv-native.json'
    output.write_text(json.dumps(report, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(selected), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases), 'inputs': len(inputs)}))


if __name__ == '__main__':
    main()
