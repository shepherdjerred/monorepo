"""V38 arbitrary-quad birth orientation with complete original typed emitters.

Only the typed rotation-enable boolean differs between controls. Complete source
birth angles and absent/default integrated controller are preserved. Supplied
poses/cameras are component controls, not recovered actual projectile bases.
"""
import argparse
import importlib.util
import inspect
import json
import math
from pathlib import Path
import struct

from vfx_postload_native import NativeVfxPostload
from vfx_camera_quad_native import NativeCameraQuad
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha, name_hash

helper_path = Path(__file__).with_name('probe-direct-zero-position.py')
spec = importlib.util.spec_from_file_location('owned_zero_position_controls', helper_path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--component', action='append', required=True)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    assets = cache / 'public'
    decoder = assets / 'decoder-16.21-macos'
    def raw(path):
        data = path.read_bytes()
        key, digest = str(path.resolve()), sha(data)
        if key in inputs and inputs[key] != digest:
            raise ValueError('Native orientation input changed')
        inputs[key] = digest
        return data
    def read(path):
        return json.loads(raw(path))
    manifest_bytes = raw(assets / 'latest-effects/manifest.json')
    manifest = json.loads(manifest_bytes)
    inventory_bytes = raw(decoder / 'vfx-assets.json')
    inventory = json.loads(inventory_bytes)
    loader = NativeVfxPostload(decoder, args.client)
    if sha(inventory_bytes) != loader.profile['vfxAssetsSha256'] or inventory['effectsManifestSha256'] != sha(manifest_bytes):
        raise ValueError('Exact profile-pinned emitter inventory and manifest required')
    prop_hash = name_hash('isRotationEnabled')
    field = next(p for p in loader.type_catalog['09cde442']['properties'] if p['hash'] == prop_hash)
    if (field['offset'], field['type'], field['mask']) != (0x2d1, 0x87, 1):
        raise ValueError('Original rotation-enabled packed boolean registration changed')
    rotation_field = next(p for p in loader.type_catalog['09cde442']['properties'] if p['hash'] == name_hash('rotation0'))
    if rotation_field['offset'] != 0x438 or rotation_field['type'] != 131:
        raise ValueError('Original integrated rotation property changed')
    cases, selected, natives, seen = [], [], {}, set()
    for argument in args.component:
        effect_id, index_text = argument.rsplit(':', 1)
        if not index_text.isascii() or not index_text.isdecimal():
            raise ValueError('Explicit effectId:emitterIndex required')
        index = int(index_text)
        if (effect_id, index) in seen:
            raise ValueError('Duplicate orientation comparison component')
        seen.add((effect_id, index))
        ref = manifest['definitions'][effect_id]
        encoded = raw(assets / 'latest-effects' / ref['file'])
        if sha(encoded) != ref['sha256']:
            raise ValueError('Prepared source definition changed')
        source = json.loads(encoded)['definition']['complexEmitterDefinitionData'][index]
        kind = 'loaded'
        if source.get('primitive', {}).get('__type') != 'VfxPrimitiveArbitraryQuad' or source.get('rotation0') is not None:
            raise ValueError('Bounded authored arbitrary quad with absent integrated controller required')
        if kind not in natives:
            natives[kind] = (NativeLoadedQuad if kind == 'loaded' else NativeCameraQuad)(decoder, args.client)
        n = natives[kind]
        meta = inventory['emitters'][f'{effect_id}:{index}']
        if meta['definitionSha256'] != ref['sha256'] or meta['status'] != 'loaded-fields':
            raise ValueError('Original emitter field inventory identity differs')
        blob = raw(cache / 'research/latest-effects/bins' /
                   f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob) != meta['rawSourceSha256']:
            raise ValueError('Original emitter BIN source changed')
        fields = []
        for f in meta['fields']:
            data = blob[f['offset']:f['offset'] + f['bytes']]
            if sha(data) != f['sha256']:
                raise ValueError('Original emitter field span changed')
            fields.append((f['hash'], data))
        if sum(identity == prop_hash for identity, _ in fields) > 1:
            raise ValueError('Duplicate authored particle-local property')
        graphs, native_flags, postload_metadata = {}, {}, {}
        for variant in ['false', 'true']:
            replacement = struct.pack('<IBB', prop_hash, 0x87, int(variant == 'true'))
            supplied, found = [], False
            for identity, data in fields:
                if identity != prop_hash or variant == 'authored':
                    supplied.append(data)
                elif variant in ['false', 'true']:
                    supplied.append(replacement)
                if identity == prop_hash:
                    found = True
            if not found and variant in ['false', 'true']:
                supplied.append(replacement)
            before = loader.load(supplied)
            after = loader.postload()
            if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
                raise ValueError('Unresolved original particle-local load/postload')
            flag = bool(bytes.fromhex(after['objectHex'])[0x2d1] & 1)
            expected = variant == 'true'
            if flag != expected:
                raise ValueError('Original typed particle-local boolean/default differs')
            state = {'phase': 'native-postload-callbacks-executed', **after}
            graphs[variant] = n.prepare_loaded(state) if kind == 'loaded' else n.prepare_camera(state)
            native_flags[variant] = flag
            postload_metadata[variant] = {
                'rotationObjectHex': bytes.fromhex(after['objectHex'])[0x438:0x450].hex(),
                'visits': [v for v in after['visits'] if v['object'] == 0x10020000 + 0x438],
                'allVisits': after['visits'],
                'heapStart': after['heapStart'], 'heapHex': after['heapHex'],
            }
            loader.restore_preload_arena()
        common_heap = (max(g['nextHeap'] for g in graphs.values()) + 0x1000 + 15) & ~15
        for graph in graphs.values():
            graph['nextHeap'] = common_heap
        selected.append({'effectId': effect_id, 'emitterIndex': index, 'primitiveKind': kind,
                         'source': source, 'nativeFlags': native_flags, 'commonRuntimeHeap': common_heap,
                         'rotationPostload': postload_metadata})
        for seed in [1, 0x12345]:
            for schedule in ['identity', 'yaw90', 'pitch90', 'roll45', 'shear', 'nonorthogonal', 'scaled', 'seven-bases']:
                group = []
                for variant, graph in graphs.items():
                    n.reset_quad(graph, seed, 0)
                    previous, frames = [0, 0, 0], []
                    for tick in range(61):
                        time = tick / 60
                        current = [time * 130, time * 3, time * 70]
                        pose = schedule if schedule != 'seven-bases' else ['identity', 'yaw90', 'pitch90', 'roll45', 'shear', 'nonorthogonal', 'scaled'][(tick // 8) % 7]
                        rotated = pose == 'yaw90' or pose == 'changing' and 30 <= tick < 90
                        basis = ([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] if rotated else
                                 [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                        if pose == 'pitch90':
                            basis = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
                        elif pose == 'roll45':
                            c = math.sqrt(0.5)
                            basis = [c, c, 0, 0, -c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                        elif pose == 'shear':
                            basis = [1, .25, 0, 0, .5, 1, .125, 0, -.25, .5, 1, 0, 0, 0, 0, 1]
                        elif pose == 'nonorthogonal':
                            basis = [1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1]
                        elif pose == 'scaled':
                            basis = [2, 0, 0, 0, 0, .5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1]
                        azimuth, elevation = time * .73, math.sin(time * .37) * .3
                        ca, sa, ce, se = math.cos(azimuth), math.sin(azimuth), math.cos(elevation), math.sin(elevation)
                        axis = [ce * sa, se, ce * ca]
                        frame = {'time': time, 'previous': previous, 'current': current, 'basis': basis,
                                 'viewPosition': [1000 * v for v in axis], 'cameraRight': [ca, 0, -sa],
                                 'cameraUp': [-se * sa, ce, -se * ca], 'viewAxis': axis}
                        output = n.frame_quad(frame) if kind == 'loaded' else n.frame_camera(frame)
                        frames.append({'input': frame, 'output': helper.comparable(output)})
                        previous = current
                    births = sum(len(f['output']['state']['births']) for f in frames)
                    visible = sum(helper.visible_geometry(f['output']) for f in frames)
                    if not births or not visible:
                        raise ValueError('Particle-local control requires actual births and visible indexed geometry')
                    row = {'effectId': effect_id, 'emitterIndex': index, 'primitiveKind': kind,
                           'seedHex': f'{seed:016x}', 'schedule': schedule, 'variant': variant,
                           'cameraPolicy': 'supplied-yaw-and-pitch-orbit',
                           'frames': frames, 'observedBirths': births, 'positiveAreaColoredFrames': visible}
                    group.append(row)
                absent = next(c for c in group if c['variant'] == 'false')['frames']
                for row in group:
                    row['differencesFromFalse'] = [
                        {'tick': i, 'fields': [k for k in a['output']['state']
                                               if a['output']['state'][k] != b['output']['state'][k]],
                         'geometry': a['output']['geometry'] != b['output']['geometry']}
                        for i, (a, b) in enumerate(zip(row['frames'], absent)) if a != b]
                    cases.append(row)
                print(json.dumps({'effectId': effect_id, 'emitterIndex': index, 'seed': seed, 'schedule': schedule,
                                  'differentFromFalse': {c['variant']: len(c['differencesFromFalse']) for c in group}}), flush=True)
    blocks, paths = {}, {Path(__file__), helper_path}
    for n in [loader, *natives.values()]:
        blocks.update(n.blocks)
        paths.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'native-arbitrary-birth-rotation-quad-controls-v38',
              'build': manifest['build'], 'protocol': manifest['protocol'],
              'decoderImageSha256': loader.profile['decoderImageSha256'], 'registration': field,
              'rotationRegistration': rotation_field,
              'selected': selected, 'cases': cases, 'inputs': inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)}, 'originalBlocks': list(blocks.values()),
              'scope': {'originalTypedReaderPostloadBooleanDefault': True,
                        'authoredSerializedFieldOrderPreserved': True, 'originalEmitterAndGeometry': True,
                        'onlyRotationEnabledBooleanVaried': True, 'suppliedClockSeedPoseAndMotion': True,
                        'nativeMissileBasisRecovered': False, 'absentIntegratedControllerPreserved': True, 'candidateAuthoredBirthRotationRetained': True, 'nativeParentActivation': False,
                        'gpuSubmitted': False, 'compilerAdmissionChanged': False, 'actualMatchActivated': False}}
    output = cache / 'research/direct-arbitrary-birth-rotation-native-v38.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(selected), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__':
    main()
