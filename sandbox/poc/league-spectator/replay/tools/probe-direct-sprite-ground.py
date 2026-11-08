"""Original ground pass proof for the isolated random-start sprite increment.

The current prepared ground package and prior proof reports are never written.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import ADDRESSES as A, name_hash, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--component', action='append', required=True)
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets, inputs = cache / 'public', {}
    def raw(path):
        data = path.read_bytes()
        key = str(path.resolve())
        digest = sha(data)
        if key in inputs and inputs[key] != digest:
            raise ValueError('Native ground input changed')
        inputs[key] = digest
        return data
    def read(path):
        return json.loads(raw(path))
    manifest = read(assets / 'latest-effects/manifest.json')
    n = NativeVfxMaterial(assets / 'decoder-16.21-macos', args.client)
    prop = next(p for p in n.type_catalog['09cde442']['properties'] if p['hash'] == name_hash('isGroundLayer'))
    if (prop['offset'], prop['type'], prop['mask']) != (0x2d1, 0x87, 0x10):
        raise ValueError('Original packed ground flag registration changed')
    metadata = read(assets / 'decoder-16.21-macos/vfx-bound-quads.json')
    if inputs[str((assets / 'decoder-16.21-macos/vfx-bound-quads.json').resolve())] != n.profile['vfxBoundQuadsSha256']:
        raise ValueError('Exact profile-pinned bound quad inventory required')
    systems = read(assets / 'latest-vfx-system-assets/package.json')
    gpu = read(assets / 'latest-complete-quad-gpu/package.json')
    rows, selected = [], set()
    for argument in args.component:
        effect_id, index_text = argument.rsplit(':', 1)
        if not index_text.isascii() or not index_text.isdecimal():
            raise ValueError('Explicit prepared effectId:emitterIndex required')
        index = int(index_text)
        if (effect_id, index) in selected:
            raise ValueError('Duplicate additional ground control')
        selected.add((effect_id, index))
        refs = [e for e in metadata['templates'] if e['effectId'] == effect_id and e['emitterIndex'] == index]
        if len(refs) != 1:
            raise ValueError('Exactly one original bound quad graph required')
        ref = refs[0]
        graph_raw = raw(assets / 'decoder-16.21-macos' / ref['file'])
        source_ref = manifest['definitions'][effect_id]
        source_raw = raw(assets / 'latest-effects' / source_ref['file'])
        if sha(graph_raw) != ref['sha256'] or sha(source_raw) != ref['sourceDefinitionSha256'] or sha(source_raw) != source_ref['sha256']:
            raise ValueError('Original bound graph/source definition differs')
        source = json.loads(source_raw)['definition']['complexEmitterDefinitionData'][index]
        if source.get('isGroundLayer') not in [1, True]:
            raise ValueError('Additional component must be authored ground layer')
        system_ref = systems['systems'][effect_id]
        system_raw = raw(assets / 'latest-vfx-system-assets' / system_ref['file'])
        if sha(system_raw) != system_ref['sha256']:
            raise ValueError('Complete original system root changed')
        fog_mode = bytes.fromhex(json.loads(system_raw)['objectHex'])[0xc0]
        if fog_mode not in [0, 1]:
            raise ValueError('Unverified original root fog mode')
        n.prepare_material(json.loads(graph_raw))
        if not n.u.mem_read(A['definition'] + prop['offset'], 1)[0] & prop['mask']:
            raise ValueError('Loaded complete native emitter lost ground layer')
        passes = []
        for pass_code in range(7):
            environment = {'pass': pass_code, 'featuresEnabled': True, 'resourceMask': 0,
                           'systemFogMode': fog_mode, 'graphics34b': False, 'graphics29c': 0}
            shader = n.select(environment)
            n.call(0x16dfd80, {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_RSI: pass_code})
            passes.append({'environment': environment, 'eligible': bool(n.u.reg_read(r.UC_X86_REG_RAX) & 255),
                           'shader': shader})
        if [p['environment']['pass'] for p in passes if p['eligible']] != [5]:
            raise ValueError('Additional ground control is not exclusively original pass5')
        binding = next((e for e in gpu['emitters'] if e['effectId'] == effect_id and e['emitterIndex'] == index), None)
        rows.append({'effectId': effect_id, 'emitterIndex': index, 'primitiveKind': 'bound',
                     'sourceDefinitionSha256': source_ref['sha256'], 'graphSha256': ref['sha256'],
                     'passes': passes, 'originalPreparedRootFogMode': fog_mode,
                     'currentGpuBindingEnvironment': binding['environment'] if binding else None,
                     'currentGpuBindingDefines': binding['defines'] if binding else None})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-ground-layer-pass-material-controls',
              'build': manifest['build'], 'protocol': manifest['protocol'], 'registration': prop,
              'cases': rows, 'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalTypedGroundFlag': False, 'originalFullPassEligibility': True,
                        'originalShaderSelection': True, 'unchangedPreparedEmitters': True,
                        'geometryCompared': False, 'groundPassGpuBindingVerified': False,
                        'compilerAdmissionChanged': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-sprite-ground-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(rows), 'fogModes': [r['originalPreparedRootFogMode'] for r in rows]}))


if __name__ == '__main__':
    main()
