"""Original archived arbitrary-quad local-particle orientation controls.

Every authored field passes the original typed reader and postload. The paired
control changes only the serialized particle-local boolean. Basis, camera,
motion, seed and clock are explicit component inputs, not recovered replay data.
"""
import argparse
import inspect
import json
import math
from pathlib import Path
import struct
import sys

from vfx_postload_native import NativeVfxPostload
from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import sha, name_hash


def basis_at(schedule, tick):
    c = math.sqrt(.5)
    names = ['identity', 'yaw90', 'pitch90', 'roll45', 'shear', 'nonorthogonal', 'scaled']
    offset = 1 if schedule == 'nonidentity-birth' else 0
    pose = 'identity' if schedule == 'identity' else names[(tick // 4 + offset) % len(names)]
    return {
        'identity': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        'yaw90': [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
        'pitch90': [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
        'roll45': [c, c, 0, 0, -c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        'shear': [1, .25, 0, 0, .5, 1, .125, 0, -.25, .5, 1, 0, 0, 0, 0, 1],
        'nonorthogonal': [1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1],
        'scaled': [2, 0, 0, 0, 0, .5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1],
    }[pose]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'effects', 'fields', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--component', action='append', required=True)
    parser.add_argument('--frames', type=int, default=61)
    parser.add_argument('--origin', type=float, nargs=3, default=[0., 0., 0.])
    args = parser.parse_args()
    if not 57 <= args.frames <= 121:
        raise ValueError('Complete seven-basis schedule requires 57..121 bounded frames')
    if args.output.exists():
        raise ValueError('Fresh original orientation proof output required')
    if any(not math.isfinite(value) or abs(value) > 1e6 for value in args.origin):
        raise ValueError('Bounded finite explicit birth origin required')
    inputs = {}

    def raw(file):
        file = Path(file).resolve()
        data = file.read_bytes()
        digest = sha(data)
        if str(file) in inputs and inputs[str(file)] != digest:
            raise ValueError('Original orientation input changed')
        inputs[str(file)] = digest
        return data

    def read(file):
        return json.loads(raw(file))

    tools = Path(__file__).resolve().parent
    sources = {Path(__file__), args.client}
    for cls in [NativeVfxPostload, NativeBoundQuad]:
        sources.update(Path(inspect.getfile(base)) for base in cls.__mro__ if base is not object)
    sources.update(Path(module.__file__) for module in tuple(sys.modules.values())
                   if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
                   and Path(module.__file__).resolve().is_relative_to(tools))
    for file in sources:
        raw(file)
    profile = read(args.package/'profile.json')
    image = raw(args.package/'image.bin')
    if sha(image) != profile['decoderImageSha256']:
        raise ValueError('Exact original native image required')
    effects_bytes = raw(args.effects/'manifest.json')
    effects = json.loads(effects_bytes)
    field_manifest_bytes = raw(args.fields/'manifest.json')
    field_manifest = json.loads(field_manifest_bytes)
    if (field_manifest['kind'] != 'original-scene-vfx-field-inputs' or
            field_manifest['effectsManifestSha256'] != sha(effects_bytes) or
            field_manifest['sceneManifestSha256'] != effects['sceneManifestSha256'] or
            effects['build'] != profile['clientVersion'] or effects['protocol'] != profile['protocolDigest']):
        raise ValueError('Matching exact archived scene, field inventory and native profile required')
    declared = {ref['file']: ref for ref in field_manifest['files']}

    def selected(file):
        if file not in declared or not (args.fields/file).resolve().is_relative_to(args.fields.resolve()):
            raise ValueError('Undeclared original orientation field input')
        data = raw(args.fields/file)
        ref = declared[file]
        if len(data) != ref['bytes'] or sha(data) != ref['sha256']:
            raise ValueError('Original orientation field source differs')
        return data

    request = json.loads(selected(field_manifest['input']))
    loader = NativeVfxPostload(args.package, args.client)
    native = NativeBoundQuad(args.package, args.client)
    # Use the complete pristine initializer, including the original four-one
    # vector and ARGB suffix. Execute again after every reset of the old fixture.
    for owner in [loader, native]:
        owner.call(0x14aa3bf, {}, end=0x14aa5f9)
    flag_hash = name_hash('particleIsLocalOrientation')
    bind_hash = name_hash('bindWeight')
    bind_registration = next(row for row in loader.type_catalog['09cde442']['properties'] if row['hash'] == bind_hash)
    if (bind_registration['offset'], bind_registration['type']) != (0x3a0, 0x83):
        raise ValueError('Original typed bind-weight layout differs')
    registration = next(row for row in loader.type_catalog['09cde442']['properties'] if row['hash'] == flag_hash)
    if (registration['offset'], registration['type'], registration['mask']) != (0x2d0, 0x87, 2):
        raise ValueError('Original particle-local typed boolean differs')
    selected_rows, cases, seen = [], [], set()
    for argument in args.component:
        effect_id, index_text = argument.rsplit(':', 1)
        if not index_text.isascii() or not index_text.isdecimal():
            raise ValueError('Explicit effectId:emitterIndex required')
        index = int(index_text)
        if (effect_id, index) in seen:
            raise ValueError('Duplicate native orientation component')
        seen.add((effect_id, index))
        entry, = [row for row in request['emitters'] if row['effectId'] == effect_id and row['emitterIndex'] == index]
        reference = effects['definitions'][effect_id]
        definition_bytes = raw(args.effects/reference['file'])
        if sha(definition_bytes) != reference['sha256'] or entry['definitionSha256'] != reference['sha256']:
            raise ValueError('Exact original orientation definition required')
        source = json.loads(definition_bytes)['definition']['complexEmitterDefinitionData'][index]
        if source.get('primitive', {}).get('__type') != 'VfxPrimitiveArbitraryQuad':
            raise ValueError('This control currently admits only original arbitrary-quad writers')
        blob = selected(entry['binFile'])
        if sha(blob) != entry['binSha256']:
            raise ValueError('Original orientation BIN differs')
        fields = []
        for span in entry['fields']:
            data = blob[span['offset']:span['offset']+span['bytes']]
            if len(data) != span['bytes'] or sha(data) != span['sha256'] or int.from_bytes(data[:4], 'little') != int(span['fieldHash'], 16):
                raise ValueError('Original serialized orientation field span differs')
            fields.append((int(span['fieldHash'], 16), data))
        if sum(identity == flag_hash for identity, _ in fields) != 1:
            raise ValueError('One actual authored particle-local flag required')
        graphs, flags = {}, {}
        for variant in ['authored', 'typed-false']:
            supplied = [struct.pack('<IBB', flag_hash, 0x87, 0) if identity == flag_hash and variant == 'typed-false' else data for identity, data in fields]
            before = loader.load(supplied)
            after = loader.postload()
            if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
                raise ValueError('Complete original orientation typed reader/postload required')
            flags[variant] = bool(struct.unpack_from('<I', bytes.fromhex(after['objectHex']), 0x2d0)[0] & 2)
            if flags[variant] != (bool(source['particleIsLocalOrientation']) if variant == 'authored' else False):
                raise ValueError('Original orientation flag differs')
            if 'bindWeight' not in source:
                bind_value = bytes.fromhex(after['objectHex'])[0x3a0:0x3b0]
                # +4..+7 is native alignment padding, not a serialized value.
                if bind_value[:4] != bytes(4) or bind_value[8:] != bytes(8):
                    raise ValueError('Original absent bind-weight must retain constructor-zero value and null dynamics')
            graphs[variant] = native.prepare_bound({'phase': 'native-postload-callbacks-executed', **after})
            loader.restore_preload_arena()
        common_heap = (max(graph['nextHeap'] for graph in graphs.values())+0x1000+15) & ~15
        for graph in graphs.values():
            graph['nextHeap'] = common_heap
        selected_rows.append({'effectId': effect_id, 'emitterIndex': index, 'definitionSha256': reference['sha256'],
                              'binSha256': entry['binSha256'], 'source': source, 'nativeFlags': flags})
        for seed in [1, 0x12345]:
            for schedule in ['identity', 'seven-bases', 'nonidentity-birth']:
                for variant, graph in graphs.items():
                    native.reset_quad(graph, seed, 0)
                    native.call(0x14aa3bf, {}, end=0x14aa5f9)
                    frames, previous = [], list(args.origin)
                    for tick in range(args.frames):
                        time = tick/60
                        current = [value + offset for value, offset in zip(args.origin, [time*130, time*3, time*70])]
                        frame = {'time': time, 'previous': previous, 'current': current, 'basis': basis_at(schedule, tick),
                                 'viewPosition': [0, 1000, 0], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 0, -1],
                                 'viewAxis': [0, -1, 0], 'multTexturePresent': False}
                        output = native.frame_bound(frame)
                        frames.append({'input': frame, 'output': output})
                        previous = current
                    births = sum(len(row['output']['state']['births']) for row in frames)
                    geometry = sum(bool(row['output']['geometry']['indicesHex']) for row in frames)
                    if not births or not geometry:
                        raise ValueError('Original orientation control requires births and indexed geometry')
                    active_bases = {tuple(row['input']['basis']) for row in frames if row['output']['geometry']['indicesHex']}
                    if len(active_bases) != (1 if schedule == 'identity' else 7):
                        raise ValueError('Every supplied basis must execute while source particles remain alive')
                    cases.append({'effectId': effect_id, 'emitterIndex': index, 'seedHex': f'{seed:016x}',
                                  'schedule': schedule, 'variant': variant, 'frames': frames})
                    print(json.dumps({'component': argument, 'seed': seed, 'schedule': schedule, 'variant': variant,
                                      'frames': len(frames), 'births': births, 'indexedFrames': geometry}), flush=True)
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original orientation proof input/source drift: '+file)
    blocks = {block['rva']: block for owner in [loader, native] for block in owner.blocks.values()}
    result = {'schema': 1, 'kind': 'original-archived-arbitrary-particle-orientation', 'build': effects['build'],
              'protocol': effects['protocol'], 'decoderImageSha256': sha(image), 'sceneManifestSha256': effects['sceneManifestSha256'],
              'effectsManifestSha256': sha(effects_bytes), 'registration': registration, 'selected': selected_rows,
                              'cases': cases, 'birthOrigin': args.origin, 'bindWeightRegistration': bind_registration,
                              'inputs': inputs, 'originalBlocks': list(blocks.values()),
              'scope': {'completeAuthoredFields': True, 'originalTypedReaderAndPostload': True,
                        'fullPristineInitializerAfterReset': True, 'onlySerializedParticleLocalFlagVaried': True,
                        'explicitSuppliedBasisClockCameraMotionAndSeed': True, 'replayBasisRecovered': False,
                        'materialAcquisition': False, 'matchActivation': False, 'nativeSpectatorAdmitted': False}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'frames': sum(len(row['frames']) for row in cases), 'sourceDrift': 0}), flush=True)


if __name__ == '__main__':
    main()
