"""Load authored gear upgrade tables/maps with original native reflection.

BIN links and VFX values remain reference tokens. No live selection, context
installation, post-load, graphics acquisition or effect factory is substituted.
"""
import argparse
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import runpy
from collections import Counter
from unicorn import x86_const as r
from unit_resource_native import NativeUnitResources
from vfx_asset_native import REGISTRY, WRAPPER, STREAM, VTABLE, CALLBACK, CONTEXT, CACHE
from vfx_spawn_native import sha


class NativeUnitGearResources(NativeUnitResources):
    def __init__(self, *args):
        super().__init__(*args)
        self.initializing_resource_types = True
        try:
            for entry in [0x2cf7f0, 0x308480, 0x31e9e0]:
                self.call(entry, {})
        finally:
            self.initializing_resource_types = False
        count, array = self.u32(self.base+REGISTRY+8), self.q(self.base+REGISTRY)
        if not 712 <= count <= 2048:
            raise ValueError('Character/gear type registry exceeds bounds')
        self.types = {}
        for i in range(count):
            at = self.q(array+i*8)
            if not self.base+0x1fef000 <= at <= self.base+len(self.image)-0x88:
                raise ValueError('Gear descriptor outside original data image')
            identity = self.u32(at+8)
            if identity in self.types:
                raise ValueError('Duplicate gear reflection identity')
            self.types[identity] = at
        self.type_catalog = self.catalog()
        for identity, size in [(0x68f2b69c, 0x30), (0x27dd6361, 0x20), (0xb43441ae, 0x1c8)]:
            if identity not in self.types or self.q(self.types[identity]+0x40) != size:
                raise ValueError(f'Original gear type layout differs: {identity:x}')

    def read_gear(self, fields):
        descriptor = self.types[0x27dd6361]
        obj = self.allocate(0x20)
        self.u.mem_write(WRAPPER, bytes(0x500))
        self.put(WRAPPER, 'Q', STREAM)
        self.put(STREAM, 'Q', VTABLE)
        for i, offset in enumerate([0x10, 0x28, 0x30]):
            self.put(VTABLE+offset, 'Q', CALLBACK+i*16)
        self.ignored, self.mismatched, self.stream_calls = [], [], []
        before = self.u32(CONTEXT+0x10)
        self.loading = True
        try:
            self.call(self.q(descriptor+0x20)-self.base, {r.UC_X86_REG_RDI: obj})
            for field in fields:
                self.input, self.cursor = field, 0
                self.put(CACHE, 'Q', 0)
                self.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT, r.UC_X86_REG_RSI: obj,
                    r.UC_X86_REG_RDX: descriptor, r.UC_X86_REG_RCX: WRAPPER, r.UC_X86_REG_R8: CACHE})
                if self.cursor != len(field):
                    raise ValueError('Gear reader left unread authored bytes')
        finally:
            self.loading = False
        if self.ignored or self.mismatched:
            raise ValueError(f'Native gear loader skipped/mismatched fields: {self.ignored} {self.mismatched}')
        # GearSkinUpgrade owns a GearData pointer at +8; the original model
        # table builder copies that pointer, not the wrapper. Its resolver is +158.
        gear = self.q(obj+8)
        if not gear or self.allocations.get(gear) != 0x1c8:
            raise ValueError('Original gear data allocation differs')
        resolver = self.q(gear+0x158)
        if not resolver:
            return {'object': obj, 'gearData': gear, 'resolver': None, 'rows': [],
                    'pendingLinksAdded': self.u32(CONTEXT+0x10)-before}
        if self.allocations.get(resolver) != 24:
            raise ValueError(f'Original gear resolver allocation differs: {resolver:x}, size={self.allocations.get(resolver)}')
        pointer, count = self.q(resolver+8), self.u32(resolver+0x10)
        if count > 65536 or count and not self.library_pointer(pointer, count*16):
            raise ValueError('Gear resource map outside owned native arena')
        rows = [{'key': self.u32(pointer+i*16), 'value': self.q(pointer+i*16+8)} for i in range(count)]
        if [x['key'] for x in rows] != sorted(x['key'] for x in rows):
            raise ValueError('Original gear resource map is not ordered')
        # Authored gear BINs contain duplicate keys with distinct values. The
        # original getter is lower_bound, so preserve the complete native row
        # order and observe the first matching row rather than collapsing a dict.
        first = {}
        for row in rows:
            first.setdefault(row['key'], row['value'])
        for key, value in first.items():
            if self.lookup_resource(resolver, key) != {'found': True, 'value': value}:
                raise ValueError('Original gear map lookup differs')
        return {'object': obj, 'gearData': gear, 'resolver': resolver, 'rows': rows,
                'mapAddress': pointer,
                'duplicateKeys': [key for key, count in Counter(x['key'] for x in rows).items() if count > 1],
                'pendingLinksAdded': self.u32(CONTEXT+0x10)-before}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        b = path.read_bytes()
        inputs[str(path)] = sha(b)
        return b

    def read(path):
        return json.loads(raw(path))

    effects = read(cache/'public/latest-effects/manifest.json')
    package = read(cache/'public/latest-effects/package.json')
    distribution = importlib.metadata.distribution('cdtb')
    if json.loads(distribution.read_text('direct_url.json'))['vcs_info']['commit_id'] != '3367589fdd3ee3d0d01383d2f98dba12b04d1371':
        raise ValueError('Typed BIN parser revision differs')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary, name in [(binfile.hashfile_binfields, 'binfields'), (binfile.hashfile_bintypes, 'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(raw(path)) != effects['toolchain']['dictionaries'][name]:
            raise ValueError('Typed gear dictionary differs')
        dictionary.hashes = names(path)
    for dictionary in [binfile.hashfile_binentries, binfile.hashfile_binhashes, binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}

    class Reader(binfile.BinReader):
        def __init__(self, *a):
            super().__init__(*a)
            self.spans = {}
            self.map_pairs = {}

        def read_field(self, htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start, self.f.tell())
            return field

        def read_map(self):
            # The pinned CDTB reader uses dict(pairs), losing authored duplicate
            # keys. Retain the original pair sequence alongside its parsed value.
            ktype, vtype, _, count = self.read_fmt('<BBLL')
            ktype, vtype = self.parse_bintype(ktype), self.parse_bintype(vtype)
            pairs = [(self.read_bvalue(ktype), self.read_bvalue(vtype)) for _ in range(count)]
            value = binfile.BinMap(ktype, vtype, dict(pairs))
            self.map_pairs[id(value)] = pairs
            return value

    n = NativeUnitGearResources(cache/'public/decoder-16.21-macos', args.client)
    cases, tables = [], []
    # Discover gear tables from the prepared actor catalog, not champion names.
    for actor, actor_ref in effects['actors'].items():
        skin_source = next(v for v in package['actors'][actor]['sourceBins'] if v['path'] == actor_ref['skinPath'])
        skin_json = read(cache/'research/latest-effects/bins'/(
            skin_source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]+'.json'))
        skins = [v for v in skin_json.values() if isinstance(v, dict) and v.get('__type') == 'SkinCharacterDataProperties']
        if len(skins) != 1:
            raise ValueError('A unique prepared actor skin definition is required')
        ordered = skins[0].get('skinUpgradeData', {}).get('mGearSkinUpgrades', [])
        if not ordered:
            continue
        parsed = []
        for source in package['actors'][actor]['sourceBins']:
            stem = source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]
            data = raw(cache/'research/latest-effects/bins'/(stem+'.bin'))
            if sha(data) != source['sourceSha256']:
                raise ValueError('Authored gear source differs')
            stream = io.BytesIO(data)
            if stream.read(4) != b'PROP':
                raise ValueError('Expected unpatched typed gear BIN')
            reader = Reader(stream)
            _, _, types = reader.read_binfile_header()
            entries = {e.path.h: e for e in [reader.read_binfile_entry(t) for t in types]}
            parsed.append((source, data, reader, entries))
        for index, key in enumerate(ordered):
            identity = int(key.strip('{}'), 16)
            candidates = [v for v in parsed if identity in v[3]]
            if len(candidates) != 1:
                raise ValueError(f'Unresolved/ambiguous authored gear: {actor}/{key}')
            source, data, reader, entries = candidates[0]
            entry = entries[identity]
            if entry.type.h != 0x27dd6361:
                raise ValueError('Authored gear table contains another type')
            fields = [data[a:b] for a, b in [reader.spans[id(f)] for f in entry.fields]]
            loaded = n.read_gear(fields)
            json_path = cache/'research/latest-effects/bins'/(
                source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]+'.json')
            authored = read(json_path)[key]
            gear = entry['mGearData'].value
            resolver = gear['mVFXResourceResolver'].value if 'mVFXResourceResolver' in gear else None
            pairs = reader.map_pairs[id(resolver['resourceMap'].value)] if resolver and 'resourceMap' in resolver else []
            expected = Counter((k.h, v.h) for k, v in pairs)
            if Counter((x['key'], x['value']) for x in loaded['rows']) != expected:
                raise ValueError('Native gear resolver differs from complete authored BIN pairs')
            if {x['key']: x['value'] for x in loaded['rows']} != {
                    int(k.strip('{}'), 16): int(v.strip('{}'), 16) for k, v in
                    authored.get('mGearData', {}).get('mVFXResourceResolver', {}).get('resourceMap', {}).items()}:
                raise ValueError('Native final duplicate rows differ from the diagnostic JSON')
            case = {'actorKey': actor, 'index': index, 'gearIdentity': identity,
                    'sourceSha256': source['sourceSha256'], 'sourcePath': source['path'],
                    'fields': [{'bytes': len(f), 'sha256': sha(f)} for f in fields], 'loaded': loaded}
            cases.append(case)
        actor_cases = [c for c in cases if c['actorKey'] == actor]
        skin_input, links, component, destination = (n.allocate(0x518), n.allocate(len(actor_cases)*8),
                                                   n.allocate(0x100), n.allocate(len(actor_cases)*8))
        for i, case in enumerate(actor_cases):
            n.put(links+i*8, 'Q', case['loaded']['object'])
        n.put(skin_input+0xa8, 'QI', links, len(actor_cases))
        n.put(component+0x10, 'QQQ', destination, destination+len(actor_cases)*8, destination+len(actor_cases)*8)
        # Exact original table-copy loop with caller-supplied resolved links and
        # preallocated capacity. The real unit resource/skin getter is excluded.
        n.call(0x30d3b9, {r.UC_X86_REG_R13: skin_input, r.UC_X86_REG_R12: component+0x10,
                         r.UC_X86_REG_R14: component}, 0x30d3f3)
        pointers = [n.q(destination+i*8) for i in range(len(actor_cases))]
        if pointers != [c['loaded']['gearData'] for c in actor_cases]:
            raise ValueError('Original gear table copy changed authored index order')
        tables.append({'actorKey': actor, 'suppliedResolvedGearLinks': True,
                       'originalTableCopyExecuted': True, 'indices': [c['gearIdentity'] for c in actor_cases]})
        print(json.dumps({'actor': actor, 'gearEntries': len(ordered),
                          'resourceRows': sum(len(c['loaded']['rows']) for c in cases if c['actorKey'] == actor)}), flush=True)
    paths = {Path(__file__), Path(__file__).with_name('parse-latest-assets.py'),
             *[Path(inspect.getfile(c)) for c in NativeUnitResources.__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'native-authored-unit-gear-resource-observations',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'inputs': inputs,
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()),
        'heapAddress': 0x10400000,
        'heapHex': bytes(n.u.mem_read(0x10400000, n.next_heap-0x10400000)).hex(),
        'types': {f'{k:08x}': n.type_catalog[f'{k:08x}'] for k in [0x68f2b69c, 0x27dd6361, 0xb43441ae]},
        'cases': cases, 'tables': tables, 'counts': {'actors': len(tables), 'gearEntries': len(cases),
            'originalTablePointerCopies': sum(len(t['indices']) for t in tables),
            'resourceRows': sum(len(c['loaded']['rows']) for c in cases),
            'authoredNullReferences': sum(row['value'] == 0 for c in cases for row in c['loaded']['rows']),
            'duplicateKeyGroups': sum(len(c['loaded'].get('duplicateKeys', [])) for c in cases),
            'pendingLinksAcrossIndependentLoads': sum(c['loaded']['pendingLinksAdded'] for c in cases)},
        'scope': {'originalCharacterAndGearInitializersExecuted': True,
            'originalGearConstructorsAndTypedReaderExecuted': True, 'completeAuthoredGearFieldsRead': True,
            'originalResolverLookupsExecuted': True, 'valuesAreUnfixedReferenceTokens': True,
            'authoredDuplicatePairsPreserved': True, 'originalFirstDuplicateLookupExecuted': True,
            'gearTableLinkFixupExecuted': False, 'liveUnitGearSelectionRecovered': False,
            'liveResourceStackReconstructed': False, 'postLoadExecuted': False,
            'factoryExecuted': False, 'mainViewerExpanded': False}}
    (cache/'research/unit-gear-resources-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'counts': result['counts']}))


if __name__ == '__main__':
    main()
