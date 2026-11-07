"""Read the installed Map12 dependency graph with original typed readers.

This is a cold, caller-owned asset library. It does not select the replay's
map variant, execute asset post-load, or assert that a live world is ready.
"""
import argparse
from collections import deque
import importlib.metadata
import inspect
import io
import json
from pathlib import Path
import runpy
import unicorn
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_object_native import NativeVfxObjects
from vfx_spawn_native import sha
from vfx_asset_native import REGISTRY
from wad_file_native import NativeWadFiles
from character_graph_snapshot import capture


def observe_map_assets(fixture,variant=None,capture_snapshot=False,additional_roots=()):
    n,cache = fixture.native,fixture.cache
    fixture.raw(cache/'research/darwin-errlst.c')
    package = fixture.read(cache/'public/latest-map-effect-inputs/package.json')
    globals_ = fixture.read(cache/'research/global-asset-inputs/index.json')
    if (package['build'] != n.profile['clientVersion'] or
            package['protocol'] != n.profile['protocolDigest'] or
            package['decoderImageSha256'] != sha(n.image) or package['mapId'] != 12 or
            globals_['build'] != package['build'] or globals_['protocol'] != package['protocol']):
        raise ValueError('Matching Map12 package, native image and global inputs required')
    for path,digest in globals_['sources'].items():
        if sha(fixture.raw(fixture.root/path)) != digest:
            raise ValueError('Installed global asset producer changed: '+path)
    parser = package['parser']
    if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id'] != parser['cdtbRevision']:
        raise ValueError('Pinned map BIN parser required')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(fixture.raw(path)) != parser['dictionaries'][name]['sha256']:
            raise ValueError('Pinned map property dictionary required')
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

    def entries(source,scope):
        data = fixture.raw(Path(source['source']))
        encoded = fixture.raw(Path(source['output']))
        if sha(data) != source['sha256'] or sha(encoded) != source['jsonSha256'] or data[:4] != b'PROP':
            raise ValueError('Prepared map dependency bytes changed')
        parsed = json.loads(encoded)
        stream = io.BytesIO(data)
        stream.read(4)
        reader = Reader(stream)
        _,_,types = reader.read_binfile_header()
        roots = [reader.read_binfile_entry(t) for t in types]
        if stream.tell() != len(data):
            raise ValueError('Map dependency BIN left unread bytes')
        for root in roots:
            spans = [reader.spans[id(field)] for field in root.fields]
            fields = [data[a:b] for a,b in spans]
            yield {'identity':root.path.h,'typeHash':root.type.h,'fields':fields,
                   'typeName':parsed['{%08x}' % root.path.h]['__type'],
                   'contentSha256':sha(root.type.h.to_bytes(4,'little')+b''.join(fields)),
                   'source':source,'scope':scope,
                   'fieldSpans':[{'offset':a,'bytes':b-a,'sha256':sha(data[a:b])} for a,b in spans]}

    source = package['source']
    parsed = parser['results'][0]
    if source['path'] != parsed['path'] or source['sha256'] != parsed['sourceSha256']:
        raise ValueError('Prepared map parser input differs')
    adapted = {'source':str(cache/'public/latest-map-effect-inputs'/source['file']),
               'output':str(cache/'research/map-effect-inputs'/(source['sha256']+'.json')),
               'sha256':source['sha256'],'jsonSha256':parsed['jsonSha256']}
    local = {entry['identity']:entry for entry in entries(adapted,'map12')}
    shared = {}
    for source in globals_['jobs']:
        for entry in entries(source,'installed-shared'):
            shared.setdefault(entry['identity'],[]).append(entry)
    if (len(additional_roots)>64 or len(set(additional_roots))!=len(additional_roots) or
            any(type(identity) is not int or not 0<identity<=0xffffffff or identity==0x82330ecb
                for identity in additional_roots)):
        raise ValueError('Additional map dependency roots require unique bounded source identities')
    initial = [0x82330ecb,*additional_roots]
    if local[initial[0]]['typeName'] != 'Map':
        raise ValueError('Expected installed Map12 root differs')
    if len(n.types) < 1928:
        n.initialize_character_types()
    # This original module is absent from the actor-only registry. Register
    # its complete original types before interpreting any Map fields.
    n.call(0x6994c0,{})
    # Original fog-property descriptor destination and complete constructor.
    # The surrounding visibility module has unrelated engine initialization.
    n.call(0x224a19,{},0x224a25)
    count,array = n.u32(n.base+REGISTRY+8),n.q(n.base+REGISTRY)
    if not len(n.types) <= count <= 4096:
        raise ValueError('Original map reflection registry exceeds bounds')
    previous = dict(n.types)
    n.types = {}
    for i in range(count):
        descriptor = n.q(array+i*8)
        if not n.base+0x1fef000 <= descriptor <= n.base+len(n.image)-0x88 or n.u32(descriptor+8) in n.types:
            raise ValueError('Original map descriptor is unowned or duplicated')
        n.types[n.u32(descriptor+8)] = descriptor
    if any(n.types.get(key) != value for key,value in previous.items()):
        raise ValueError('Map registration changed an existing actor descriptor')
    n.type_catalog = n.catalog()
    pending,scheduled = deque(initial),set(initial)
    cases,loaded,boundaries = [],{},[]
    while pending:
        identity = pending.popleft()
        candidates = [local[identity]] if identity in local else shared.get(identity,[])
        if not candidates:
            boundaries.append({'identity':identity,'kind':'missing-installed-root'})
            continue
        if len({entry['contentSha256'] for entry in candidates}) != 1:
            boundaries.append({'identity':identity,'kind':'conflicting-global-roots'})
            continue
        entry = candidates[0]
        case = {key:value for key,value in entry.items() if key != 'fields'}
        if entry['typeHash'] not in n.types:
            boundaries.append({'identity':identity,'typeHash':entry['typeHash'],
                               'typeName':entry['typeName'],'kind':'unregistered-original-type'})
            continue
        try:
            case['loaded'] = n.observe_actor_fields(entry['typeHash'],entry['fields'])
        except Exception as exception:
            case['boundary'] = {'kind':type(exception).__name__,'message':str(exception),
                                'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                                'registers':{key:n.u.reg_read(getattr(r,'UC_X86_REG_'+key.upper()))
                                             for key in ['rax','rbx','rdi','rsi','rdx','rcx','r8','r9']}}
            cases.append(case)
            boundaries.append({'identity':identity,**case['boundary']})
            break
        cases.append(case)
        loaded[identity] = case['loaded']
        for link in case['loaded']['pendingReferences']:
            target = link['identity']
            if target and target not in scheduled:
                if not 0 < target <= 0xffffffff or len(scheduled) >= 4096:
                    raise ValueError('Map dependency identity/count exceeds bounds')
                scheduled.add(target)
                pending.append(target)
        if len(cases) % 50 == 0:
            print(json.dumps({'loadedRoots':len(loaded),'queued':len(pending),'boundaries':len(boundaries)}),flush=True)
    fixups,map_root,map_skin_context = None,None,None
    if not boundaries and not pending:
        links = [dict(link,ownerIdentity=case['identity']) for case in cases for link in case['loaded']['pendingReferences']]
        if len(links) > 65536:
            raise ValueError('Map reference queue exceeds explicit bound')
        library,table,context,queue = n.allocate(0x48),n.allocate(max(24,len(loaded)*24)),n.allocate(24),n.allocate(max(16,len(links)*16))
        for i,(identity,root) in enumerate(sorted(loaded.items())):
            n.put(table+i*24,'QQII',root['object'],n.types[root['typeHash']],identity,0)
        n.put(library+0x10,'QII',table,len(loaded),len(loaded))
        for i,link in enumerate(links):
            if n.q(link['destination']) != link['identity']:
                raise ValueError('Queued map identity changed before reference fixup')
            n.put(queue+i*16,'QQ',link['destination'],link['expectedType'])
        n.put(context,'QQII',library,queue,len(links),len(links))
        def reject_global_miss(engine,address,size,user):
            raise ValueError('Complete map library reached original global-miss boundary')
        hook = n.u.hook_add(unicorn.UC_HOOK_CODE,reject_global_miss,begin=n.base+0x14bc000,end=n.base+0x14bc000)
        n.u.ctl_remove_cache(n.base+0x14bbf40,n.base+0x14bc060)
        try:
            n.call(0x14bbf40,{r.UC_X86_REG_RDI:context})
        finally:
            n.u.hook_del(hook)
        if n.u32(context+0x10):
            raise ValueError('Original map fixup left queued references')
        rejected = []
        for link in links:
            expected = 0
            if link['identity']:
                target = loaded[link['identity']]
                n.call(0x14b62d0,{r.UC_X86_REG_RDI:n.types[target['typeHash']],
                                  r.UC_X86_REG_RSI:target['object'],r.UC_X86_REG_RDX:link['expectedType']})
                expected = n.u.reg_read(r.UC_X86_REG_RAX)
                if not expected:
                    rejected.append(link)
            if n.q(link['destination']) != expected:
                raise ValueError('Fixed map reference differs from original typed cast')
            link['fixedPointer'] = expected
        fixups = {'links':links,'pendingAfter':n.u32(context+0x10),'rejectedNonNullReferences':rejected}
        if not rejected:
            root = loaded[initial[0]]
            # Use the exact descriptor selected by the original map bootstrap;
            # the separately registered MapContainer type is a different asset.
            n.call(0x683550,{})
            expected_type = n.u.reg_read(r.UC_X86_REG_RAX)
            if expected_type != n.types[root['typeHash']]:
                raise ValueError('Original map bootstrap expects a different root type')
            n.call(0x14b62d0,{r.UC_X86_REG_RDI:n.types[root['typeHash']],
                              r.UC_X86_REG_RSI:root['object'],r.UC_X86_REG_RDX:expected_type})
            pointer = n.u.reg_read(r.UC_X86_REG_RAX)
            if not pointer or not n.library_pointer(pointer,0x70):
                raise ValueError('Original bootstrap Map cast failed')
            count,array = n.u32(pointer+0x68),n.q(pointer+0x60)
            skins = {entry['loaded']['object']:entry['identity'] for entry in cases if entry['typeName'] == 'MapSkin'}
            if count != 12 or not n.library_pointer(array,count*8):
                raise ValueError('Native Map skin vector differs from installed Map12')
            identities = [skins[n.q(array+i*8)] for i in range(count)]
            names = {}
            for i,identity in enumerate(identities):
                skin = n.q(array+i*8)
                text,length = n.q(skin),n.u32(skin+8)
                if length > 256 or not n.library_pointer(text,length):
                    raise ValueError('Map skin name escaped owned string bounds')
                name = bytes(n.u.mem_read(text,length)).decode('utf-8')
                if name in names:
                    raise ValueError('Installed MapSkin names are duplicated')
                names[name] = {'identity':identity,'object':skin}
            map_root = {'object':pointer,'originalMapObject':root['object'],'castRva':0x14b62d0,
                        'typeGetterRva':0x683550,'expectedTypeHash':root['typeHash'],
                        'skinIdentities':identities,'skins':names}
            if variant:
                if variant not in names or 'Default' not in names or n.q(n.base+0x246cc38):
                    raise ValueError('An exact installed variant and cold context global are required')
                # Original bootstrap setter receives the actual fully fixed Map
                # object. There is no substitute empty skin or resolver table.
                n.call(0x683d70,{r.UC_X86_REG_RDI:pointer})
                context = n.allocate(0x68+0x100)
                n.u.mem_write(context+0x68,bytes([0xa5])*0x100)
                variant_string = n.allocate(16)
                n.call(0x14c2d60,{r.UC_X86_REG_RDI:variant_string,r.UC_X86_REG_RSI:n.allocate_text(variant)})
                n.call(0x689440,{r.UC_X86_REG_RDI:context,r.UC_X86_REG_RSI:12,r.UC_X86_REG_RDX:variant_string})
                if (n.q(n.base+0x246cc38) != context or n.q(n.base+0x2562b08) != pointer or
                        n.q(context+0x40) != names['Default']['object'] or
                        n.q(context+0x48) != names[variant]['object'] or
                        bytes(n.u.mem_read(context+0x68,0x100)) != bytes([0xa5])*0x100):
                    raise ValueError('Original MapSkin context differs from installed authored objects')
                n.call(0x6895e0,{r.UC_X86_REG_RDI:context})
                if n.u.reg_read(r.UC_X86_REG_RAX) != names[variant]['object']:
                    raise ValueError('Original MapSkin getter selected an unexpected skin')
                map_skin_context = {'object':context,'constructorRva':0x689440,'getterRva':0x6895e0,
                                    'suppliedVariant':variant,'selectedSkin':names[variant],
                                    'defaultSkin':names['Default'],'contextHex':bytes(n.u.mem_read(context,0x68)).hex(),
                                    'originalConstructorCompleted':True,'allocationGuardIntact':True,
                                    'replayVariantRecovered':False,'assetReadinessVerified':False}
    snapshot,snapshot_boundary = None,None
    if map_root and capture_snapshot:
        if n.file_mappings or n.file_handles or n.file_once or n.file_keys or n.file_rwlocks:
            snapshot_boundary = {'kind':'unsupported-platform-state',
                                 'message':'The owned heap/image snapshot does not preserve these platform services',
                                 'mappings':len(n.file_mappings),'openFiles':len(n.file_handles),
                                 'onceControls':len(n.file_once),'tlsKeys':len(n.file_keys),'rwlocks':len(n.file_rwlocks)}
        else:
            snapshot = capture(n,cache/'research/map-asset-links-heap.bin')
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(inspect.getfile(NativeVfxObjects)),
             Path(__file__).with_name('parse-latest-assets.py'),
             Path(__file__).with_name('character_graph_snapshot.py'),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-map-dependency-input-observations',
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
              'decoderImageSha256':sha(n.image),'mapId':12,'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'initialRoots':initial,'cases':cases,
              'boundaries':boundaries,'queuedNotRead':list(pending),'fixups':fixups,'mapRoot':map_root,
              'mapSkinContext':map_skin_context,'snapshot':snapshot,'snapshotBoundary':snapshot_boundary,
              'counts':{'loadedRoots':len(loaded),'scheduledRoots':len(scheduled),'boundaries':len(boundaries),
                        'pendingReferences':sum(len(case['loaded']['pendingReferences']) for case in cases if 'loaded' in case),
                        'originalSkippedFields':sum(len(case['loaded']['originalSkippedFields']) for case in cases if 'loaded' in case),
                        'fixedReferences':len(fixups['links']) if fixups else 0,
                        'ownedHeapBytes':n.next_heap-0x10400000},
              'scope':{'originalTypedReadersExecuted':True,'referenceLinksFixed':bool(map_root),
                       'snapshotRequested':capture_snapshot,
                       'fullAssetPostloadExecuted':False,'assetReadinessVerified':False,
                       'replayMapVariantRecovered':False,'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--variant',help='Explicit supplied MapSkin name for the original context constructor; not recovered replay state')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeWadFiles)
    result = observe_map_assets(fixture,args.variant,True)
    output = fixture.cache/'research/map-asset-links-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),**{key:result[key] for key in
                      ['counts','boundaries','mapRoot','mapSkinContext','snapshotBoundary']}}),flush=True)


if __name__ == '__main__':
    main()
