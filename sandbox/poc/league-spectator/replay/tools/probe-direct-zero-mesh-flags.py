"""Compare an authored zero flag with its original constructor default.

The serialized field reader, recursive post-load, particle update and camera
writer execute unchanged. This does not infer a nonzero flag implementation.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

from vfx_postload_native import NativeVfxPostload
from vfx_camera_quad_native import NativeCameraQuad
from vfx_spawn_native import name_hash, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache, inputs = args.cache.resolve(), {}
    assets = cache / 'public'

    def raw(path):
        path = path.resolve()
        b = path.read_bytes()
        h = sha(b)
        if str(path) in inputs and inputs[str(path)] != h:
            raise ValueError('Zero mesh flag input drift: ' + str(path))
        inputs[str(path)] = h
        return b

    def read(path):
        return json.loads(raw(path))

    profile = read(assets / 'decoder-16.21-macos/profile.json')
    image = raw(assets / 'decoder-16.21-macos/image.bin')
    manifest = read(assets / 'latest-effects/manifest.json')
    inventory_bytes = raw(assets / 'decoder-16.21-macos/vfx-assets.json')
    inventory = json.loads(inventory_bytes)
    if (sha(image) != profile['decoderImageSha256'] or
            sha(inventory_bytes) != profile['vfxAssetsSha256'] or
            inventory['effectsManifestSha256'] != sha(raw(assets / 'latest-effects/manifest.json'))):
        raise ValueError('Exact original source packages required')
    effect_id, index = 'champions/jinx/2/953aab68', 1
    ref = manifest['definitions'][effect_id]
    b = raw(assets / 'latest-effects' / ref['file'])
    if sha(b) != ref['sha256']:
        raise ValueError('Exact authored definition required')
    source = json.loads(b)['definition']['complexEmitterDefinitionData'][index]
    if source['meshRenderFlags'] != 0:
        raise ValueError('Authored zero flag fixture required')
    meta = inventory['emitters'][f'{effect_id}:{index}']
    blob = raw(cache / 'research/latest-effects/bins' /
               f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
    if sha(blob) != meta['rawSourceSha256'] or meta['definitionSha256'] != ref['sha256']:
        raise ValueError('Original emitter span differs')
    fields = []
    for f in meta['fields']:
        b = blob[f['offset']:f['offset'] + f['bytes']]
        if sha(b) != f['sha256']:
            raise ValueError('Original serialized field differs')
        fields.append((f['hash'], b))
    flag_hash = name_hash('meshRenderFlags')
    flag_fields = [b for h, b in fields if h == flag_hash]
    if len(flag_fields) != 1:
        raise ValueError('One authored flag required')
    original = flag_fields[0]
    if (len(original) not in [6, 7, 9] or
            struct.unpack_from('<I', original)[0] != flag_hash or any(original[5:])):
        raise ValueError('Bounded original zero scalar field required')
    counter = original[:5] + (1).to_bytes(len(original) - 5, 'little')
    loader = NativeVfxPostload(assets / 'decoder-16.21-macos', args.client)
    native = NativeCameraQuad(assets / 'decoder-16.21-macos', args.client)
    sources = {Path(__file__)}
    for n in [loader, native]:
        sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
    for path in sources:
        raw(path)
    prop = next(p for p in loader.type_catalog['09cde442']['properties'] if p['hash'] == flag_hash)
    graphs, postloads = {}, []
    for variant in ['authored-zero', 'absent', 'typed-one-control']:
        selected = [counter if variant == 'typed-one-control' and h == flag_hash else b
                    for h, b in fields if variant != 'absent' or h != flag_hash]
        before = loader.load(selected)
        after = loader.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
            raise ValueError('Original typed source loading unresolved')
        postloads.append({'variant': variant, 'fieldHex': None if variant == 'absent' else
                          (counter if variant == 'typed-one-control' else original).hex(),
                          'objectHex': after['objectHex'], 'heapSha256': sha(bytes.fromhex(after['heapHex'])),
                          'heapBytes': len(after['heapHex']) // 2,
                          'fieldBytesHex': after['objectHex'][prop['offset'] * 2:(prop['offset'] + len(original) - 5) * 2]})
        if variant != 'typed-one-control':
            graphs[variant] = native.prepare_camera({'phase': 'native-postload-callbacks-executed', **after})
        loader.restore_preload_arena()
    common_heap = (max(g['nextHeap'] for g in graphs.values()) + 0x1000 + 15) & ~15
    for graph in graphs.values():
        graph['nextHeap'] = common_heap
    cases = []
    for seed in [1, 0x12345]:
        for pose in ['identity', 'changing']:
            for variant, graph in graphs.items():
                native.reset_quad(graph, seed, 0)
                frames, previous = [], [0, 0, 0]
                for tick in range(61):
                    t = tick / 60
                    current = [130 * t, 3 * t, 70 * t]
                    basis = ([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
                             if pose == 'changing' and 15 <= tick < 45 else
                             [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                    value = {'time': t, 'previous': previous, 'current': current, 'basis': basis,
                             'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0],
                             'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                    frames.append({'input': value, 'output': native.frame_camera(value)})
                    previous = current
                cases.append({'seedHex': f'{seed:016x}', 'pose': pose, 'variant': variant, 'frames': frames})
    result = {'schema': 1, 'kind': 'original-zero-mesh-render-flag-controls',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'decoderImageSha256': profile['decoderImageSha256'], 'effectId': effect_id,
              'emitterIndex': index, 'source': source, 'registration': prop, 'postloads': postloads,
              'cases': cases, 'inputs': inputs, 'originalBlocks': list(native.blocks.values()),
              'scope': {'onlyAuthoredFlagRemoved': True, 'originalTypedReaderAndPostload': True,
                        'nonzeroFlagAdmitted': False, 'suppliedSeedClockPose': True,
                        'actualMatchActivation': False, 'runtimeAdmissionChanged': False}}
    for path, h in inputs.items():
        if sha(Path(path).read_bytes()) != h:
            raise ValueError('Final zero mesh flag drift: ' + path)
    output = cache / 'research/direct-zero-mesh-flags-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')))
    print(json.dumps({'output': str(output), 'registration': prop,
                      'postloads': [{k: v for k, v in row.items() if k != 'objectHex'} for row in postloads],
                      'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()
