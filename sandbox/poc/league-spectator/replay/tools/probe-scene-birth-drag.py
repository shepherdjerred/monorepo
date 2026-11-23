"""Complete archived native birth drag/angular-RNG and quad update controls.

The original typed source and postload remain unchanged. Parent poses, clocks,
seeds and camera are explicit component inputs, not recovered replay providers.
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
from vfx_spawn_native import ADDRESSES as A, sha, name_hash
from vfx_system_asset_native import NativeVfxSystemAssets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'effects', 'fields', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--component', required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh archived birth-drag receipt required')
    inputs = {}

    def raw(file):
        file = Path(file).resolve()
        data = file.read_bytes()
        if str(file) in inputs and inputs[str(file)] != sha(data):
            raise ValueError('Original birth-drag input drift: '+str(file))
        inputs[str(file)] = sha(data)
        return data

    def read(file):
        return json.loads(raw(file))

    tools = Path(__file__).resolve().parent
    sources = {Path(__file__), args.client}
    for cls in [NativeVfxPostload, NativeBoundQuad, NativeVfxSystemAssets]:
        sources.update(Path(inspect.getfile(base)) for base in cls.__mro__ if base is not object)
    sources.update(Path(module.__file__) for module in tuple(sys.modules.values())
                   if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
                   and Path(module.__file__).resolve().is_relative_to(tools))
    for file in sources:
        raw(file)
    profile = read(args.package/'profile.json')
    image = raw(args.package/'image.bin')
    effects_bytes = raw(args.effects/'manifest.json')
    effects, inventory = json.loads(effects_bytes), read(args.fields/'manifest.json')
    if (sha(image) != profile['decoderImageSha256'] or
            inventory['kind'] != 'original-scene-vfx-field-inputs' or
            inventory['effectsManifestSha256'] != sha(effects_bytes) or
            inventory['sceneManifestSha256'] != effects['sceneManifestSha256'] or
            effects['build'] != profile['clientVersion'] or effects['protocol'] != profile['protocolDigest']):
        raise ValueError('Matching archived source and native image required')
    files = {row['file']: row for row in inventory['files']}

    def selected(file):
        if file not in files or not (args.fields/file).resolve().is_relative_to(args.fields.resolve()):
            raise ValueError('Undeclared birth-drag source')
        data = raw(args.fields/file)
        if len(data) != files[file]['bytes'] or sha(data) != files[file]['sha256']:
            raise ValueError('Birth-drag source bytes differ')
        return data

    effect_id, index_text = args.component.rsplit(':', 1)
    if not index_text.isascii() or not index_text.isdecimal():
        raise ValueError('Explicit source effectId:emitterIndex required')
    index = int(index_text)
    request = json.loads(selected(inventory['input']))
    entry, = [row for row in request['emitters'] if row['effectId'] == effect_id and row['emitterIndex'] == index]
    ref = effects['definitions'][effect_id]
    definition_bytes = raw(args.effects/ref['file'])
    if sha(definition_bytes) != ref['sha256'] or entry['definitionSha256'] != ref['sha256']:
        raise ValueError('Original emitter definition differs')
    source = json.loads(definition_bytes)['definition']['complexEmitterDefinitionData'][index]
    if source.get('isSingleParticle') != 1 or 'birthDrag' not in source or 'birthRotationalVelocity0' not in source:
        raise ValueError('Explicit single-particle drag and angular source required')
    if 'flags' in json.loads(definition_bytes)['definition']:
        raise ValueError('This control requires the original omitted system flags default')
    system_loader = NativeVfxSystemAssets(args.package, args.client)
    system_loader.call(0x14aa3bf, {}, end=0x14aa5f9)
    system = system_loader.load_system([])
    flags_registration, = [row for row in system_loader.type_catalog['45cd899f']['properties'] if row['hash'] == name_hash('flags')]
    if flags_registration['offset'] != 0xc2 or struct.unpack_from('<H', bytes.fromhex(system['objectHex']), 0xc2)[0] != 212:
        raise ValueError('Original system flag constructor/default differs')
    blob = selected(entry['binFile'])
    if sha(blob) != entry['binSha256']:
        raise ValueError('Original birth-drag BIN differs')
    fields = []
    for span in entry['fields']:
        value = blob[span['offset']:span['offset']+span['bytes']]
        if len(value) != span['bytes'] or sha(value) != span['sha256'] or int.from_bytes(value[:4], 'little') != int(span['fieldHash'], 16):
            raise ValueError('Original birth-drag typed field differs')
        fields.append(value)
    loader, native = NativeVfxPostload(args.package, args.client), NativeBoundQuad(args.package, args.client)
    for owner in [loader, native]:
        owner.call(0x14aa3bf, {}, end=0x14aa5f9)
    before, after = loader.load(fields), loader.postload()
    if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
        raise ValueError('Complete original birth-drag source/postload required')
    graph = native.prepare_bound({'phase': 'native-postload-callbacks-executed', **after})
    graphs = {'authored': graph}
    registrations = {}
    for name in ['birthDrag', 'birthVelocity', 'birthRotationalVelocity0', 'birthScale0', 'birthRotation0']:
        row, = [row for row in loader.type_catalog['09cde442']['properties'] if row['hash'] == name_hash(name)]
        if row['type'] != 0x83:
            raise ValueError('Original vector property type differs: '+name)
        registrations[name] = {**row, 'sourceObjectHex': bytes.fromhex(after['objectHex'])[row['offset']:row['offset']+0x18].hex()}
    loader.restore_preload_arena()
    variants = {
        'authored': {'drag': source['birthDrag']['constantValue'], 'velocity': source['birthVelocity']['constantValue']},
        'mixed': {'drag': [2., 7., 4.], 'velocity': [120., 3500., -240.]},
        'negative-clamp': {'drag': [120., 60., 200.], 'velocity': [-160., -3500., 260.]},
        'zero-drag': {'drag': [0., 0., 0.], 'velocity': [120., -3500., -240.]},
    }
    for label, control in variants.items():
        if label == 'authored':
            continue
        changed = list(fields)
        for field, key in [('birthDrag', 'drag'), ('birthVelocity', 'velocity')]:
            candidates = [index for index, data in enumerate(changed) if int.from_bytes(data[:4], 'little') == name_hash(field)]
            if len(candidates) != 1:
                raise ValueError('Unique actual serialized vector control required')
            index = candidates[0]
            old, new = struct.pack('<3f', *source[field]['constantValue']), struct.pack('<3f', *control[key])
            if changed[index].count(old) != 1:
                raise ValueError('Unique actual vector constant bytes required')
            changed[index] = changed[index].replace(old, new)
        typed, loaded = loader.load(changed), loader.postload()
        if typed['ignored'] or typed['mismatched'] or loaded['pendingLinkFixups'] or loaded['mathCalls']:
            raise ValueError('Original typed vector controls failed')
        graphs[label] = native.prepare_bound({'phase': 'native-postload-callbacks-executed', **loaded})
        loader.restore_preload_arena()
    common_heap = (max(value['nextHeap'] for value in graphs.values())+0x1000+15) & ~15
    for value in graphs.values():
        value['nextHeap'] = common_heap
    calls = []

    def random_enter(uc, address, size, user):
        ret = native.q(uc.reg_read(r.UC_X86_REG_RSP))
        bp = uc.reg_read(r.UC_X86_REG_RBP)
        parents = []
        for _ in range(6):
            if not 0x10000000 <= bp < A['stack'] or bp % 8:
                break
            previous, caller = struct.unpack('<QQ', uc.mem_read(bp, 16))
            parents.append({'frame': bp, 'returnRva': caller-native.base})
            if previous <= bp:
                break
            bp = previous
        state = {'returnRva': ret-native.base, 'parentFrames': parents,
                 'beforeHex': bytes(uc.mem_read(A['stream']+8, 12)).hex()}
        calls.append(state)

        def returned(inner, _address, _size, _user):
            state['afterHex'] = bytes(inner.mem_read(A['stream']+8, 12)).hex()
            state['resultHex'] = struct.pack('<I', inner.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff).hex()
            inner.hook_del(state.pop('_hook'))
        state['_hook'] = uc.hook_add(unicorn.UC_HOOK_CODE, returned, begin=ret, end=ret)

    native.u.hook_add(unicorn.UC_HOOK_CODE, random_enter,
                      begin=native.base+0x1490eb0, end=native.base+0x1490eb0)
    cases = []
    clocks = {'canonical': [tick/60 for tick in range(61)],
              'split': [tick/120 for tick in range(121)],
              'clamp': [0., .1, .10001, .2, .35, .5, 1.]}
    for variant, graph in graphs.items():
     for seed in ([0, 1, 0x12345, 0xffffffffffffffff] if variant == 'authored' else [1]):
      for clock, times in clocks.items():
        for schedule in ['identity', 'changing']:
            native.reset_quad(graph, seed, 0)
            native.call(0x14aa3bf, {}, end=0x14aa5f9)
            frames, previous = [], [123., 45., -67.]
            for tick, time in enumerate(times):
                basis = ([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                         if schedule == 'identity' else
                         [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1])
                if schedule == 'changing' and (tick // 4) % 2:
                    basis = [2, .25, 0, 0, .5, .5, .125, 0, -.25, .5, 1.5, 0, 0, 0, 0, 1]
                current = [123+time*130, 45+time*3, -67+time*70]
                value = {'time': time, 'previous': previous, 'current': current, 'basis': basis,
                         'viewPosition': [0, 1000, 0], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 0, -1],
                         'viewAxis': [0, -1, 0], 'multTexturePresent': False}
                calls.clear()
                output = native.frame_bound(value)
                if any('_hook' in row for row in calls):
                    raise ValueError('Original RNG call did not return')
                frames.append({'input': value, 'output': output, 'randomCalls': list(calls)})
                previous = current
            if not any(frame['output']['geometry']['indicesHex'] for frame in frames):
                raise ValueError('Original native indexed geometry required')
            cases.append({'effectId': effect_id, 'emitterIndex': index, 'seedHex': f'{seed:016x}', 'schedule': schedule, 'clock': clock, 'variant': variant, 'typedControl': variants[variant], 'frames': frames})
            print(json.dumps({'component': args.component, 'seed': seed, 'schedule': schedule,
                              'clock': clock, 'variant': variant, 'frames': len(frames), 'randomCalls': sum(len(frame['randomCalls']) for frame in frames)}), flush=True)
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original birth-drag input/source drift: '+file)
    blocks = {row['rva']: row for owner in [loader, native, system_loader] for row in owner.blocks.values()}
    result = {'schema': 1, 'kind': 'original-archived-birth-drag-controls', 'build': effects['build'], 'protocol': effects['protocol'],
              'decoderImageSha256': sha(image), 'sceneManifestSha256': effects['sceneManifestSha256'],
              'effectsManifestSha256': sha(effects_bytes), 'selected': {'effectId': effect_id, 'emitterIndex': index,
              'definitionSha256': ref['sha256'], 'binSha256': entry['binSha256'], 'source': source, 'registrations': registrations,
              'systemFlagDefault': {'registration': flags_registration, 'constructorObjectHex': system['objectHex'], 'flags': 212,
                                    'dragModeMask': 0x100, 'dragModeBit': False, 'sourceFlagsAuthored': False}},
              'cases': cases, 'inputs': inputs, 'originalBlocks': list(blocks.values()), 'sourceDrift': 0,
              'scope': {'completeOriginalFieldsAndPostload': True, 'fullPristineInitializerAfterReset': True,
                        'allOriginalBirthRngCallsObserved': True, 'suppliedBasisClockMotionCameraAndSeed': True,
                        'authoredCasesUnchanged': True, 'typedVectorControlsSeparatelyLabelled': True, 'runtimeAdmissionChanged': False,
                        'actualReplayActivation': False, 'gpuSubmitted': False, 'nativeSpectatorAdmitted': False}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases), 'sourceDrift': 0}), flush=True)


if __name__ == '__main__':
    main()
