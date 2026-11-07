"""Unchanged camera quads with nonzero offsets and authored local-particle flag.

Only the original typed packed boolean is varied. No emitter/resource/world
eligibility changes, guessed poses, or omitted original simulation components.
"""
import argparse
import importlib.util
import inspect
import json
import math
import struct
import sys
from pathlib import Path

from vfx_postload_native import NativeVfxPostload
from vfx_camera_quad_native import NativeCameraQuad
from vfx_spawn_native import sha, name_hash

helper_path = Path(__file__).with_name('probe-direct-zero-position.py')
spec = importlib.util.spec_from_file_location('camera_offset_geometry_controls', helper_path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def basis_at(schedule, tick):
    pose = 'identity' if schedule == 'identity' else ['identity', 'yaw90', 'pitch90', 'roll45', 'shear', 'nonorthogonal', 'scaled'][(tick // 8) % 7]
    c = math.sqrt(.5)
    return {
        'identity': [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
        'yaw90': [0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1],
        'pitch90': [1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1],
        'roll45': [c,c,0,0,-c,c,0,0,0,0,1,0,0,0,0,1],
        'shear': [1,.25,0,0,.5,1,.125,0,-.25,.5,1,0,0,0,0,1],
        'nonorthogonal': [1,1,0,0,1,0,1,0,0,1,1,0,0,0,0,1],
        'scaled': [2,0,0,0,0,.5,0,0,0,0,1.5,0,0,0,0,1],
    }[pose]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    p.add_argument('--frames', type=int, default=61)
    args = p.parse_args()
    if not 2 <= args.frames <= 121:
        raise ValueError('Bounded visible-frame count required')
    cache = args.cache.resolve()
    assets = cache / 'public'
    decoder = assets / 'decoder-16.21-macos'
    tools = Path(__file__).resolve().parent
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Native camera offset input changed: ' + str(path))
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    # Capture native source before any constructor or controlled execution.
    paths = {Path(__file__), helper_path, args.client}
    for cls in [NativeVfxPostload, NativeCameraQuad]:
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
    if (sha(image) != profile['decoderImageSha256'] or
            sha(inventory_bytes) != profile['vfxAssetsSha256'] or
            inventory['effectsManifestSha256'] != sha(manifest_bytes)):
        raise ValueError('Exact native image/field inventory/manifest required')
    loader = NativeVfxPostload(decoder, args.client)
    n = NativeCameraQuad(decoder, args.client)
    prop_hash = name_hash('particleIsLocalOrientation')
    field = next(row for row in loader.type_catalog['09cde442']['properties'] if row['hash'] == prop_hash)
    if (field['offset'], field['type'], field['mask']) != (0x2d0, 0x87, 2):
        raise ValueError('Original packed local-particle boolean registration differs')
    cases, selected = [], []
    for effect_id, index in [('champions/gangplank/14/a558e6df', 1), ('champions/hecarim/0/504952c2', 4)]:
        ref = manifest['definitions'][effect_id]
        encoded = raw(assets / 'latest-effects' / ref['file'])
        if sha(encoded) != ref['sha256']:
            raise ValueError('Prepared source definition differs')
        source = json.loads(encoded)['definition']['complexEmitterDefinitionData'][index]
        shape = source.get('SpawnShape', {})
        if (source.get('primitive', {}).get('__type') not in [None, 'VfxPrimitiveCameraQuad'] or
                source.get('particleIsLocalOrientation') != 1 or shape.get('__type') != '{ee39916f}' or
                not any(v != 0 for v in shape.get('emitOffset', []))):
            raise ValueError('Actual camera/nonzero-point-offset/local-true fixture required')
        meta = inventory['emitters'][f'{effect_id}:{index}']
        if meta['definitionSha256'] != ref['sha256'] or meta['status'] != 'loaded-fields':
            raise ValueError('Original typed emitter identity differs')
        blob = raw(cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob) != meta['rawSourceSha256']:
            raise ValueError('Typed source BIN differs')
        fields = []
        for row in meta['fields']:
            data = blob[row['offset']:row['offset'] + row['bytes']]
            if sha(data) != row['sha256']:
                raise ValueError('Typed source field span differs')
            fields.append((row['hash'], data))
        if sum(key == prop_hash for key, _ in fields) != 1:
            raise ValueError('Exactly one authored local-particle field required')
        graphs, flags = {}, {}
        for variant in ['authored', 'typed-false']:
            supplied = [struct.pack('<IBB', prop_hash, 0x87, 0) if key == prop_hash and variant == 'typed-false' else data for key, data in fields]
            before = loader.load(supplied)
            after = loader.postload()
            if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
                raise ValueError('Complete original typed camera emitter/postload required')
            flags[variant] = bool(struct.unpack_from('<I', bytes.fromhex(after['objectHex']), 0x2d0)[0] & 2)
            if flags[variant] != (variant == 'authored'):
                raise ValueError('Original typed boolean did not select requested state')
            graphs[variant] = n.prepare_camera({'phase': 'native-postload-callbacks-executed', **after})
            loader.restore_preload_arena()
        common_heap = (max(graph['nextHeap'] for graph in graphs.values()) + 0x1000 + 15) & ~15
        for graph in graphs.values():
            graph['nextHeap'] = common_heap
        selected.append({'effectId': effect_id, 'emitterIndex': index, 'sourceDefinitionSha256': ref['sha256'],
                         'source': source, 'nativeFlags': flags, 'commonRuntimeHeap': common_heap})
        for seed in [1, 0x12345]:
            for schedule in ['identity', 'seven-bases']:
                group = []
                for variant, graph in graphs.items():
                    n.reset_quad(graph, seed, 0)
                    frames, previous = [], [0, 0, 0]
                    for tick in range(args.frames):
                        time = tick / 60
                        current = [time * 130, time * 3, time * 70]
                        az, el = time * .73, math.sin(time * .37) * .3
                        ca, sa, ce, se = math.cos(az), math.sin(az), math.cos(el), math.sin(el)
                        axis = [ce * sa, se, ce * ca]
                        value = {'time': time, 'previous': previous, 'current': current, 'basis': basis_at(schedule, tick),
                                 'viewPosition': [1000 * v for v in axis], 'cameraRight': [ca, 0, -sa],
                                 'cameraUp': [-se * sa, ce, -se * ca], 'viewAxis': axis}
                        frames.append({'input': value, 'output': helper.comparable(n.frame_camera(value))})
                        previous = current
                    births = sum(len(frame['output']['state']['births']) for frame in frames)
                    visible = sum(helper.visible_geometry(frame['output']) for frame in frames)
                    if not births or not visible:
                        raise ValueError('Every camera-offset control requires births and positive indexed geometry')
                    row = {'effectId': effect_id, 'emitterIndex': index, 'primitiveKind': 'camera', 'seedHex': f'{seed:016x}',
                           'schedule': schedule, 'variant': variant, 'frames': frames, 'observedBirths': births,
                           'positiveAreaColoredFrames': visible}
                    group.append(row)
                baseline = group[1]['frames']
                for row in group:
                    row['differencesFromTypedFalse'] = [{'tick': tick,
                        'fields': [k for k in a['output']['state'] if a['output']['state'][k] != b['output']['state'][k]],
                        'geometry': a['output']['geometry'] != b['output']['geometry']}
                        for tick, (a, b) in enumerate(zip(row['frames'], baseline)) if a != b]
                    cases.append(row)
                print(json.dumps({'effectId': effect_id, 'seed': seed, 'schedule': schedule,
                                  'geometryDifferentFrames': sum(a['output']['geometry'] != b['output']['geometry'] for a, b in zip(group[0]['frames'], baseline))}), flush=True)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Native camera-offset observation input drift')
    output = cache / 'research/direct-camera-local-offset-native.json'
    result = {'schema': 1, 'kind': 'native-camera-local-orientation-nonzero-offset-controls',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'], 'decoderImageSha256': profile['decoderImageSha256'],
              'inputs': inputs, 'registration': field, 'selected': selected, 'cases': cases,
              'originalBlocks': list({**loader.blocks, **n.blocks}.values()),
              'scope': {'unchangedAuthoredCameraEmitters': True, 'onlyTypedBooleanVaried': True,
                        'serializedSourceFieldOrderPreserved': True, 'suppliedClockSeedPoseAndMotion': True,
                        'suppliedOrbitCamera': True, 'nativeMatchPlacementRecovered': False,
                        'particleOrientationStreamFullyTranslated': False, 'runtimeAdmissionChanged': False, 'gpuSubmitted': False}}
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()
