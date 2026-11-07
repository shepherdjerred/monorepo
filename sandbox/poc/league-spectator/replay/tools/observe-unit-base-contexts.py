"""Named base resource acquisition and original context setter observations."""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from unit_base_context_native import NativeUnitBaseContexts, TLS_DESCRIPTOR, TLS_CELL
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        b = path.read_bytes()
        inputs[str(path.resolve())] = sha(b)
        return b

    def read(path):
        return json.loads(raw(path))

    manifest = read(cache/'public/latest-effects/manifest.json')
    reference = read(cache/'research/effect-resolvers-native.json')
    contexts = read(cache/'public/latest-effect-contexts/package.json')
    n = NativeUnitBaseContexts(cache/'public/decoder-16.21-macos', args.client)
    if reference['decoderImageSha256'] != sha(n.image) or manifest['build'] != n.profile['clientVersion']:
        raise ValueError('Matching original resource maps required')
    for name, digest in reference['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError('Original resolver producer changed')
    for path, digest in reference['inputs'].items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original resolver input changed')
    template_rva = 0x21edc9b
    template = n.image[template_rva:n.image.index(b'\0', template_rva)].decode('ascii')
    if template != '%s/%s/Skins/Skin%u/Resources':
        raise ValueError('Original resource-path format differs')
    native_maps = {c['actorKey']: n.load_prepared_map(c) for c in reference['cases']
                   if c['status'] == 'native-resource-map-loaded'}
    entries = sorted([{'identity': c['resourceResolverId'], 'object': native_maps[c['actorKey']],
                       'type': n.types[0xef3a0f33]} for c in reference['cases']
                      if c['status'] == 'native-resource-map-loaded'], key=lambda x: x['identity'])
    library = n.prepared_library(entries)
    cases, missing = [], []
    for context_spec in contexts['contexts']:
        actor_key = context_spec['actorKey']
        actor = manifest['actors'][actor_key]
        path = template % ('characters', actor['character'], actor['skinId'])
        # This formatting result is explicit. The original suffix independently
        # scans and hashes it; host formatting is not claimed as native execution.
        hash_value = 0x811c9dc5
        for byte in path.lower().encode('ascii'):
            hash_value = ((hash_value ^ byte)*0x1000193) & 0xffffffff
        if actor_key not in native_maps:
            n.lookup_prepared_entry(hash_value, False)
            missing.append({'actorKey': actor_key, 'resourcePath': path, 'resourceIdentity': hash_value,
                            'status': 'requires-global-asset-library', 'contextInstalled': False})
            continue
        expected_identity = int(actor['resourceResolverId'].strip('{}'), 16)
        if hash_value != expected_identity:
            raise ValueError('Original named resource differs from authored resolver identity')
        entry = n.lookup_prepared_entry(hash_value, True)
        if n.q(entry) != native_maps[actor_key] or n.q(entry+8) != n.types[0xef3a0f33]:
            raise ValueError('Original TLS asset library selected another resource')
        context = n.character_context(actor['character'], actor['skinId'])
        if context['identity'] != context_spec['identity']:
            raise ValueError('Character context identity differs')
        acquired = n.acquire_prepared_context(context['object'], path)
        if acquired != {'identity': expected_identity, 'resolver': native_maps[actor_key], 'ready': True}:
            raise ValueError('Original named resource cast/store differs')
        unit = n.create_unit(overlays=[native_maps[actor_key], None])
        installed = n.install_context(unit['object'], context['object'])
        if installed['baseResolver'] != native_maps[actor_key] or installed['context'] != context['object'] or installed['overlays'] != unit['overlays']:
            raise ValueError('Original unit setter did not install the original context getter')
        detached = n.install_context(unit['object'], 0)
        if detached['baseResolver'] != installed['baseResolver'] or detached['context'] != 0 or detached['overlays'] != installed['overlays']:
            raise ValueError('Null context unexpectedly cleared unit base resources')
        cases.append({'actorKey': actor_key, 'resourcePath': path, 'resourceIdentity': expected_identity,
                      'context': context, 'acquired': acquired, 'unit': unit,
                      'installed': installed, 'nullContext': detached})

    # A found asset with an incompatible type must pass through the original
    # typed cast and yield null, rather than being reinterpreted as a resolver.
    wrong_root = n.allocate(n.system_size)
    n.call(0x1786e80, {r.UC_X86_REG_RDI: wrong_root})
    first = cases[0]
    wrong_library = n.prepared_library([{'identity': first['resourceIdentity'], 'object': wrong_root, 'type': n.system_type}])
    wrong_context = n.character_context(first['context']['name'], first['context']['skinId'])
    wrong_acquired = n.acquire_prepared_context(wrong_context['object'], first['resourcePath'])
    if wrong_acquired != {'identity': first['resourceIdentity'], 'resolver': 0, 'ready': True}:
        raise ValueError('Original context accepted an incompatible asset type')
    original_unit = first['unit']['object']
    cleared = n.install_context(original_unit, wrong_context['object'])
    if cleared['baseResolver'] != 0 or cleared['overlays'] != first['installed']['overlays']:
        raise ValueError('Nonnull context with a null resolver did not clear only the base')
    restored = n.install_context(original_unit, first['context']['object'])
    if restored != first['installed']:
        raise ValueError('Original context reinstall did not restore the supplied base')
    n.put(TLS_CELL, 'Q', library['object'])
    ranges = [(0x3526ff, 0x352767), (0x548bf0, 0x548c30), (0x353f70, 0x353f80),
              (0x14b7950, 0x14b7be0), (0x14b62d0, 0x14b6410),
              (0x14c18e0, 0x14c1900), (0x14be1d0, 0x14be1e0),
              (template_rva, template_rva+len(template)+1)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original base-context code differs from matching executable')
    paths = {Path(__file__), Path(inspect.getfile(NativeEffectContexts)),
             *[Path(inspect.getfile(c)) for c in NativeUnitBaseContexts.__mro__ if c is not object]}
    current = bytes(n.u.mem_read(n.base, len(n.image)))
    patches = [{'rva': at, 'bytesHex': current[at:at+4096].hex()} for at in range(0, len(n.image), 4096)
               if current[at:at+4096] != n.image[at:at+4096]]
    if any(p['rva'] < 0x1fef000 for p in patches):
        raise ValueError('Base-context snapshot would patch original code')
    result = {'schema': 1, 'kind': 'original-unit-base-context-observations',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'inputs': inputs,
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'originalBlocks': list(n.blocks.values()), 'template': template,
        'library': library, 'cases': cases, 'missing': missing,
        'controls': {'wrongTypedLibrary': wrong_library, 'wrongContext': wrong_context,
                     'wrongAcquired': wrong_acquired, 'cleared': cleared, 'restored': restored},
        'snapshot': {'heapAddress': 0x10400000,
                     'heapHex': bytes(n.u.mem_read(0x10400000, n.next_heap-0x10400000)).hex(),
                     'imagePatches': patches, 'tlsDescriptorRva': TLS_DESCRIPTOR, 'tlsCell': TLS_CELL},
        'counts': {'namedResourceAcquisitions': len(cases), 'baseInstallations': len(cases),
                   'nullContextPreservations': len(cases), 'globalBoundaryStops': len(missing),
                   'wrongTypeRejections': 1, 'nonnullNullResolverClears': 1, 'baseRestores': 1},
        'scope': {'suppliedTypedAssetLibrary': True, 'suppliedResourcePathFormattingResult': True,
                  'suppliedLibraryReadyPredicate': True, 'originalLookupCastStoreExecuted': True,
                  'originalUnitContextGetterSetterExecuted': True, 'fullCharacterLoaderExecuted': False,
                  'globalAssetFallbackExecuted': False, 'liveHeroConstructorExecuted': False,
                  'liveUnitBaseContextRecovered': False, 'liveOverlayStateRecovered': False,
                  'referenceLinksFixed': False, 'effectFactoryExecuted': False, 'mainViewerExpanded': False}}
    (cache/'research/unit-base-contexts-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'counts': result['counts']}))


if __name__ == '__main__':
    main()
