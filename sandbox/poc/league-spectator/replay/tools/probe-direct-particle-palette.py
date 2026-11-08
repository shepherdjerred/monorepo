"""Original authored palette coordinates and material selection, no admission.

All original typed fields retain serialized order. Palette-absent controls remove
only particleColorTexture; unchanged original updates/writers retain their full
state and packed vertex streams. Inputs here are explicit diagnostic poses.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r

from vfx_postload_native import NativeVfxPostload
from vfx_camera_quad_native import NativeCameraQuad
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import sha, name_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--frames', type=int, default=61)
    args = parser.parse_args()
    if not 2 <= args.frames <= 121:
        raise ValueError('Bounded nonempty clock required')
    cache = args.cache.resolve()
    assets = cache / 'public'
    decoder = assets / 'decoder-16.21-macos'
    inputs = {}

    def raw(path):
        value = path.read_bytes()
        inputs[str(path.resolve())] = sha(value)
        return value

    def read(path):
        return json.loads(raw(path))

    profile = read(decoder / 'profile.json')
    if sha(raw(decoder / 'image.bin')) != profile['decoderImageSha256']:
        raise ValueError('Exact original image required')
    manifest = read(assets / 'latest-effects/manifest.json')
    inventory = read(decoder / 'vfx-assets.json')
    bound = read(decoder / 'vfx-bound-quads.json')
    for filename, key in [('vfx-assets.json', 'vfxAssetsSha256'),
                          ('vfx-bound-quads.json', 'vfxBoundQuadsSha256')]:
        if inputs[str((decoder / filename).resolve())] != profile[key]:
            raise ValueError('Pinned original source inventory differs')
    if inventory['effectsManifestSha256'] != inputs[str((assets / 'latest-effects/manifest.json').resolve())]:
        raise ValueError('Exact effects package required')
    loader = NativeVfxPostload(decoder, args.client)
    native = NativeCameraQuad(decoder, args.client)
    material = NativeVfxMaterial(decoder, args.client)
    controller_rows = []

    def controller_input(uc, address, size, user):
        frame = uc.reg_read(r.UC_X86_REG_RBP)
        definition = struct.unpack('<Q', uc.mem_read(frame - 0xb0, 8))[0]
        controller_rows.append({
            'modes': list(struct.unpack('<II', uc.mem_read(frame - 0xc0, 8))),
            'coefficients': list(struct.unpack('<4f', uc.mem_read(definition + 0xd0, 16))),
            'normalizedAge': struct.unpack('<f', uc.mem_read(frame - 0x90, 4))[0],
        })

    native.u.hook_add(unicorn.UC_HOOK_CODE, controller_input,
                      begin=native.base + 0x175f6ec, end=native.base + 0x175f6ec)
    cases, materials, selections = [], [], []
    palette_hash = name_hash('particleColorTexture')
    for effect_id, index in [('champions/karthus/10/fde333aa', 0),
                             ('champions/jinx/2/953aab68', 1),
                             ('champions/maokai/3/b9d05a01', 0),
                             ('champions/maokai/3/99dd2080', 0)]:
        ref = manifest['definitions'][effect_id]
        definition = read(assets / 'latest-effects' / ref['file'])
        if inputs[str((assets / 'latest-effects' / ref['file']).resolve())] != ref['sha256']:
            raise ValueError('Exact authored definition required')
        source = definition['definition']['complexEmitterDefinitionData'][index]
        if not isinstance(source.get('particleColorTexture'), str):
            raise ValueError('Authored palette required')
        meta = inventory['emitters'][f'{effect_id}:{index}']
        blob = raw(cache / 'research/latest-effects/bins' /
                   f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob) != meta['rawSourceSha256'] or meta['definitionSha256'] != ref['sha256']:
            raise ValueError('Exact raw serialized emitter required')
        fields = []
        for field in meta['fields']:
            value = blob[field['offset']:field['offset'] + field['bytes']]
            if sha(value) != field['sha256']:
                raise ValueError('Original field bytes differ')
            fields.append((field['hash'], value))
        if sum(key == palette_hash for key, _ in fields) != 1:
            raise ValueError('One exact palette declaration required')
        graphs = {}
        for variant in ['authored', 'absent']:
            before = loader.load([value for key, value in fields
                                  if variant == 'authored' or key != palette_hash])
            after = loader.postload()
            if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']:
                raise ValueError('Original typed load/postload unresolved')
            graphs[variant] = native.prepare_camera({'phase': 'native-postload-callbacks-executed', **after})
            loader.restore_preload_arena()
        common_heap = (max(graph['nextHeap'] for graph in graphs.values()) + 0x1000 + 15) & ~15
        for graph in graphs.values():
            graph['nextHeap'] = common_heap
        for seed in [1, 0x12345]:
            for variant, graph in graphs.items():
                native.reset_quad(graph, seed, 0)
                frames, previous = [], [0, 0, 0]
                for tick in range(args.frames):
                    time = tick / 60
                    current = [time * 130, time * 3, time * 70]
                    value = {'time': time, 'previous': previous, 'current': current,
                             'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                             'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0],
                             'cameraUp': [0, 1, 0], 'viewAxis': [0, 0, 1]}
                    controller_rows.clear()
                    output = native.frame_camera(value)
                    packed = bytes.fromhex(output['geometry']['verticesHex'])
                    palette_uv = [list(struct.unpack_from('<HH', packed, offset + 24))
                                  for offset in range(0, len(packed), 28)]
                    frames.append({'input': value, 'output': output, 'paletteHalfWords': palette_uv,
                                   'controllerInputs': list(controller_rows)})
                    previous = current
                cases.append({'effectId': effect_id, 'emitterIndex': index, 'variant': variant,
                              'seedHex': f'{seed:016x}', 'primitiveKind': 'camera', 'frames': frames})
        template = next(row for row in bound['templates']
                        if row['effectId'] == effect_id and row['emitterIndex'] == index)
        graph = read(decoder / template['file'])
        if inputs[str((decoder / template['file']).resolve())] != template['sha256']:
            raise ValueError('Exact original material graph required')
        material.prepare_material(graph)
        environment = {'pass': 0, 'featuresEnabled': True, 'resourceMask': 0,
                       'systemFogMode': 1, 'graphics34b': False, 'graphics29c': 0}
        selections.append({'effectId': effect_id, 'emitterIndex': index,
                           'environment': environment, 'parameters': material.parameters(),
                           'selection': material.select(environment), 'renderState': material.render_state(0)})
        materials.append({'effectId': effect_id, 'emitterIndex': index, 'source': source,
                          'sourceDefinitionSha256': ref['sha256'], 'graphSha256': template['sha256']})
        material.finish()
    frame = native.allocate(0x1000) + 0x800
    definition = native.allocate(0x200)
    attributes = native.allocate(0x100)
    packed = native.allocate(16)
    native.put(frame - 0xb0, 'Q', definition)
    native.put(frame - 0x80, 'Q', attributes)
    native.put(frame - 0x58, 'Q', 0)
    native.put(frame - 0xc0, 'II', 1, 0)
    native.put(definition + 0xd0, '4f', 1, 1, 0, 0)
    fractions = sorted(set([0, 2 ** -24, 2 ** -14, 0.0001, 1 / 24, 0.25,
                            0.5, 0.500244140625, 0.9999, 1] + [i / 60 for i in range(61)]))
    leaves = []
    for fraction in fractions:
        native.put(frame - 0x90, '4f', fraction, 0, 0, 0)
        native.call(0x175f6ec, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_R13: attributes,
                              r.UC_X86_REG_RBX: 0}, 0x175f98f)
        values = list(struct.unpack('<2f', native.u.mem_read(attributes + 0x20, 8)))
        bits = [struct.unpack('<I', struct.pack('<f', value))[0] for value in values]
        native.call(0x1731fb0, {r.UC_X86_REG_RDI: packed,
                              r.UC_X86_REG_XMM0: bits[0], r.UC_X86_REG_XMM1: bits[1],
                              r.UC_X86_REG_XMM2: 0, r.UC_X86_REG_XMM3: 0})
        leaves.append({'fraction': fraction, 'coordinates': values,
                       'halfWords': list(struct.unpack('<4H', native.u.mem_read(packed, 8)))})
    sources = {Path(__file__)}
    for obj in [loader, native, material]:
        sources.update(Path(inspect.getfile(cls)) for cls in type(obj).__mro__ if cls is not object)
    result = {'schema': 1, 'kind': 'native-particle-palette-coordinate-controls',
              'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
              'cases': cases, 'materials': materials, 'selections': selections, 'leafControls': leaves,
              'inputs': inputs, 'sources': {path.name: sha(path.read_bytes()) for path in sorted(sources)},
              'originalBlocks': list(native.blocks.values()),
              'materialBlocks': list(material.material_blocks.values()),
              'scope': {'completeOriginalTypedFieldOrder': True, 'onlyRemovedControlField': 'particleColorTexture',
                        'suppliedSeedClockMotionBasis': True, 'gpuSubmitted': False,
                        'runtimeAdmissionChanged': False, 'actualMatchActivation': False}}
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Native palette input drift')
    output = cache / 'research/direct-particle-palette-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases),
                      'frames': sum(len(case['frames']) for case in cases)}))


if __name__ == '__main__':
    main()
