"""Original archived Legacy-shape rotation, complete births, RNG and geometry.

All fields pass the unchanged original typed reader/postload. No shape, angle,
axis, probability or native runtime field is supplied in place of its source.
The frame basis, parent translation, seed and clock are component controls.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import sys

import unicorn
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_bound_quad_native import NativeBoundQuad
from vfx_spawn_native import ADDRESSES as A, sha


def basis(schedule, tick):
    if schedule == 'identity':
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    return ([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
            if (tick // 4) % 2 else
            [2, .25, 0, 0, .5, .5, .125, 0, -.25, .5, 1.5, 0, 0, 0, 0, 1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'effects', 'fields', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--component', required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh Legacy-shape native receipt required')
    inputs = {}

    def raw(file):
        file = Path(file).resolve()
        data, key = file.read_bytes(), str(file)
        if key in inputs and inputs[key] != sha(data):
            raise ValueError('Original Legacy-shape source changed: '+key)
        inputs[key] = sha(data)
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
    effects_bytes = raw(args.effects/'manifest.json')
    effects = json.loads(effects_bytes)
    field_manifest = read(args.fields/'manifest.json')
    if (sha(image) != profile['decoderImageSha256'] or
            field_manifest['kind'] != 'original-scene-vfx-field-inputs' or
            field_manifest['effectsManifestSha256'] != sha(effects_bytes) or
            field_manifest['sceneManifestSha256'] != effects['sceneManifestSha256'] or
            effects['build'] != profile['clientVersion'] or effects['protocol'] != profile['protocolDigest']):
        raise ValueError('Matching archived fields, scene, effects and native image required')
    declared = {row['file']: row for row in field_manifest['files']}

    def selected(file):
        if file not in declared or not (args.fields/file).resolve().is_relative_to(args.fields.resolve()):
            raise ValueError('Undeclared archived Legacy-shape input')
        data = raw(args.fields/file)
        if len(data) != declared[file]['bytes'] or sha(data) != declared[file]['sha256']:
            raise ValueError('Archived Legacy-shape field file differs')
        return data

    effect_id, index_text = args.component.rsplit(':', 1)
    if not index_text.isascii() or not index_text.isdecimal():
        raise ValueError('Explicit original effectId:emitterIndex required')
    index = int(index_text)
    request = json.loads(selected(field_manifest['input']))
    entry, = [row for row in request['emitters'] if row['effectId'] == effect_id and row['emitterIndex'] == index]
    ref = effects['definitions'][effect_id]
    definition_bytes = raw(args.effects/ref['file'])
    if sha(definition_bytes) != ref['sha256'] or entry['definitionSha256'] != ref['sha256']:
        raise ValueError('Exact original Legacy-shape source definition required')
    source = json.loads(definition_bytes)['definition']['complexEmitterDefinitionData'][index]
    shape = source.get('SpawnShape', {})
    if (shape.get('__type') != 'VfxShapeLegacy' or
            set(shape) != {'__type', 'emitRotationAngles', 'emitRotationAxes'} or
            len(shape['emitRotationAngles']) != 2 or len(shape['emitRotationAxes']) != 2 or
            source.get('isSingleParticle') != 1):
        raise ValueError('Bounded authored two-axis single-particle Legacy shape required')
    blob = selected(entry['binFile'])
    if sha(blob) != entry['binSha256']:
        raise ValueError('Original Legacy shape BIN differs')
    fields = []
    for span in entry['fields']:
        data = blob[span['offset']:span['offset']+span['bytes']]
        if len(data) != span['bytes'] or sha(data) != span['sha256'] or int.from_bytes(data[:4], 'little') != int(span['fieldHash'], 16):
            raise ValueError('Original Legacy-shape typed span differs')
        fields.append(data)
    loader = NativeVfxPostload(args.package, args.client)
    native = NativeBoundQuad(args.package, args.client)
    for owner in [loader, native]:
        owner.call(0x14aa3bf, {}, end=0x14aa5f9)
    before, after = loader.load(fields), loader.postload()
    if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
        raise ValueError('Complete original typed fields and postload required')
    graph = native.prepare_bound({'phase': 'native-postload-callbacks-executed', **after})
    shape_pointer = struct.unpack_from('<Q', bytes.fromhex(after['objectHex']), 0x238)[0]
    shape_types = [row['type'] for row in after['visits'] if row['object'] == shape_pointer]
    shape_object = bytes.fromhex(after['heapHex'])[shape_pointer-after['heapStart']:shape_pointer-after['heapStart']+0x40]
    if len(shape_object) != 0x40 or shape_object[8:20] != bytes(12) or shape_object[24:32] != bytes(8):
        raise ValueError('Original omitted Legacy emitOffset constructor defaults differ')
    frame_calls, before_chance_calls, after_chance_calls, random_calls = [], [], [], []

    def entering(uc, address, size, user):
        pointer = uc.reg_read(r.UC_X86_REG_RSI)
        return_address = native.q(uc.reg_read(r.UC_X86_REG_RSP))
        state = {'inputPointer': pointer, 'returnRva': return_address-native.base,
                 'inputHex': bytes(uc.mem_read(pointer, 0x20)).hex(),
                 'rngBeforeHex': bytes(uc.mem_read(A['stream']+8, 12)).hex()}
        frame_calls.append(state)

        def returned(inner, _address, _size, _user):
            state['outputHex'] = bytes(inner.mem_read(pointer, 0x20)).hex()
            state['rngAfterHex'] = bytes(inner.mem_read(A['stream']+8, 12)).hex()
            inner.hook_del(state.pop('_hook'))
        state['_hook'] = uc.hook_add(unicorn.UC_HOOK_CODE, returned,
                                    begin=return_address, end=return_address)

    native.u.hook_add(unicorn.UC_HOOK_CODE, entering,
                      begin=native.base+0x170a850, end=native.base+0x170a850)
    # The sample callback returns authored rotation declarations. Original +30
    # runs before chance; original +38 samples/rotates after retained chance.
    native.reset_quad(graph, 1, 0)
    shape_at = native.q(A['definition']+0x238)
    before_chance_rva = native.q(native.q(shape_at)+0x30)-native.base
    after_chance_rva = native.q(native.q(shape_at)+0x38)-native.base
    if not all(0 <= address < len(image) for address in [before_chance_rva, after_chance_rva]):
        raise ValueError('Owned original Legacy birth callbacks required')

    def capture_rotation(uc, address, size, user):
        pointer = uc.reg_read(r.UC_X86_REG_RSI)
        return_address = native.q(uc.reg_read(r.UC_X86_REG_RSP))
        state = {'inputPointer': pointer, 'returnRva': return_address-native.base,
                 'inputHex': bytes(uc.mem_read(pointer, 0x2c)).hex(),
                 'rngBeforeHex': bytes(uc.mem_read(A['stream']+8, 12)).hex()}
        user.append(state)

        def returned(inner, _address, _size, _user):
            state['outputHex'] = bytes(inner.mem_read(pointer, 0x2c)).hex()
            state['rngAfterHex'] = bytes(inner.mem_read(A['stream']+8, 12)).hex()
            inner.hook_del(state.pop('_hook'))
        state['_hook'] = uc.hook_add(unicorn.UC_HOOK_CODE, returned,
                                    begin=return_address, end=return_address)

    native.u.hook_add(unicorn.UC_HOOK_CODE, capture_rotation, user_data=before_chance_calls,
                      begin=native.base+before_chance_rva, end=native.base+before_chance_rva)
    native.u.hook_add(unicorn.UC_HOOK_CODE, capture_rotation, user_data=after_chance_calls,
                      begin=native.base+after_chance_rva, end=native.base+after_chance_rva)

    def capture_random(uc, address, size, user):
        return_address = native.q(uc.reg_read(r.UC_X86_REG_RSP))
        state = {'returnRva': return_address-native.base,
                 'beforeHex': bytes(uc.mem_read(A['stream']+8, 12)).hex()}
        random_calls.append(state)

        def returned(inner, _address, _size, _user):
            state['afterHex'] = bytes(inner.mem_read(A['stream']+8, 12)).hex()
            state['resultHex'] = struct.pack('<I', inner.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff).hex()
            inner.hook_del(state.pop('_hook'))
        state['_hook'] = uc.hook_add(unicorn.UC_HOOK_CODE, returned,
                                    begin=return_address, end=return_address)

    native.u.hook_add(unicorn.UC_HOOK_CODE, capture_random,
                      begin=native.base+0x1490eb0, end=native.base+0x1490eb0)
    cases = []
    for seed in [0, 1, 0x12345, 0xffffffffffffffff]:
        for schedule in ['identity', 'changing']:
            native.reset_quad(graph, seed, 0)
            native.call(0x14aa3bf, {}, end=0x14aa5f9)
            shape_at = native.q(A['definition']+0x238)
            if native.q(native.q(shape_at)+0x28) != native.base+0x170a850:
                raise ValueError('Original Legacy shape sampler entry differs')
            frames, previous = [], [123., 45., -67.]
            for tick in range(31):
                time = tick/60
                current = [123+time*130, 45+time*3, -67+time*70]
                value = {'time': time, 'previous': previous, 'current': current,
                         'basis': basis(schedule, tick), 'viewPosition': [0, 1000, 0],
                         'cameraRight': [1, 0, 0], 'cameraUp': [0, 0, -1],
                         'viewAxis': [0, -1, 0], 'multTexturePresent': False}
                frame_calls.clear()
                before_chance_calls.clear()
                after_chance_calls.clear()
                random_calls.clear()
                output = native.frame_bound(value)
                if any('_hook' in row for rows in [frame_calls, before_chance_calls, after_chance_calls, random_calls] for row in rows):
                    raise ValueError('Original Legacy shape or RNG callback did not return')
                for call in after_chance_calls:
                    if bytes.fromhex(call['inputHex'])[8:0x2c] != bytes(0x24) or bytes.fromhex(call['outputHex'])[8:0x2c] != bytes(0x24):
                        raise ValueError('Bounded original zero-vector shape path required')
                frames.append({'input': value, 'output': output, 'shapeCalls': list(frame_calls),
                               'beforeChanceShapeCalls': list(before_chance_calls),
                               'afterChanceShapeCalls': list(after_chance_calls), 'randomCalls': list(random_calls)})
                previous = current
            births = sum(len(frame['output']['state']['births']) for frame in frames)
            calls = sum(len(frame['shapeCalls']) for frame in frames)
            if not births or births != calls or not any(frame['output']['geometry']['indicesHex'] for frame in frames):
                raise ValueError('Every original birth and native indexed geometry must be observed')
            cases.append({'effectId': effect_id, 'emitterIndex': index, 'seedHex': f'{seed:016x}',
                          'schedule': schedule, 'frames': frames})
            print(json.dumps({'component': args.component, 'seed': seed, 'schedule': schedule,
                              'births': births, 'shapeCalls': calls, 'frames': len(frames)}), flush=True)
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original Legacy-shape input/source drift: '+file)
    blocks = {row['rva']: row for owner in [loader, native] for row in owner.blocks.values()}
    result = {'schema': 1, 'kind': 'original-archived-legacy-shape-rotation-controls',
              'build': effects['build'], 'protocol': effects['protocol'], 'decoderImageSha256': sha(image),
              'effectsManifestSha256': sha(effects_bytes), 'sceneManifestSha256': effects['sceneManifestSha256'],
              'selected': {'effectId': effect_id, 'emitterIndex': index, 'definitionSha256': ref['sha256'],
                           'binSha256': entry['binSha256'], 'source': source, 'shapeTypes': shape_types,
                           'shapeObjectHex': shape_object.hex(),
                           'beforeChanceShapeRva': before_chance_rva,
                           'afterChanceShapeRva': after_chance_rva,
                           'shapeTypeDescriptors': {f'{identity:08x}': loader.type_catalog[f'{identity:08x}'] for identity in shape_types}},
              'cases': cases, 'inputs': inputs, 'originalBlocks': list(blocks.values()),
              'scope': {'completeOriginalFieldsAndPostload': True, 'fullPristineInitializerAfterReset': True,
                        'originalShapeEntryAndReturnObserved': True, 'suppliedBasisClockCameraMotionSeed': True,
                        'authoredShapeChanged': False, 'rngDrawsOmitted': False,
                        'runtimeAdmissionChanged': False, 'actualReplayActivation': False,
                        'gpuSubmitted': False, 'nativeSpectatorAdmitted': False}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'sourceDrift': 0}), flush=True)


if __name__ == '__main__':
    main()
