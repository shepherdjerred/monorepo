"""Follow original queued character references into exact installed BIN roots.

This constructs a caller-owned dependency library. It does not run asset
post-load, assert readiness, install a live global registry or execute unit
callbacks. Original parser skips remain explicit observations.
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
from native_ai_unit_fixture import NativeAIUnitFixture
from character_asset_native import NativeCharacterAssets
from vfx_object_native import NativeVfxObjects
from vfx_spawn_native import sha
from character_graph_snapshot import capture


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--actor',required=True)
    args = p.parse_args(argv)
    fixture = NativeAIUnitFixture(args.cache,args.client,NativeCharacterAssets)
    n,cache = fixture.native,fixture.cache
    effects = fixture.read(cache/'public/latest-effects/manifest.json')
    package = fixture.read(cache/'public/latest-effects/package.json')
    globals_ = fixture.read(cache/'research/global-asset-inputs/index.json')
    if (effects['build'] != n.profile['clientVersion'] or globals_['build'] != effects['build'] or
            globals_['protocol'] != effects['protocol'] or args.actor not in effects['actors']):
        raise ValueError('Exact prepared actor and installed global build required')
    for path,digest in globals_['sources'].items():
        if sha(fixture.raw(fixture.root/path)) != digest:
            raise ValueError('Installed global asset producer changed: '+path)
    if json.loads(importlib.metadata.distribution('cdtb').read_text('direct_url.json'))['vcs_info']['commit_id'] != effects['toolchain']['cdtbRevision']:
        raise ValueError('Pinned actor BIN parser required')
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name('parse-latest-assets.py')))['names']
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        path = cache/'vfx'/('hashes.'+name+'.txt')
        if sha(fixture.raw(path)) != effects['toolchain']['dictionaries'][name]:
            raise ValueError('Pinned actor property dictionary required')
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

    def source_entries(source,scope):
        data = fixture.raw(Path(source['source']))
        if sha(data) != source['sha256'] or data[:4] != b'PROP':
            raise ValueError('Character dependency source bytes changed')
        encoded = fixture.raw(Path(source['output']))
        if sha(encoded) != source['jsonSha256']:
            raise ValueError('Character dependency parsed source changed')
        parsed = json.loads(encoded)
        stream = io.BytesIO(data)
        stream.read(4)
        reader = Reader(stream)
        _,_,types = reader.read_binfile_header()
        entries = [reader.read_binfile_entry(t) for t in types]
        if stream.tell() != len(data):
            raise ValueError('Character dependency BIN left unread bytes')
        for entry in entries:
            spans = [reader.spans[id(field)] for field in entry.fields]
            fields = [data[a:b] for a,b in spans]
            required = {}
            def collect(value):
                if isinstance(value,list):
                    for child in value: collect(child)
                elif isinstance(value,dict):
                    if '__type' in value:
                        name = value['__type']
                        if name.startswith('{') and name.endswith('}'):
                            identity = int(name[1:-1],16)
                        else:
                            identity = 0x811c9dc5
                            for byte in name.lower().encode('utf-8'):
                                identity = ((identity ^ byte)*0x1000193)&0xffffffff
                        required[identity] = name
                    for child in value.values(): collect(child)
            collect(parsed['{%08x}' % entry.path.h])
            yield {'identity':entry.path.h,'typeHash':entry.type.h,'fields':fields,
                   'requiredTypes':required,
                   'contentSha256':sha(entry.type.h.to_bytes(4,'little')+b''.join(fields)),
                   'source':source,'scope':scope,
                   'fieldSpans':[{'offset':a,'bytes':b-a,'sha256':sha(data[a:b])} for a,b in spans]}

    local,global_roots = {},{}
    for source in package['actors'][args.actor]['sourceBins']:
        stem = source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]
        adapted = {'source':str(cache/'research/latest-effects/bins'/(stem+'.bin')),
                   'output':str(cache/'research/latest-effects/bins'/(stem+'.json')),
                   'sha256':source['sourceSha256'],'jsonSha256':source['jsonSha256']}
        for entry in source_entries(adapted,'actor'):
            old = local.get(entry['identity'])
            if old and old['contentSha256'] != entry['contentSha256']:
                raise ValueError('Conflicting actor-local root: %08x' % entry['identity'])
            local[entry['identity']] = entry
    for source in globals_['jobs']:
        for entry in source_entries(source,'installed-shared'):
            global_roots.setdefault(entry['identity'],[]).append(entry)
    n.initialize_character_types()
    initial = sorted(identity for identity,entry in local.items() if entry['typeHash'] in [0x23ea1915,0x9b67e9f6])
    if not initial:
        raise ValueError('Actor has no character or skin records')
    pending,scheduled = deque(initial),set(initial)
    cases,loaded,boundaries = [],{},[]
    while pending:
        identity = pending.popleft()
        candidates = [local[identity]] if identity in local else global_roots.get(identity,[])
        if not candidates:
            boundaries.append({'identity':identity,'kind':'missing-installed-root'})
            continue
        if len({entry['contentSha256'] for entry in candidates}) != 1:
            boundaries.append({'identity':identity,'kind':'conflicting-global-roots',
                               'sources':[entry['source'] for entry in candidates]})
            continue
        entry = candidates[0]
        case = {key:value for key,value in entry.items() if key != 'fields'}
        missing_types = [{'hash':key,'name':name} for key,name in entry['requiredTypes'].items() if key not in n.types]
        case['unregisteredAuthoredTypes'] = missing_types
        # Missing nested tool metadata may be skipped by the original reader.
        # Only execution establishes whether a missing nested type is required.
        if entry['typeHash'] not in n.types:
            boundaries.append({'identity':identity,'typeHash':entry['typeHash'],
                               'kind':'unregistered-original-types','types':missing_types})
            continue
        try:
            case['loaded'] = n.observe_actor_fields(entry['typeHash'],entry['fields'])
        except Exception as exception:
            case['boundary'] = {'kind':type(exception).__name__,'message':str(exception),
                                'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
            cases.append(case)
            boundaries.append({'identity':identity,**case['boundary']})
            # A failed constructor/reader may have modified globals or ownership.
            # Stop this arena rather than continuing after an unknown mutation.
            break
        cases.append(case)
        loaded[identity] = case['loaded']
        for link in case['loaded']['pendingReferences']:
            target = link['identity']
            if target and target not in scheduled:
                if not 0 < target <= 0xffffffff or len(scheduled) >= 4096:
                    raise ValueError('Character dependency identity/count exceeds bounds')
                scheduled.add(target)
                pending.append(target)
        if len(cases) % 50 == 0:
            print(json.dumps({'actor':args.actor,'loadedRoots':len(loaded),'queued':len(pending)}),flush=True)
    fixups = None
    if not boundaries and not pending:
        # Merge only roots actually reached by the native queue. This is an
        # explicit research library, not the game's live global loader.
        links = [dict(link,ownerIdentity=case['identity']) for case in cases for link in case['loaded']['pendingReferences']]
        if len(links) > 65536:
            raise ValueError('Character reference queue exceeds explicit bound')
        library,table,context,queue = n.allocate(0x48),n.allocate(max(24,len(loaded)*24)),n.allocate(24),n.allocate(max(16,len(links)*16))
        for i,(identity,root) in enumerate(sorted(loaded.items())):
            n.put(table+i*24,'QQII',root['object'],n.types[root['typeHash']],identity,0)
        n.put(library+0x10,'QII',table,len(loaded),len(loaded))
        for i,link in enumerate(links):
            if n.q(link['destination']) != link['identity']:
                raise ValueError('Queued authored identity changed before reference fixup')
            n.put(queue+i*16,'QQ',link['destination'],link['expectedType'])
        n.put(context,'QQII',library,queue,len(links),len(links))
        before = {'contextAddress':context,'contextHex':bytes(n.u.mem_read(context,24)).hex(),
                  'pendingAddress':queue,'pendingHex':bytes(n.u.mem_read(queue,len(links)*16)).hex(),
                  'libraryAddress':library,'libraryHex':bytes(n.u.mem_read(library,0x48)).hex(),
                  'tableAddress':table,'tableHex':bytes(n.u.mem_read(table,len(loaded)*24)).hex()}
        def reject_global_miss(engine,address,size,user):
            raise ValueError('Complete character library reached original global-miss boundary')
        hook = n.u.hook_add(unicorn.UC_HOOK_CODE,reject_global_miss,
                            begin=n.base+0x14bc000,end=n.base+0x14bc000)
        n.u.ctl_remove_cache(n.base+0x14bbf40,n.base+0x14bc060)
        try:
            n.call(0x14bbf40,{r.UC_X86_REG_RDI:context})
        finally:
            n.u.hook_del(hook)
        if n.u32(context+0x10):
            raise ValueError('Original character fixup left queued references')
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
            actual = n.q(link['destination'])
            if actual != expected:
                raise ValueError('Fixed character reference differs from original typed cast')
            link['fixedPointer'] = actual
        fixups = {**before,'links':links,'pendingAfter':n.u32(context+0x10),
                  'rejectedNonNullReferences':rejected,
                  'status':'typed-reference-rejections' if rejected else 'typed-local-links-resolved',
                  'contextAfterHex':bytes(n.u.mem_read(context,24)).hex()}
        for case in cases:
            root = case['loaded']
            case['fixedObjectHex'] = bytes(n.u.mem_read(root['object'],root['size'])).hex()
    snapshot = None
    if fixups and not fixups['rejectedNonNullReferences'] and not boundaries:
        snapshot = capture(n,cache/'research'/('character-asset-links-'+args.actor.replace('/','-')+'-heap.bin'))
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(__file__).with_name('parse-latest-assets.py'),
             Path(__file__).with_name('character_graph_snapshot.py'),
             Path(inspect.getfile(NativeVfxObjects)),
             *[Path(inspect.getfile(c)) for c in NativeCharacterAssets.__mro__ if c is not object]}
    result = {'schema':1,'kind':'original-character-dependency-input-observations',
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
              'decoderImageSha256':sha(n.image),'actorKey':args.actor,'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'initialRoots':initial,'cases':cases,'boundaries':boundaries,'fixups':fixups,
              'queuedNotRead':list(pending),'snapshot':snapshot,
              'counts':{'loadedRoots':len(loaded),'scheduledRoots':len(scheduled),
                        'pendingReferences':sum(len(case['loaded']['pendingReferences']) for case in cases if 'loaded' in case),
                        'originalSkippedFields':sum(len(case['loaded']['originalSkippedFields']) for case in cases if 'loaded' in case),
                        'sharedRoots':sum(case['scope'] == 'installed-shared' and 'loaded' in case for case in cases),
                        'fixedReferences':len(fixups['links']) if fixups else 0,
                        'rejectedNonNullReferences':len(fixups['rejectedNonNullReferences']) if fixups else 0,
                        'boundaries':len(boundaries)},
              'scope':{'originalConstructorsAndTypedReadersExecuted':True,'originalQueuedReferencesFollowed':True,
                       'actorLocalRootsBeforeSharedRoots':True,'referenceLinksFixed':bool(fixups and not fixups['rejectedNonNullReferences']),
                       'nativeFieldSkipsReportedExplicitly':True,'fullAssetPostloadExecuted':False,
                       'assetReadinessVerified':False,'unitCallbacksExecuted':False,'mainViewerExpanded':False}}
    output = cache/'research'/('character-asset-links-'+args.actor.replace('/','-')+'-native.json')
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts'],'boundaries':boundaries}),flush=True)
    return fixture,result


if __name__ == '__main__':
    main()
