"""Original appearance resource projection and base-context callback controls."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from appearance_resource_native import NativeAppearanceResources, CACHE, LOCAL_PLAYER
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def read(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return json.loads(data)

    effects = read(cache/'public/latest-effects/manifest.json')
    maps = read(cache/'research/effect-resolvers-native.json')
    appearances = read(cache/'research/appearance-stack-inputs-comparison.json')
    for report in [maps,appearances]:
        if report.get('mismatchCount',0):
            raise ValueError('Matching appearance/resource evidence required')
        for path,digest in report['inputs'].items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Appearance/resource input changed: '+path)
        for path,digest in report['sources'].items():
            source = Path(__file__).parent/path if report is maps else Path(__file__).parents[1]/path
            if sha(source.read_bytes()) != digest:
                raise ValueError('Appearance/resource source changed: '+str(source))
    n = NativeAppearanceResources(cache/'public/decoder-16.21-macos',args.client)
    if maps['decoderImageSha256'] != sha(n.image) or effects['build'] != n.profile['clientVersion']:
        raise ValueError('Exact matching resource build required')
    if n.q(n.base+LOCAL_PLAYER):
        raise ValueError('Unexpected initialized local player')
    native_maps = {c['actorKey']:n.load_prepared_map(c) for c in maps['cases'] if c['status'] == 'native-resource-map-loaded'}
    library = n.prepared_library(sorted([{'identity':c['resourceResolverId'],'object':native_maps[c['actorKey']],
                                         'type':n.types[0xef3a0f33]} for c in maps['cases'] if c['actorKey'] in native_maps],
                                       key=lambda entry:entry['identity']))
    entries, contexts = [], {}
    for actor_key,resolver in native_maps.items():
        actor = effects['actors'][actor_key]
        context = n.character_context(actor['character'],actor['skinId'])
        acquired = n.acquire_prepared_context(context['object'],'characters/%s/Skins/Skin%u/Resources' % (actor['character'],actor['skinId']))
        if acquired['resolver'] != resolver or not acquired['ready']:
            raise ValueError('Original context did not acquire supplied typed resolver')
        contexts[context['object']] = {'actorKey':actor_key,'resolver':resolver,'identity':context['identity']}
        entries.append({'name':actor['character'],'namespace':'','skinId':actor['skinId'],'keyFlags':0,'context':context['object']})
    requested = {(e['strings']['character'],e['strings']['namespace'],e['skinId']) for e in appearances['records'] if e['opcode'] == 984}
    for name,namespace,skin in sorted(requested):
        if not any((e['name'],e['namespace'],e['skinId']) == (name,namespace,skin) for e in entries):
            # This is a cache-key control, not an asset-loaded context. It must
            # never be installed as a resolved live resource context.
            entries.append({'name':name,'namespace':namespace,'skinId':skin,'keyFlags':0,'context':0})
    prepared = n.prepare_cache(entries)
    baseline = next(e for e in prepared if e['name'] == 'Viego')
    cases, boundary_cases = [], []
    unit = n.create_unit(base_resolver=contexts[baseline['context']]['resolver'],overlays=[None])

    def observe(label,stack,event=None):
        supplied = n.stack_input(stack)
        projected = n.project(stack)
        callback = None
        wrapper = projected['objects'][5]
        if wrapper:
            context = n.q(wrapper+0x20)
            before = n.q(unit['group']+0x10)
            n.call(0xc4f10,{r.UC_X86_REG_RDI:unit['object']+0xb28,r.UC_X86_REG_RSI:projected['outputs']+0x28})
            after = n.q(unit['group']+0x10)
            if n.q(unit['object']+0x110) != context or after != (contexts[context]['resolver'] if context else before):
                raise ValueError('Original appearance base callback selected another resolver')
            if n.q(unit['group']+0x20)-n.q(unit['group']+0x18) != 8 or n.q(n.q(unit['group']+0x18)) != 0:
                raise ValueError('Original appearance base callback changed overlays')
            callback = {'context':context,'baseResolver':after,'priorBaseResolver':before,
                        'contextIdentity':contexts[context]['identity'] if context else None}
        cases.append({'label':label,'stack':stack,'input':supplied,'projection':projected,'callback':callback,
                      'event':None if event is None else {'transportSequence':event['transportSequence'],
                               'entityId':event['entityId'],'time':event['time']}})

    for entry in prepared:
        observe('default-cache-key-control',n.appearance_stack(entry['name'],entry['skinId']))
    for event in appearances['records']:
        if event['opcode'] == 984:
            stack = n.appearance_stack(baseline['name'],baseline['skinId'])
            n.push_storage(stack,event)
            observe('independent-replay-push-control',stack,event)
    template = next(e for e in appearances['records'] if e['opcode'] == 984)
    for flags in range(32):
        for depth in range(1,5):
            stack = n.appearance_stack(baseline['name'],baseline['skinId'])
            for layer in range(depth):
                entry = prepared[(flags+layer*3) % len(prepared)]
                event = {**template,'strings':{'character':entry['name'],'namespace':entry['namespace'],
                                              'alternateCharacterA':'','alternateCharacterB':''},
                         'skinId':entry['skinId'],'entryId':layer+1,'gearIndex':(flags*17+layer*31) & 255}
                n.push_storage(stack,event)
                bits = flags if layer == depth-1 else (flags+layer*7+depth) & 31
                n.u.mem_write(n.q(stack+8)-0xa0+0x78,bytes((bits >> bit) & 1 for bit in range(5)))
            observe('supplied-flags-layer-control',stack)
    for name in ['vIeGo','VIEGO','viego','']:
        observe('case-fold-or-empty-key-control',n.appearance_stack(name,baseline['skinId']))
    for name,skin,namespace in [('UnpreparedCharacter',0,''),('Viego',999,''),('Viego',43,'unprepared')]:
        stack = n.appearance_stack(name,skin,namespace)
        boundary_cases.append({'input':n.stack_input(stack),'result':n.project(stack,True)})
    ranges = [(0x67330,0x67ac0),(0x2a6000,0x2a6170),(0x2a68ee,0x2a692a),
              (0x2a90f0,0x2a9460),(0x14c2fb0,0x14c3020),(0xc4f10,0xc4f30),
              (0x548bf0,0x548c30),(0x353f70,0x353f80),(0x66230,0x668c0)]
    for a,b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original appearance resource code differs')
    paths = {Path(__file__),Path(inspect.getfile(NativeEffectContexts)),
             *[Path(inspect.getfile(c)) for c in NativeAppearanceResources.__mro__ if c is not object]}
    current = bytes(n.u.mem_read(n.base,len(n.image)))
    patches = [{'rva':at,'bytesHex':current[at:at+4096].hex()} for at in range(0,len(n.image),4096)
               if current[at:at+4096] != n.image[at:at+4096]]
    if any(patch['rva'] < 0x1fef000 for patch in patches):
        raise ValueError('Appearance snapshot would patch original code')
    meta = {'schema':1,'kind':'prepared-original-appearance-resource-projection','build':n.profile['clientVersion'],
            'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
            'constructorImageSha256':n.profile['constructorImageSha256'],
            'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])} for a,b in ranges],
            'channels':['callback18','callback38','callback10','callback20','callback28','baseContextCallback30'],
            'contract':{'keyStringComparison':'ascii-case-insensitive','keyFields':['name','namespace','skinId','keyFlags'],
                        'localPlayer':'absent','alternateCharacters':'empty','modifierNames':'empty','resourceCache':'explicit-prepared-keys-only',
                        'stackState':'explicit-supplied-post-storage-entries'},
            'scope':{'staticBuildDataOnly':True,'containsReplayEvents':False,'fullProjectionExecuted':True,
                     'fullAssetLoaderExecuted':False,'liveAppearanceStateRecovered':False,'mainViewerExpanded':False},
            'producerSha256':sha(Path(__file__).read_bytes())}
    package = cache/'public/latest-appearance-resources/package.json'
    package.parent.mkdir(exist_ok=True)
    encoded = json.dumps(meta,indent=2).encode()
    package.write_bytes(encoded)
    report = {'schema':1,'kind':'original-appearance-resource-projection-observations',
              'build':meta['build'],'protocol':meta['protocol'],'packageSha256':sha(encoded),
              'inputs':inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'preparedCache':prepared,'contexts':contexts,
              'cases':cases,'boundaryCases':boundary_cases,'unit':unit,'library':library,
              'snapshot':{'heapAddress':0x10400000,'heapHex':bytes(n.u.mem_read(0x10400000,n.next_heap-0x10400000)).hex(),
                          'imagePatches':patches,'cacheRva':CACHE,'localPlayerRva':LOCAL_PLAYER},
              'counts':{'projectionControls':len(cases),
                        'replayPushControls':sum(c['label'] == 'independent-replay-push-control' for c in cases),
                        'flagLayerControls':sum(c['label'] == 'supplied-flags-layer-control' for c in cases),
                        'baseContextCallbacks':sum(c['callback'] is not None for c in cases),'cacheMissStops':len(boundary_cases)},
              'scope':{**meta['scope'],'suppliedPreparedCache':True,'suppliedNamedResourceLibrary':True,
                       'suppliedLibraryReadyPredicate':True,'localPlayerExplicitlyAbsent':True,
                       'alternateCharactersExplicitlyEmpty':True,'originalBaseContextCallbackExecuted':True,
                       'allUnitCallbacksExecuted':False,'liveUnitConstructorExecuted':False,'referenceLinksFixed':False,
                       'effectFactoryExecuted':False}}
    (cache/'research/appearance-resources-native.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(encoded),'counts':report['counts']}))


if __name__ == '__main__':
    main()
