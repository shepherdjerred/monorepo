"""Original MapSkin resource-field postload and global publication slice.

Only the authored resource projection is read: Map.mapSkins, MapSkin.name and
MapSkin.mResourceResolvers, and complete ResourceResolver fields. Other map
fields remain constructor defaults and are explicitly outside this observation.
No asset readiness, guest state or replay entity acceptance is supplied.
"""
import argparse
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import sys

import unicorn
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_asset_native import REGISTRY
from vfx_spawn_native import sha, name_hash
from startup_map_skin_native import recover_startup_map_skin


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache, client = args.cache.resolve(), args.client.resolve()
    inputs = {}

    def raw(path):
        data = Path(path).read_bytes()
        inputs[str(Path(path).resolve())] = sha(data)
        return data

    def read(path):
        return json.loads(raw(path))

    package = read(cache / 'public/latest-map-effect-inputs/package.json')
    if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id'] != package['parser']['cdtbRevision']:
        raise ValueError('Pinned BIN parser required')
    import cdtb.binfile as binfile
    # Selection uses the serialized uint32 field/type identities exclusively.
    # Human-readable external dictionaries cannot affect this projection.
    for dictionary in [binfile.hashfile_binfields, binfile.hashfile_bintypes,
                       binfile.hashfile_binentries, binfile.hashfile_binhashes,
                       binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}

    class Reader(binfile.BinReader):
        def __init__(self, *args):
            super().__init__(*args)
            self.spans = {}

        def read_field(self, htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start, self.f.tell())
            return field

    source = raw(cache / 'public/latest-map-effect-inputs' / package['source']['file'])
    if sha(source) != package['source']['sha256']:
        raise ValueError('Installed map source differs')
    f = io.BytesIO(source)
    if f.read(4) != b'PROP':
        raise ValueError('Original map PROP source required')
    reader = Reader(f)
    _, _, types = reader.read_binfile_header()
    entries = [reader.read_binfile_entry(kind) for kind in types]
    if f.tell() != len(source):
        raise ValueError('Unconsumed map bytes')
    tools = Path(__file__).resolve().parent
    paths = {Path(__file__).resolve(), client,
             cache / 'public/decoder-16.21-macos/profile.json',
             cache / 'public/decoder-16.21-macos/image.bin'}
    paths.update(Path(module.__file__).resolve() for module in tuple(sys.modules.values())
                 if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
                 and Path(module.__file__).resolve().is_relative_to(tools))
    for path in paths:
        raw(path)
    n = NativeCharacterAssets(cache / 'public/decoder-16.21-macos', client)
    if package['decoderImageSha256'] != sha(n.image):
        raise ValueError('Map projection decoder image differs')
    n.initialize_character_types()
    n.call(0x6994c0, {})
    count, array = n.u32(n.base + REGISTRY + 8), n.q(n.base + REGISTRY)
    n.types = {n.u32(n.q(array + i * 8) + 8): n.q(array + i * 8) for i in range(count)}
    n.type_catalog = n.catalog()
    selected = {
        name_hash('Map'): {name_hash('mapSkins')},
        name_hash('MapSkin'): {name_hash('name'), name_hash('mResourceResolvers')},
        name_hash('ResourceResolver'): None,
    }
    loaded, records = {}, []
    for entry in entries:
        if entry.type.h not in selected:
            continue
        names = selected[entry.type.h]
        fields = [field for field in entry.fields if names is None or field.name.h in names]
        if names is not None and {field.name.h for field in fields} - names:
            raise ValueError('Projection field differs')
        encoded = [source[a:b] for a, b in [reader.spans[id(field)] for field in fields]]
        row = n.observe_actor_fields(entry.type.h, encoded)
        if row['originalSkippedFields']:
            raise ValueError('Original typed projection skipped a selected field')
        loaded[entry.path.h] = row
        records.append({'identity': entry.path.h, 'typeHash': entry.type.h,
                        'selectedFieldHashes': [field.name.h for field in fields],
                        'omittedFieldHashes': [field.name.h for field in entry.fields if field not in fields],
                        'loaded': row})
    expected_objects = {0x82330ecb, *[int(key, 16) for key in package['mapSkins']],
                        *[int(key, 16) for key in package['resolvers']]}
    if set(loaded) != expected_objects or len(records) != len(expected_objects):
        raise ValueError('Map resource projection identity inventory differs')
    # Resolver row values stay serialized reference tokens, just as in the
    # existing static resolver package. The map merger never dereferences them.
    # Resolve only the projection's Map->MapSkin->ResourceResolver ownership
    # links; retaining a VFX token is not claiming its asset has been loaded.
    deferred_values = [dict(link, ownerIdentity=row['identity']) for row in records
                       if row['typeHash'] == name_hash('ResourceResolver')
                       for link in row['loaded']['pendingReferences']]
    if any(n.q(link['destination']) != link['identity'] for link in deferred_values):
        raise ValueError('A deferred VFX reference is not its serialized token')
    links = [dict(link, ownerIdentity=row['identity']) for row in records
             if row['typeHash'] != name_hash('ResourceResolver')
             for link in row['loaded']['pendingReferences']]
    if any(link['identity'] not in loaded for link in links if link['identity']):
        missing_links = [{key: link[key] for key in ['identity', 'ownerIdentity']}
                         for link in links if link['identity'] and link['identity'] not in loaded]
        raise ValueError('Resource projection references omitted assets: ' + repr(missing_links[:8]))
    library, table = n.allocate(0x48), n.allocate(max(24, len(loaded) * 24))
    context, queue = n.allocate(24), n.allocate(max(16, len(links) * 16))
    for i, (identity, row) in enumerate(sorted(loaded.items())):
        n.put(table + i * 24, 'QQII', row['object'], n.types[row['typeHash']], identity, 0)
    n.put(library + 0x10, 'QII', table, len(loaded), len(loaded))
    for i, link in enumerate(links):
        if n.q(link['destination']) != link['identity']:
            raise ValueError('Native queued projection identity changed')
        n.put(queue + i * 16, 'QQ', link['destination'], link['expectedType'])
    n.put(context, 'QQII', library, queue, len(links), len(links))

    def missing(*unused):
        raise ValueError('Projected original link resolution reached a global miss')

    hook = n.u.hook_add(unicorn.UC_HOOK_CODE, missing,
                        begin=n.base + 0x14bc000, end=n.base + 0x14bc000)
    try:
        n.call(0x14bbf40, {r.UC_X86_REG_RDI: context})
    finally:
        n.u.hook_del(hook)
    if n.u32(context + 0x10):
        raise ValueError('Original resource projection left pending links')
    for link in links:
        if link['identity'] and not n.q(link['destination']):
            raise ValueError('Original typed resource projection rejected a non-null link')

    merges = []
    for identity, spec in package['mapSkins'].items():
        skin = loaded[int(identity, 16)]['object']
        n.call(0x694810, {r.UC_X86_REG_RDI: skin})
        resolver = skin + 0x178
        rows = [{'key': n.u32(n.q(resolver + 8) + i * 16),
                 'referenceToken': n.q(n.q(resolver + 8) + i * 16 + 8)}
                for i in range(n.u32(resolver + 0x10))]
        expected = sorted([{'key': row['key'], 'referenceToken': int(row['reference'], 16)}
                           for source_id in spec['resolvers']
                           for row in package['resolvers'][source_id]['rows']], key=lambda row: row['key'])
        if rows != expected:
            raise ValueError('Original MapSkin resource postload differs for ' + spec['name'] +
                             ': ' + repr({'actual': rows[:3], 'expected': expected[:3],
                                          'actualCount': len(rows), 'expectedCount': len(expected)}))
        merges.append({'skinId': identity, 'name': spec['name'], 'sources': spec['resolvers'],
                       'rows': rows, 'originalPostloadRva': 0x694810})
    # Recover the original startup consumer's arguments from the real packet.
    # This observation is comparison evidence; the browser must decode its own
    # packet and cannot use the per-match native observation as runtime state.
    recorded = recover_startup_map_skin(n, cache, tools.parent, read, raw)
    if recorded['mapId'] != package['mapId']:
        raise ValueError('Recorded startup selects another map package')
    chosen = [(identity, spec) for identity, spec in package['mapSkins'].items()
              if spec['name'] == recorded['variant']]
    if len(chosen) != 1:
        raise ValueError('Recorded variant has no unique authored MapSkin')
    chosen_id, chosen_spec = chosen[0]
    # Execute the original getter/selection and publication instructions on the
    # same resource projection, preserving its original overlay defaults.
    n.call(0x683d70, {r.UC_X86_REG_RDI: loaded[0x82330ecb]['object']})
    encoded_variant = recorded['variant'].encode('ascii') + b'\0'
    text = n.allocate(len(encoded_variant))
    n.u.mem_write(text, encoded_variant)
    variant = n.allocate(16)
    n.call(0x14c2d60, {r.UC_X86_REG_RDI: variant, r.UC_X86_REG_RSI: text})
    skin_context = n.allocate(0x168)
    n.u.mem_write(skin_context + 0x68, bytes([0xa5]) * 0x100)
    n.call(0x689440, {r.UC_X86_REG_RDI: skin_context, r.UC_X86_REG_RSI: recorded['mapId'],
                    r.UC_X86_REG_RDX: variant})
    expected_skin = loaded[int(chosen_id, 16)]['object']
    default_skin = loaded[int(next(identity for identity, spec in package['mapSkins'].items()
                                   if spec['name'] == 'Default'), 16)]['object']
    if n.q(skin_context + 0x40) != default_skin or n.q(skin_context + 0x48) != expected_skin:
        raise ValueError('Original projected MapSkin selection differs')
    # Stop after the original component/base publication. The next call
    # (1615960 via689882) registers fully linked VFX values and dereferences
    # their objects; serialized reference tokens are deliberately ineligible.
    n.call(0x6897ab, {r.UC_X86_REG_R14: skin_context}, 0x68987f)
    global_first, global_second = n.q(n.base + 0x24a8560), n.q(n.base + 0x24a8568)
    if (not global_second or n.q(global_second + 0x10) != expected_skin + 0x178 or
            bytes(n.u.mem_read(skin_context + 0x68, 0x100)) != bytes([0xa5]) * 0x100):
        raise ValueError('Original resource-only map publication differs')
    publication = {'recordedStartupArguments': recorded,
                   'contextConstructorRva': 0x689440,
                   'originalPublicationFragment': [0x6897ab, 0x68987f],
                   'omittedNotificationCalls': [0x17e2a40, 0x17e2b90],
                   'omittedAssetRegistrationCall': {'callRva': 0x689882, 'calleeRva': 0x1615960,
                      'reason': 'serialized VFX reference tokens are not linked native objects'},
                   'globalIndex': 1, 'component': global_second,
                   'baseResolver': n.q(global_second + 0x10),
                   'overlaysBegin': n.q(global_second + 0x18),
                   'overlaysEnd': n.q(global_second + 0x20),
                   'firstGlobalInColdControl': global_first,
                   'actualReplayFirstGlobalRecovered': False}
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Map projection input changed: ' + path)
    result = {'schema': 1, 'kind': 'original-map-resource-projection-observations',
              'build': package['build'], 'protocol': package['protocol'],
              'decoderImageSha256': sha(n.image), 'inputs': inputs,
              'records': records, 'fixedLinks': len(links), 'merges': merges,
              'deferredResolverValueReferences': deferred_values,
              'publication': publication,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalSelectedTypedFieldsExecuted': True,
                        'originalMapSkinResourcePostloadExecuted': True,
                        'completeMapObjects': False, 'assetReady': False,
                        'resolverValuesAreReferenceTokens': True,
                        'vfxValueAssetsLoaded': False,
                        'globalPublicationExecuted': True, 'activeGuestRecovered': False,
                        'globalMapAssetRegistrationExecuted': False,
                        'actualReplayInputs': True, 'actualEffectsActivated': False}}
    output = cache / 'research/map-resource-publication-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'resourceProjectionObjects': len(records),
                      'fixedLinks': len(links), 'originalMapSkinPostloads': len(merges)}))


if __name__ == '__main__':
    main()
