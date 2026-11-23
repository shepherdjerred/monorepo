"""Run original Map/MapSkin readers and the original map-skin context constructor.

Only the map's skin-vector links are fixed here. Other asset dependencies remain
explicit unresolved identities; this is not complete map post-load or readiness.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_asset_native import REGISTRY
from vfx_spawn_native import sha, name_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--variant', default='Default')
    args = parser.parse_args()
    input_bytes = args.input.read_bytes()
    request = json.loads(input_bytes)
    source = Path(request['source']['file']).read_bytes()
    if (request['kind'] != 'original-map11-native-field-input' or request['schema'] != 1 or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['mapId'] != 11 or sha(source) != request['source']['sha256'] or
            len(source) != request['source']['bytes']):
        raise ValueError('Exact archived Map11 field input required')
    root = Path(__file__).resolve().parent
    if (sha((root/'exact-map-bin.mjs').read_bytes()) != request['readerSha256'] or
            sha((root/'prepare-map11-native-input.mjs').read_bytes()) != request['preparerSha256']):
        raise ValueError('Original field-span producer changed')
    n = NativeCharacterAssets(args.cache/'public/decoder-16.21-macos', args.client)
    if sha(n.image) != n.profile['decoderImageSha256']:
        raise ValueError('Original image identity differs')
    n.initialize_character_types()
    for start, end in [(0x6994c0, None), (0x224a19, 0x224a25), (0x333270, None)]:
        n.call(start, {}, end)
    count, array = n.u32(n.base+REGISTRY+8), n.q(n.base+REGISTRY)
    if not 1887 <= count <= 4096:
        raise ValueError('Original map reflection registry exceeds bounds')
    previous = dict(n.types)
    n.types = {}
    for index in range(count):
        descriptor = n.q(array+index*8)
        if not n.base+0x1fef000 <= descriptor <= n.base+len(n.image)-0x88:
            raise ValueError('Map descriptor escaped original image')
        key = n.u32(descriptor+8)
        if key in n.types:
            raise ValueError('Duplicate original type descriptor')
        n.types[key] = descriptor
    if any(n.types.get(key) != value for key, value in previous.items()):
        raise ValueError('Map registration changed original actor types')
    n.type_catalog = n.catalog()
    cases, loaded, boundary = [], {}, None
    context_proof = None
    try:
        for entry in request['roots']:
            if entry['identity'] in loaded or entry['typeHash'] not in n.types:
                raise ValueError('Repeated or unregistered original Map/MapSkin root')
            fields = []
            for span in entry['fields']:
                offset, size = span['offset'], span['bytes']
                if type(offset) is not int or type(size) is not int or offset < 0 or size < 5 or offset+size > len(source):
                    raise ValueError('Field span escaped original source')
                raw = source[offset:offset+size]
                if sha(raw) != span['sha256'] or '%08x' % int.from_bytes(raw[:4], 'little') != span['fieldHash']:
                    raise ValueError('Original serialized field bytes changed')
                fields.append(raw)
            observed = n.observe_actor_fields(entry['typeHash'], fields)
            loaded[entry['identity']] = dict(entry, loaded=observed)
            cases.append({'identity': entry['identity'], 'typeHash': entry['typeHash'],
                          'typeName': entry['typeName'], 'name': entry['name'], 'loaded': observed})
        maps = [entry for entry in loaded.values() if entry['typeName'] == 'Map']
        if len(maps) != 1:
            raise ValueError('One original Map root required')
        map_entry = maps[0]
        map_object = map_entry['loaded']['object']
        skins = {entry['identity']: entry for entry in loaded.values() if entry['typeName'] == 'MapSkin'}
        vector, skin_count = n.q(map_object+0x60), n.u32(map_object+0x68)
        if not 1 <= skin_count <= 128 or not n.library_pointer(vector, skin_count*8):
            raise ValueError('Original Map skin vector exceeds owned bounds')
        identities = [n.q(vector+index*8) for index in range(skin_count)]
        links = [link for link in map_entry['loaded']['pendingReferences'] if link['identity'] in skins]
        if len(links) != skin_count or set(identities) != {link['identity'] for link in links}:
            raise ValueError('Original Map skin-vector references differ')
        library = n.allocate(0x48)
        table = n.allocate(len(skins)*24)
        for index, (identity, entry) in enumerate(sorted(skins.items())):
            n.put(table+index*24, 'QQII', entry['loaded']['object'], n.types[entry['typeHash']], identity, 0)
        n.put(library+0x10, 'QII', table, len(skins), len(skins))
        context, queue = n.allocate(24), n.allocate(len(links)*16)
        for index, link in enumerate(links):
            if n.q(link['destination']) != link['identity']:
                raise ValueError('Original queued skin identity changed')
            n.put(queue+index*16, 'QQ', link['destination'], link['expectedType'])
        n.put(context, 'QQII', library, queue, len(links), len(links))
        n.call(0x14bbf40, {r.UC_X86_REG_RDI: context})
        if n.u32(context+0x10):
            raise ValueError('Original skin fixup queue was not exhausted')
        names = {}
        for identity in identities:
            entry = skins[identity]
            pointer = entry['loaded']['object']
            name_length, name_pointer = n.u32(pointer+8), n.q(pointer)
            if name_length < 1 or name_length > 256 or not n.library_pointer(name_pointer, name_length):
                raise ValueError('Original MapSkin name escaped owned string')
            name = bytes(n.u.mem_read(name_pointer, name_length)).decode('utf-8')
            if name != entry['name'] or name in names:
                raise ValueError('Original MapSkin name differs from serialized source')
            names[name] = {'identity': identity, 'object': pointer, 'typeHash': entry['typeHash']}
        if args.variant not in names or 'Default' not in names:
            raise ValueError('Explicit recorded MapSkin is absent from original map')
        n.call(0x683550, {})
        expected_type = n.u.reg_read(r.UC_X86_REG_RAX)
        if expected_type != n.types[map_entry['typeHash']]:
            raise ValueError('Original bootstrap expects a different Map class')
        n.call(0x14b62d0, {r.UC_X86_REG_RDI: expected_type, r.UC_X86_REG_RSI: map_object, r.UC_X86_REG_RDX: expected_type})
        if n.u.reg_read(r.UC_X86_REG_RAX) != map_object:
            raise ValueError('Original Map cast did not select the authored root')
        n.call(0x683d70, {r.UC_X86_REG_RDI: map_object})
        variant = n.allocate(16)
        n.call(0x14c2d60, {r.UC_X86_REG_RDI: variant, r.UC_X86_REG_RSI: n.allocate_text(args.variant)})
        context = n.allocate(0x168)
        n.u.mem_write(context+0x68, b'\xa5'*0x100)
        n.call(0x689440, {r.UC_X86_REG_RDI: context, r.UC_X86_REG_RSI: 11, r.UC_X86_REG_RDX: variant})
        selected = names[args.variant]
        if (n.q(n.base+0x246cc38) != context or n.q(n.base+0x2562b08) != map_object or
                n.q(context+0x40) != names['Default']['object'] or n.q(context+0x48) != selected['object'] or
                bytes(n.u.mem_read(context+0x68, 0x100)) != b'\xa5'*0x100):
            raise ValueError('Original Map11 MapSkin context or allocation guard differs')
        n.call(0x6895e0, {r.UC_X86_REG_RDI: context})
        if n.u.reg_read(r.UC_X86_REG_RAX) != selected['object']:
            raise ValueError('Original MapSkin getter selected another authored skin')
        fields = n.type_catalog['%08x' % selected['typeHash']]['properties']
        paths = {}
        for name in ['mMapContainerLink', 'mNavigationMesh']:
            matches = [field for field in fields if field['hash'] == name_hash(name)]
            if len(matches) != 1:
                raise ValueError('Original MapSkin string property descriptor is ambiguous')
            offset = matches[0]['offset']
            pointer, length = n.q(selected['object']+offset), n.u32(selected['object']+offset+8)
            if not 0 < length <= 1024 or not n.library_pointer(pointer, length):
                raise ValueError('Native MapSkin path escaped its original allocation')
            paths[name] = {'propertyOffset': offset, 'value': bytes(n.u.mem_read(pointer, length)).decode('utf-8')}
        context_proof = {'mapRootIdentity': map_entry['identity'], 'skinCount': skin_count,
                         'skinIdentities': identities, 'variant': args.variant, 'selectedSkin': selected,
                         'constructorRva': 0x689440, 'getterRva': 0x6895e0,
                         'fixedSkinReferences': len(links), 'paths': paths, 'guardIntact': True}
        # The original nav module's LEA/MOV/CALL supplies the real static
        # descriptor destination. This is not an invented descriptor allocation.
        n.call(0x16d5902, {}, 0x16d5911)
        count, array = n.u32(n.base+REGISTRY+8), n.q(n.base+REGISTRY)
        if not len(n.types) <= count <= 4096:
            raise ValueError('Original nav type registration exceeds bounds')
        for index in range(count):
            descriptor = n.q(array+index*8)
            if not n.base+0x1fef000 <= descriptor <= n.base+len(n.image)-0x88:
                raise ValueError('Nav descriptor escaped original image')
            identity = n.u32(descriptor+8)
            if identity in n.types and n.types[identity] != descriptor:
                raise ValueError('Nav registration changed an original descriptor')
            n.types[identity] = descriptor
        nav = [entry for entry in request['container']['components'] if entry['typeHash'] == name_hash('MapNavGrid')]
        if len(nav) != 1:
            raise ValueError('Unique original MapNavGrid component required')
        container_bytes = Path(request['containerSource']['file']).read_bytes()
        if sha(container_bytes) != request['containerSource']['sha256'] or len(container_bytes) != request['containerSource']['bytes']:
            raise ValueError('Original MapContainer bytes changed')
        fields = []
        for span in nav[0]['fields']:
            raw = container_bytes[span['offset']:span['offset']+span['bytes']]
            if len(raw) != span['bytes'] or sha(raw) != span['sha256'] or '%08x' % int.from_bytes(raw[:4], 'little') != span['fieldHash']:
                raise ValueError('Original MapNavGrid serialized field changed')
            fields.append(raw)
        observed_nav = n.observe_actor_fields(nav[0]['typeHash'], fields)
        nav_object = observed_nav['object']
        nav_type = n.catalog()['%08x' % nav[0]['typeHash']]
        nav_fields = [field for field in nav_type['properties'] if field['hash'] == name_hash('NavGridPath')]
        if len(nav_fields) != 1:
            raise ValueError('Original NavGridPath descriptor is ambiguous')
        nav_offset = nav_fields[0]['offset']
        nav_pointer, nav_length = n.q(nav_object+nav_offset), n.u32(nav_object+nav_offset+8)
        if not 0 < nav_length <= 1024 or not n.library_pointer(nav_pointer, nav_length):
            raise ValueError('Original MapNavGrid path escaped its owned string')
        vtable = n.q(nav_object)
        if not n.base <= vtable <= n.base+len(n.image)-0x40:
            raise ValueError('Original MapNavGrid vtable escaped the image')
        context_proof['mapContainerNavGrid'] = {
            'containerIdentity': request['container']['identity'], 'componentIndex': nav[0]['index'],
            'loaded': observed_nav, 'pathOffset': nav_offset,
            'path': bytes(n.u.mem_read(nav_pointer, nav_length)).decode('utf-8'),
            'typeDescriptor': nav_type, 'vtableRva': vtable-n.base,
            'vtableEntries': [n.q(vtable+index*8)-n.base for index in range(8)],
            'componentConsumerExecuted': False}
        if n.q(n.base+0x247c680):
            raise ValueError('Navigation precedence control requires a cold component provider')
        # Original bounded allocation/initialization/publication block. The
        # component list below is an explicit caller-owned getter input, not a
        # claim that the full map bootstrap populated the live provider.
        n.call(0x66a87c, {}, 0x66a8da)
        provider = n.q(n.base+0x247c680)
        if n.allocations.get(provider) != 0x90 or n.q(provider+0x18) or n.u32(provider+0x20):
            raise ValueError('Original component provider is not empty after construction')
        n.call(0x68a220, {r.UC_X86_REG_RDI: context})
        fallback_pointer = n.u.reg_read(r.UC_X86_REG_RAX)
        if fallback_pointer != selected['object']+paths['mNavigationMesh']['propertyOffset']:
            raise ValueError('Original empty-provider navigation selection differs')
        component_vector = n.allocate(8)
        n.put(component_vector, 'Q', nav_object)
        n.put(provider+0x18, 'QII', component_vector, 1, 1)
        n.call(0x68a220, {r.UC_X86_REG_RDI: context})
        selected_pointer = n.u.reg_read(r.UC_X86_REG_RAX)
        if selected_pointer != nav_object+nav_offset:
            raise ValueError('Original navigation getter did not prefer the authored MapNavGrid component')
        context_proof['navigationSelection'] = {
            'originalGetterRva': 0x68a220, 'originalProviderConstructionBlock': [0x66a87c, 0x66a8da],
            'provider': provider, 'callerOwnedComponentList': True,
            'emptyProviderReturnsMapSkinPath': paths['mNavigationMesh']['value'],
            'authoredComponentReturnsPath': context_proof['mapContainerNavGrid']['path'],
            'componentTakesPrecedence': True, 'fullMapProviderBootstrapExecuted': False}
        context_proof['mapContainerNavGrid']['componentConsumerExecuted'] = True
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    sources = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    result = {'schema': 1, 'kind': 'original-map11-map-skin-context', 'build': request['build'],
              'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
              'inputSha256': sha(input_bytes), 'sourceBinSha256': sha(source),
              'sources': {str(path.resolve()): sha(path.read_bytes()) for path in sorted(sources)},
              'cases': cases, 'context': context_proof, 'boundary': boundary,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalTypedReadersExecuted': True, 'originalMapSkinConstructorCompleted': context_proof is not None,
                        'onlyMapSkinVectorLinksFixed': True, 'assetDependencyClosureVerified': False,
                        'fullMapBootstrapExecuted': False, 'assetReadinessVerified': False,
                        'nativeSpectatorEquivalent': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'context': context_proof, 'boundary': boundary}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
