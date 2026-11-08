"""Original dynamic MULT UV clock controls and complete typed particle schedules.

Variants change named original serialized fields explicitly. Clock/basis/seed and
opaque texture presence are supplied controls, not recovered match inputs.
"""
import argparse
import copy
import inspect
import json
import struct
import sys
from pathlib import Path
from vfx_postload_native import NativeVfxPostload
from vfx_bound_quad_native import NativeBoundQuad
from vfx_uv_animation_native import NativeUvAnimation
from vfx_spawn_native import sha, name_hash


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
            raise ValueError('Dynamic MULT input drift: ' + str(path))
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

    def original(effect_id, index):
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
        fields = {}
        for row in field_meta['fields']:
            field = blob[row['offset']:row['offset'] + row['bytes']]
            if sha(field) != row['sha256']:
                raise ValueError('Typed original field differs')
            fields[row['hash']] = field
        return source, fields

    karth, karth_fields = original('champions/karthus/10/8ad0cea5', 6)
    vlad, vlad_fields = original('champions/vladimir/39/8388edda', 18)
    _, delay_fields = original('champions/akshan/20/076d494b', 0)
    uv = NativeUvAnimation(decoder, a.client)
    leaf_controls = []
    # Deliberately independent absolute/normalized ages, lifetime, birth ages,
    # and chance discriminate the original ABI clock and birth inheritance.
    for source in [karth, vlad]:
        for rotation, offset in [(0, [0, 0]), (7.5, [-1.25, 2.75])]:
            control = {'textureMult': copy.deepcopy(source['textureMult'])}
            control['textureMult']['UvRotationMult'] = {'__type': 'ValueFloat', 'constantValue': rotation}
            control['textureMult']['birthUVOffsetMult'] = {'__type': 'ValueVector2', 'constantValue': offset}
            graph = uv.assemble(control)
            for birth_age in [0, .37, .91]:
                birth = uv.birth({'chance': .625, 'emitterAge': birth_age})
                frames = []
                for normalized in [-.125, 0, .025, .05, .065, .08, .125, .5, 1, 1.25]:
                    for age, lifetime in [(.03125, .25), (.7, 3.0)]:
                        value = {'age': age, 'normalizedAge': normalized, 'lifetime': lifetime, 'chance': .375}
                        frames.append({'input': value, 'output': uv.sample(birth['records'], value)})
                leaf_controls.append({'source': control, 'flags': graph['flags'],
                                      'birthInput': {'chance': .625, 'emitterAge': birth_age},
                                      'birth': birth, 'frames': frames})
    loader = NativeVfxPostload(decoder, a.client)
    n = NativeBoundQuad(decoder, a.client)
    meta = read(decoder / 'vfx-bound-quads.json')
    schedules = []
    for variant, changes in [
        ('unchanged', {}),
        ('continuous-short', {'rate': 12, 'isSingleParticle': False, 'particleLifetime': .5}),
        ('continuous-delayed', {'rate': 12, 'isSingleParticle': False, 'particleLifetime': 1.5,
                                'timeBeforeFirstEmission': .25}),
        ('single-delayed-tail', {'particleLifetime': .5, 'timeBeforeFirstEmission': .25}),
    ]:
        source, fields = copy.deepcopy(karth), dict(karth_fields)
        for key, value in changes.items():
            h = name_hash(key)
            field = fields.get(h)
            if key == 'particleLifetime':
                field = vlad_fields[h]
            if key == 'timeBeforeFirstEmission':
                field = delay_fields[h]
            if key == 'isSingleParticle':
                if field[-1:] != b'\1':
                    raise ValueError('Expected original true flag')
                fields[h] = field[:-1] + bytes([int(value)])
                source[key] = value
            else:
                fields[h] = field[:-4] + struct.pack('<f', value)
                if key in ['rate', 'particleLifetime']:
                    source[key] = {'__type': 'ValueFloat', 'constantValue': value}
                else:
                    source[key] = value
        before = loader.load(list(fields.values()))
        after = loader.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
            raise ValueError('Complete original postload required')
        graph = n.prepare_bound({'phase': 'native-postload-callbacks-executed', **after})
        for seed in [1, 0x12345]:
            for present in [False, True]:
                n.reset_bound(graph, seed, 0, meta)
                frames = []
                for tick in range(241):
                    value = {'time': tick / 60, 'previous': [0, 0, 0], 'current': [0, 0, 0],
                             'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                             'viewPosition': [300, 900, 1200], 'cameraRight': [1, 0, 0],
                             'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1], 'multTexturePresent': present}
                    output = n.frame_bound(value)
                    state = output['state']
                    frames.append({'input': value,
                                   'output': {'state': {k: state[k] for k in ['births', 'vectors', 'rngHex']},
                                              'geometry': {k: output['geometry'][k]
                                                           for k in ['verticesHex', 'indicesHex', 'drawHex']}}})
                schedules.append({'variant': variant, 'changes': changes, 'source': source,
                                  'effectId': 'champions/karthus/10/8ad0cea5', 'emitterIndex': 6,
                                  'seedHex': f'{seed:016x}', 'multTexturePresent': present,
                                  'typedRootSha256': sha(bytes.fromhex(after['objectHex'])),
                                  'frames': frames})
        loader.restore_preload_arena()
        print(json.dumps({'variant': variant, 'cases': len(schedules)}), flush=True)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Final dynamic MULT input drift: ' + path)
    report = {'schema': 1, 'kind': 'original-dynamic-multiply-uv-clock-and-typed-schedules',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'inputs': inputs, 'leafControls': leaf_controls, 'cases': schedules,
              'originalBlocks': list(n.blocks.values()), 'leafOriginalBlocks': list(uv.blocks.values()),
              'scope': {'unchangedTypedSourceAndExplicitFieldVariants': True,
                        'independentBirthAbsoluteNormalizedAgeLifetimeControls': True,
                        'suppliedClockBasisQualitySeedsAndTexturePresence': True,
                        'nativeMatchAcceptance': None, 'browserAcceptance': False}}
    output = cache / 'research/direct-mult-scale-uv-native-v32.json'
    output.write_text(json.dumps(report, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(output), 'leafFrames': sum(len(c['frames']) for c in leaf_controls),
                      'frames': sum(len(c['frames']) for c in schedules), 'inputs': len(inputs)}))


if __name__ == '__main__':
    main()
