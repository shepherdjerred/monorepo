"""Original singleton-zero EmitterPosition versus absent/default and constant zero.

Complete source emitter fields use original deserialization and postload.
Only the compared position declaration differs. Clocks, seeds and poses are
supplied component controls; no parent/resource/world admission is implied.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

from vfx_postload_native import NativeVfxPostload
from vfx_camera_quad_native import NativeCameraQuad
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha, name_hash


ZERO = {'__type': 'ValueVector3', 'dynamics': {
    '__type': 'VfxAnimatedVector3fVariableData', 'times': [0], 'values': [[0, 0, 0]],
    'probabilityTables': [{'__type': 'VfxProbabilityTableData'} for _ in range(3)]}}


def value_equal(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def comparable(output):
    state = output['state']
    return {'state': {key: state[key] for key in ['births', 'vectors', 'rngHex', 'actorHex', 'poolHex']},
            'geometry': {key: output['geometry'][key] for key in ['verticesHex', 'indicesHex', 'drawHex']}}


def visible_geometry(output):
    packed = bytes.fromhex(output['geometry']['verticesHex'])
    if not output['geometry']['indicesHex']:
        return False
    for offset in range(0, len(packed), 112):
        points = [struct.unpack_from('<3f', packed, offset + i * 28) for i in range(3)]
        a = [points[1][i] - points[0][i] for i in range(3)]
        b = [points[2][i] - points[0][i] for i in range(3)]
        cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
        if any(v != 0 for v in cross) and packed[offset + 15] > 0:
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--frames', type=int, default=61)
    parser.add_argument('--component', action='append', required=True,
                        help='Explicit immutable effectId:emitterIndex comparison fixture')
    args = parser.parse_args()
    if not 1 <= args.frames <= 121:
        raise ValueError('Bounded component frame count required')
    cache = args.cache.resolve()
    assets = cache / 'public'
    decoder = assets / 'decoder-16.21-macos'
    inputs = {}

    def raw(path):
        data = path.read_bytes()
        digest = sha(data)
        key = str(path.resolve())
        if key in inputs and inputs[key] != digest:
            raise ValueError('Input changed while observing: ' + key)
        inputs[key] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    manifest = read(assets / 'latest-effects/manifest.json')
    inventory = read(decoder / 'vfx-assets.json')
    selection = []
    for argument in args.component:
        effect_id, index = argument.rsplit(':', 1)
        if not index.isascii() or not index.isdecimal() or effect_id not in manifest['definitions']:
            raise ValueError('Explicit prepared effectId:emitterIndex required')
        component = {'definitionId': effect_id, 'emitterIndex': int(index)}
        if component in selection:
            raise ValueError('Duplicate comparison component')
        selection.append(component)
    loader = NativeVfxPostload(decoder, args.client)
    field = next(p for p in loader.type_catalog['09cde442']['properties']
                 if p['hash'] == name_hash('EmitterPosition'))
    if field['type'] != 131 or field['offset'] != 0x240:
        raise ValueError('Original embedded EmitterPosition property changed')
    constant_zero = (struct.pack('<IBIIH', name_hash('EmitterPosition'), 131, 0x68dc32b6, 19, 1) +
                     struct.pack('<IBfff', name_hash('constantValue'), 12, 0, 0, 0))
    cases, blocks, sources, selected = [], {}, {Path(__file__)}, []
    native_by_kind = {}
    for candidate in selection:
        effect_id, index = candidate['definitionId'], candidate['emitterIndex']
        ref = manifest['definitions'][effect_id]
        source_bytes = raw(assets / 'latest-effects' / ref['file'])
        if sha(source_bytes) != ref['sha256']:
            raise ValueError('Selected source definition changed')
        source = json.loads(source_bytes)['definition']['complexEmitterDefinitionData'][index]
        if not value_equal(source.get('EmitterPosition'), ZERO):
            continue
        kind = 'loaded' if source.get('primitive', {}).get('__type') == 'VfxPrimitiveArbitraryQuad' else 'camera'
        if kind not in native_by_kind:
            native_by_kind[kind] = (NativeLoadedQuad if kind == 'loaded' else NativeCameraQuad)(decoder, args.client)
        n = native_by_kind[kind]
        meta = inventory['emitters'][f'{effect_id}:{index}']
        bin_path = cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin"
        blob = raw(bin_path)
        if sha(blob) != meta['rawSourceSha256'] or meta['status'] != 'loaded-fields':
            raise ValueError('Exact complete original emitter BIN fields required')
        fields = []
        for f in meta['fields']:
            encoded = blob[f['offset']:f['offset'] + f['bytes']]
            if sha(encoded) != f['sha256']:
                raise ValueError('Original serialized field span changed')
            fields.append((f['hash'], encoded))
        graphs, before_records = {}, {}
        if sum(identity == name_hash('EmitterPosition') for identity, _ in fields) != 1:
            raise ValueError('Exactly one source EmitterPosition declaration required')
        for variant in ['authored', 'constant-zero', 'absent']:
            supplied = []
            for identity, encoded in fields:
                if identity != name_hash('EmitterPosition') or variant == 'authored':
                    supplied.append(encoded)
                elif variant == 'constant-zero':
                    supplied.append(constant_zero)
            before = loader.load(supplied)
            after = loader.postload()
            if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
                raise ValueError('Position variant has unresolved original loading/postload behavior')
            state = {'phase': 'native-postload-callbacks-executed', **after}
            graph = n.prepare_loaded(state) if kind == 'loaded' else n.prepare_camera(state)
            graphs[variant] = graph
            before_records[variant] = {'objectHex': after['objectHex'], 'heapHex': after['heapHex'],
                                       'heapStart': after['heapStart'], 'nextHeap': graph['nextHeap']}
            loader.restore_preload_arena()
        # Reserve the same unused owned static arena in each control. Runtime
        # particle pointer bytes remain directly compared rather than masked.
        common_heap = (max(g['nextHeap'] for g in graphs.values()) + 0x1000 + 15) & ~15
        for graph in graphs.values():
            graph['nextHeap'] = common_heap
        selected.append({'effectId': effect_id, 'emitterIndex': index, 'primitiveKind': kind,
                         'source': source, 'originalPositionField': field,
                         'postloadedVariants': before_records, 'commonRuntimeHeap': common_heap})
        for seed in [1, 0x12345]:
            for pose in ['identity', 'yaw90', 'pitch90', 'changing']:
                reference = None
                for variant, graph in graphs.items():
                    n.reset_quad(graph, seed, 0)
                    previous, frames = [0, 0, 0], []
                    for tick in range(args.frames):
                        time = tick / 60
                        current = [time * 130, time * 3, time * 70]
                        rotated = pose == 'yaw90' or pose == 'changing' and 15 <= tick < 45
                        basis = ([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] if rotated else
                                 [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                        if pose == 'pitch90':
                            basis = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
                        frame = {'time': time, 'previous': previous, 'current': current,
                                 'basis': basis, 'viewPosition': [0, 0, 1000],
                                 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                        output = n.frame_quad(frame) if kind == 'loaded' else n.frame_camera(frame)
                        frames.append({'input': frame, 'output': comparable(output)})
                        previous = current
                    differences = [] if reference is None else [i for i, (a, b) in enumerate(zip(reference, frames)) if a != b]
                    births = sum(len(f['output']['state']['births']) for f in frames)
                    visible_frames = sum(visible_geometry(f['output']) for f in frames)
                    if not births or not visible_frames:
                        raise ValueError('Position equivalence requires actual births and positive-area colored original geometry')
                    if reference is None:
                        reference = frames
                    cases.append({'effectId': effect_id, 'emitterIndex': index, 'primitiveKind': kind,
                                  'seedHex': f'{seed:016x}', 'pose': pose, 'variant': variant,
                                  'frames': frames, 'differentFrames': differences,
                                  'observedBirths': births, 'positiveAreaColoredFrames': visible_frames})
                print(json.dumps({'effectId': effect_id, 'emitterIndex': index, 'seed': seed,
                                  'pose': pose, 'differences': [len(c['differentFrames']) for c in cases[-3:]]}), flush=True)
    if not selected:
        raise ValueError('No exact singleton-zero source component selected')
    for n in [loader, *native_by_kind.values()]:
        blocks.update(n.blocks)
        sources.update(Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'native-singleton-zero-emitter-position-controls',
              'build': manifest['build'], 'protocol': manifest['protocol'],
              'decoderImageSha256': loader.profile['decoderImageSha256'],
              'selected': selected, 'cases': cases, 'inputs': inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'originalBlocks': list(blocks.values()),
              'scope': {'completeSourceEmitterFields': True, 'originalTypedReaderAndPostload': True,
                        'onlyPositionDeclarationVaried': True, 'suppliedClockSeedPoseAndMotion': True,
                        'originalEmitterUpdateAndGeometry': True, 'nativeParentActivation': False,
                        'materialBindingsVerified': False, 'actualMatchActivated': False, 'gpuSubmitted': False}}
    output = cache / 'research/direct-zero-position-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(selected), 'cases': len(cases),
                      'frames': sum(len(c['frames']) for c in cases),
                      'differentFrames': sum(len(c['differentFrames']) for c in cases)}))
    if any(c['differentFrames'] for c in cases):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
