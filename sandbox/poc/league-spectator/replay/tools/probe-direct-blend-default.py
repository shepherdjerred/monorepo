"""Observe exact absent emitter blend defaults and prepared material identities."""
import argparse
import inspect
import json
from pathlib import Path
import struct

from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from vfx_point_quad_native import NativePointQuad
from vfx_asset_native import NativeVfxAssets
from vfx_spawn_native import ADDRESSES as A, field_layout, sha, name_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    fixture = NativeVfxFixture(cache)
    n = NativePointQuad(fixture.assets / 'decoder-16.21-macos', args.client)
    registration = field_layout(n.source.image)['blendMode']
    n.call(0x16ffef0, {r.UC_X86_REG_RDI: A['definition']})
    at = A['definition'] + registration['offset']
    # Registration type is recovered separately from the complete type catalog;
    # preserve raw bytes here rather than guessing the width from neighbors.
    raw_default = bytes(n.u.mem_read(at, 4)).hex()
    typed = NativeVfxAssets(fixture.assets / 'decoder-16.21-macos', args.client)
    prop = next(p for p in typed.type_catalog['09cde442']['properties']
                if p['hash'] == name_hash('blendMode'))
    if prop['offset'] != registration['offset'] or prop['type'] != 3:
        raise ValueError('Original blend field is not the registered UInt8')
    typed_controls = []
    for supplied in [None, 0, 1, 2, 4, 255]:
        loaded = typed.load([] if supplied is None else [struct.pack('<IBB', prop['hash'], 3, supplied)])
        observed = bytes.fromhex(loaded['objectHex'])[prop['offset']]
        if observed != (0 if supplied is None else supplied):
            raise ValueError('Typed UInt8 blend field differs from supplied/default value')
        typed_controls.append({'supplied': supplied, 'observed': observed})
    vector_offset = next(p['offset'] for p in typed.type_catalog['45cd899f']['properties']
                         if p['hash'] == name_hash('complexEmitterDefinitionData'))
    materials = fixture.read(fixture.assets / 'latest-complete-quad-gpu/package.json')
    bindings = {(b['effectId'], b['emitterIndex']): b for b in materials['emitters']}
    report = fixture.read(cache / 'research/direct-effects.json')
    manifest = fixture.read(fixture.assets / 'latest-effects/manifest.json')
    rows = []
    for definition in report['definitions']:
        candidates = [e for e in definition['unsupported']
                      if e['reasons'] == ['material:blend:unprepared-default']]
        if not candidates:
            continue
        ref = manifest['definitions'][definition['id']]
        record = fixture.read(fixture.assets / 'latest-effects' / ref['file'])
        graph_ref = fixture.systems['systems'][definition['id']]
        graph = fixture.read(fixture.assets / 'latest-vfx-system-assets' / graph_ref['file'])
        root = bytes.fromhex(graph['objectHex'])
        heap = bytes.fromhex(graph['heapHex'])

        def graph_raw(address, size):
            start = address - graph['heapStart']
            if not 0 <= start <= start + size <= len(heap):
                raise ValueError('Complete graph read exceeds original owned heap')
            return heap[start:start + size]

        pointer, count = struct.unpack_from('<QI', root, vector_offset)
        for emitter in candidates:
            source = record['definition']['complexEmitterDefinitionData'][emitter['index']]
            if 'blendMode' in source:
                raise ValueError('Candidate unexpectedly authors blend mode')
            if not emitter['index'] < count:
                raise ValueError('Emitter index exceeds complete native definition vector')
            definition_address = struct.unpack('<Q', graph_raw(pointer + emitter['index'] * 8, 8))[0]
            observed_blend = graph_raw(definition_address + prop['offset'], 1)[0]
            if observed_blend != 0:
                raise ValueError('Complete postloaded emitter has a different absent blend default')
            binding = bindings.get((definition['id'], emitter['index']))
            if binding is None or binding['sourceDefinitionSha256'] != ref['sha256']:
                raise ValueError('Candidate lacks the exact current renderer material binding')
            if binding['nativeBlendFactors'] != [1, 1, 1, 1]:
                raise ValueError('Candidate additive native blend factors changed')
            rows.append({'effectId': definition['id'], 'emitterIndex': emitter['index'],
                         'emitterName': source.get('emitterName'), 'rootBlockers': definition['blockers'],
                         'definitionSha256': ref['sha256'], 'graphFile': graph_ref['file'],
                         'graphObjectBytes': len(root), 'observedBlendMode': observed_blend,
                         'nativeBlendFactors': binding['nativeBlendFactors'],
                         'nativeRenderStateHex': binding['nativeRenderStateHex'],
                         'defines': binding['defines'],
                         'shaders': {stage: {'sha256': value['sha256']}
                                     for stage, value in binding['shaders'].items()},
                         'constantBuffers': binding['blocks']})
    paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    paths.update(Path(inspect.getfile(c)) for c in type(typed).__mro__ if c is not object)
    result = {'schema': 1, 'kind': 'original-emitter-absent-blend-default',
              'registration': registration, 'defaultFourBytesHex': raw_default,
              'typedRegistration': prop, 'typedControls': typed_controls,
              'candidates': rows, 'originalBlocks': list(n.blocks.values()),
              'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'scope': {'originalEmitterConstructorExecuted': True,
                        'typedFieldWidthEstablished': True, 'completePreparedGraphsChecked': True,
                        'preparedOriginalNativeMaterialStatesRetained': True,
                        'directGeometryOrShaderRasterCompared': False,
                        'compilerAdmissionChanged': False, 'matchCoverage': False}}
    output = cache / 'research/direct-blend-default-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'registration': registration,
                      'defaultFourBytesHex': raw_default, 'candidates': len(rows)}))


if __name__ == '__main__':
    main()
