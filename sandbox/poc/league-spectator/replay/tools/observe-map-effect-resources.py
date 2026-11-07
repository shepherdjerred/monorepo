"""Native map resource readers, stable merges and complete global resolution."""
import argparse
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import runpy
from unicorn import x86_const as r
from map_effect_resource_native import NativeMapEffectResources
from unit_resource_native import NativeUnitResources
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}
    def raw(path):
        b = path.read_bytes()
        inputs[str(path.resolve())] = sha(b)
        return b
    def read(path):
        return json.loads(raw(path))
    package_path = cache/'public/latest-map-effect-inputs/package.json'
    package = read(package_path)
    for name,digest in package['sources'].items():
        if sha(raw(Path(__file__).parent.parent/name)) != digest:
            raise ValueError('Map input producer changed: '+name)
    distribution = importlib.metadata.distribution('cdtb')
    if json.loads(distribution.read_text('direct_url.json'))['vcs_info']['commit_id'] != package['parser']['cdtbRevision']:
        raise ValueError('Map BIN parser revision differs')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(raw(path)) != package['parser']['dictionaries'][name]['sha256']:
            raise ValueError('Map BIN name dictionary differs')
        dictionary.hashes = names(path)
    for dictionary in [binfile.hashfile_binentries,binfile.hashfile_binhashes,binfile.hashfile_binhashes_xxh3,binfile.hashfile_binpaths]:
        dictionary.hashes = {}
    class Reader(binfile.BinReader):
        def __init__(self,*args):
            super().__init__(*args)
            self.spans = {}
        def read_field(self,htype):
            start = self.f.tell()
            field = super().read_field(htype)
            self.spans[id(field)] = (start,self.f.tell())
            return field
    source = raw(cache/'public/latest-map-effect-inputs'/package['source']['file'])
    if sha(source) != package['source']['sha256'] or source[:4] != b'PROP':
        raise ValueError('Original map BIN changed')
    stream = io.BytesIO(source)
    stream.read(4)
    reader = Reader(stream)
    _,_,types = reader.read_binfile_header()
    entries = {e.path.h:e for e in [reader.read_binfile_entry(t) for t in types]}
    n = NativeMapEffectResources(cache/'public/decoder-16.21-macos',args.client)
    if sha(n.image) != package['decoderImageSha256']:
        raise ValueError('Map resource decoder image differs')
    maps,by_id = [],{}
    for identity,ref in package['resolvers'].items():
        entry = entries[int(identity,16)]
        if entry.type.h != 0xef3a0f33:
            raise ValueError('Map resolver has another original type')
        fields = [source[a:b] for a,b in [reader.spans[id(f)] for f in entry.fields]]
        loaded = n.read_resolver_fields(fields)
        if loaded['rows'] != [{'key':r['key'],'value':int(r['reference'],16)} for r in ref['rows']]:
            raise ValueError('Original typed map reader differs from parsed rows')
        record = {'id':identity,**loaded}
        maps.append(record)
        by_id[identity] = loaded['object']
    # Controlled maps are observation inputs only, never published as authored
    # map resources. Conflicting values and nulls expose precedence/tie behavior.
    controls = []
    for identity,rows in [
        ('control-a',[{'key':0xffffffe1,'value':0x11111111},{'key':0xffffffe2,'value':0}]),
        ('control-b',[{'key':0xffffffe1,'value':0x22222222},{'key':0xffffffe2,'value':0x33333333}]),
    ]:
        obj,table = n.allocate(24,0xa5),n.allocate(len(rows)*16,0xa5)
        n.call(0x16659b0,{r.UC_X86_REG_RDI:obj})
        for index,row in enumerate(rows):
            n.put(table+index*16,'IIQ',row['key'],0,row['value'])
        n.put(obj+8,'QII',table,len(rows),len(rows))
        controls.append({'id':identity,'synthetic':True,'object':obj,
            'objectHex':bytes(n.u.mem_read(obj,24)).hex(),'mapAddress':table,
            'mapBytesHex':bytes(n.u.mem_read(table,len(rows)*16)).hex(),'rows':rows})
        by_id[identity] = obj
    # Sources are immutable native-loaded maps. The merge API creates a new map.
    merge_initial = {'nextHeap':n.next_heap,'allocations':[list(x) for x in sorted(n.allocations.items())],
        'heapHex':bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000)).hex()}
    merges = []
    for identity,skin in package['mapSkins'].items():
        merged = n.merge_maps([by_id[x] for x in skin['resolvers']])
        merges.append({'skinId':identity,'name':skin['name'],'sources':skin['resolvers'],**merged})
    for source_ids in [['control-a','control-b'],['control-b','control-a'],['control-a','control-a','f2c6829c']]:
        duplicate = n.merge_maps([by_id[x] for x in source_ids])
        merges.append({'skinId':None,'name':'controlled-duplicate-keys','sources':source_ids,**duplicate})
    all_keys = sorted({r['key'] for m in maps+controls for r in m['rows']}|{0,1,0xffffffff})
    variants = [
        ('first-global-overlays',{'base':'control-b','overlays':['control-a','79372a74','7aaa2715']},
            {'base':'control-b','overlays':['91c152af']},['64b92ca9','control-b']),
        ('second-global-before-registered',None,{'base':'79372a74','overlays':['91c152af','control-a']},['adbc3928','7aaa2715','control-b']),
        ('registered-in-forward-order',None,None,['control-a','control-b','79372a74','adbc3928','7aaa2715']),
        ('empty-globals',None,None,[]),
        ('null-and-empty-overlays',{'base':'f2c6829c','overlays':[None,'f2c6829c']},None,['79372a74']),
    ]
    worlds = []
    for label,first,second,registered in variants:
        def concrete(group):
            return None if group is None else {'base':by_id[group['base']],
                'overlays':[by_id[x] if x is not None else 0 for x in group['overlays']]}
        world = n.supply_globals(concrete(first),concrete(second),[by_id[x] for x in registered])
        snapshot = {'heapHex':bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000)).hex(),
            'globals':[{'rva':at,'bytesHex':bytes(n.u.mem_read(n.base+at,16)).hex()} for at in [0x24a8560,0x2532bb8]]}
        queries = [{'key':key,**n.resolve_globals(key)} for key in all_keys]
        if bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000)).hex() != snapshot['heapHex']:
            raise ValueError('Global resource lookups mutated their supplied world')
        worlds.append({'label':label,'first':first,'second':second,'registeredSources':registered,
            'world':world,'snapshot':snapshot,'queries':queries})
        n.release_globals(world)
    for record in maps:
        if n.map_rows(record['object']) != record['rows']:
            raise ValueError('Original map composition mutated a source map')
    paths = {Path(__file__),Path(inspect.getfile(NativeUnitResources))}
    paths.update(Path(inspect.getfile(c)) for c in NativeMapEffectResources.__mro__ if c is not object)
    result = {'schema':1,'kind':'native-map-effect-resource-observations','build':package['build'],
        'protocol':package['protocol'],'decoderImageSha256':sha(n.image),'inputs':inputs,
        'packageSha256':inputs[str(package_path)],'sources':{p.name:sha(p.read_bytes()) for p in sorted(paths)},
            'originalBlocks':list(n.blocks.values()),'maps':maps,'controls':controls,'mergeInitial':merge_initial,'merges':merges,'worlds':worlds,
        'hostServices':n.services,'boundedAllocatorCalls':n.resolver_allocator_calls,
        'counts':{'maps':len(maps),'rows':sum(len(m['rows']) for m in maps),'mapSkins':len(package['mapSkins']),
            'merges':len(merges),'globalWorlds':len(worlds),'globalQueries':sum(len(w['queries']) for w in worlds)},
        'scope':{'originalTypedMapReaders':True,'originalStableMapMerge':True,'completeOriginalGlobalResolver':True,
            'originalGlobalPublicationRegistrationAndCleanup':True,'suppliedGlobalStacks':True,
            'mapValuesAreReferenceTokens':True,'activeMapVariantRecovered':False,'activeGuestRecovered':False,
            'externalLinksResolved':False,'worldFactoryExecuted':False,'browserExecuted':False,'referenceCompared':False}}
    output = cache/'research/map-effect-resources-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__ == '__main__':
    main()
