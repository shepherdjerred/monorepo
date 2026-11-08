"""Observe original ground-layer typing, pass eligibility and shader selection."""
import argparse
import inspect
import json
from pathlib import Path
import struct

from unicorn import x86_const as r
from vfx_material_native import NativeVfxMaterial
from vfx_spawn_native import ADDRESSES as A, name_hash, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets, inputs = cache / 'public', {}

    def raw(path):
        data = path.read_bytes()
        inputs[str(path)] = sha(data)
        return data

    def read(path):
        return json.loads(raw(path))

    manifest = read(assets / 'latest-effects/manifest.json')
    admission = read(cache / 'research/direct-ground-admission-selection.json')
    selection = {(d['id'], e['index']) for d in admission['definitions'] for e in d['unsupported']
                 if e['reasons'] == ['field:isGroundLayer']}
    n = NativeVfxMaterial(assets / 'decoder-16.21-macos', args.client)
    prop = next(p for p in n.type_catalog['09cde442']['properties'] if p['hash'] == name_hash('isGroundLayer'))
    if (prop['offset'], prop['type'], prop['mask']) != (0x2d1, 0x87, 0x10):
        raise ValueError('Original ground-layer packed boolean registration differs')
    typed_controls = []
    for supplied in [None, 0, 1]:
        loaded = n.load([] if supplied is None else [struct.pack('<IBB', prop['hash'], 0x87, supplied)])
        observed = bool(bytes.fromhex(loaded['objectHex'])[prop['offset']] & prop['mask'])
        if observed != bool(supplied):
            raise ValueError('Ground layer constructor/typed packed flag differs')
        typed_controls.append({'supplied': supplied, 'observed': observed})
    rows = []
    gpu = read(assets / 'latest-complete-quad-gpu/package.json')
    systems = read(assets / 'latest-vfx-system-assets/package.json')
    bindings = {(e['effectId'], e['emitterIndex']): e for e in gpu['emitters']}
    packages = {}
    for kind, key in [('bound', 'vfxBoundQuadsSha256')]:
        metadata_path = assets / 'decoder-16.21-macos' / ('vfx-' + kind + '-quads.json')
        metadata = n.checked_json(metadata_path.name, key)
        packages[kind] = sha(raw(metadata_path))
        for ref in metadata['templates']:
            identity = (ref['effectId'], ref['emitterIndex'])
            if identity not in selection:
                continue
            graph_raw = raw(assets / 'decoder-16.21-macos' / ref['file'])
            if sha(graph_raw) != ref['sha256']:
                raise ValueError('Original complete emitter graph changed')
            source_ref = manifest['definitions'][ref['effectId']]
            source_raw = raw(assets / 'latest-effects' / source_ref['file'])
            if sha(source_raw) != ref['sourceDefinitionSha256']:
                raise ValueError('Original emitter source changed')
            source = json.loads(source_raw)['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]
            if source.get('isGroundLayer') not in [1, True]:
                raise ValueError('Selected ground component is not authored true')
            system_ref = systems['systems'][ref['effectId']]
            system = read(assets / 'latest-vfx-system-assets' / system_ref['file'])
            fog_mode = bytes.fromhex(system['objectHex'])[0xc0]
            if fog_mode not in [0, 1]:
                raise ValueError('Prepared complete root fog mode is outside verified values')
            n.prepare_material(json.loads(graph_raw))
            if not n.u.mem_read(A['definition'] + prop['offset'], 1)[0] & prop['mask']:
                raise ValueError('Complete emitter graph lost ground layer flag')
            passes = []
            for pass_code in range(7):
                environment = {'pass': pass_code, 'featuresEnabled': True, 'resourceMask': 0,
                               'systemFogMode': fog_mode, 'graphics34b': False, 'graphics29c': 0}
                selected = n.select(environment)
                n.call(0x16dfd80, {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_RSI: pass_code})
                eligible = bool(n.u.reg_read(r.UC_X86_REG_RAX) & 255)
                passes.append({'environment': environment, 'eligible': eligible, 'shader': selected})
            binding = bindings.get(identity)
            rows.append({'effectId': identity[0], 'emitterIndex': identity[1],
                         'sourceDefinitionSha256': source_ref['sha256'], 'graphSha256': ref['sha256'],
                         'primitiveKind': kind, 'passes': passes,
                         'originalPreparedRootFogMode': fog_mode,
                         'currentGpuBindingEnvironment': binding['environment'] if binding else None,
                         'currentGpuBindingDefines': binding['defines'] if binding else None})
    if {(r['effectId'], r['emitterIndex']) for r in rows} != selection:
        raise ValueError('Original native template coverage differs from selected ground components')
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sites = [(0x16dfd80, 0x16dff1e), (0x1747462, 0x17474f0)]
    result = {'schema': 1, 'kind': 'original-ground-layer-pass-material-controls',
              'build': manifest['build'], 'protocol': manifest['protocol'],
              'registration': prop, 'typedControls': typed_controls, 'cases': rows,
              'packages': packages, 'inputs': inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'sourceSites': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b]),
                               'bytesHex': n.image[a:b].hex()} for a, b in sites],
              'scope': {'originalTypedGroundFlag': True, 'originalFullPassEligibility': True,
                        'originalShaderSelection': True, 'unchangedPreparedEmitters': True,
                        'geometryCompared': False, 'groundPassGpuBindingVerified': False,
                        'compilerAdmissionChanged': False, 'gpuSubmitted': False, 'matchCoverage': False}}
    output = cache / 'research/direct-ground-layer-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(rows), 'cases': [
        {'effectId': r['effectId'], 'emitterIndex': r['emitterIndex'],
         'eligiblePasses': [p['environment']['pass'] for p in r['passes'] if p['eligible']],
         'groundShader': r['passes'][5]['shader']} for r in rows]}))


if __name__ == '__main__':
    main()
