"""Original SpellDataResource resource postload with supplied resolved links.

Only the resolver list is supplied. Null VFX values allow the original asset
registration visitor to run without fabricating linked nonnull definitions.
These controls do not recover actual spell/mode producer order or global0 data.
"""
import argparse
import inspect
import json
from pathlib import Path
import sys
from unicorn import x86_const as r
from character_postload_native import NativeCharacterPostload
from champion_catalog_native import initialize_binary_resource_cache
from global_resource_collection_native import initialize_global_resource_collection
from map_effect_resource_native import NativeMapEffectResources
from vfx_spawn_native import sha
from resource_publication_trace_native import install_resource_publication_trace


class Control(NativeCharacterPostload):
    map_rows = NativeMapEffectResources.map_rows
    resolve_globals = NativeMapEffectResources.resolve_globals


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args=p.parse_args()
    cache=args.cache.resolve()
    tools=Path(__file__).resolve().parent
    paths={Path(__file__).resolve(),args.client.resolve(),
           cache/'public/decoder-16.21-macos/profile.json',
           cache/'public/decoder-16.21-macos/image.bin'}
    paths.update(Path(inspect.getfile(c)).resolve() for c in Control.__mro__ if c is not object)
    paths.update(Path(m.__file__).resolve() for m in tuple(sys.modules.values())
                 if getattr(m,'__file__',None) and Path(m.__file__).suffix=='.py'
                 and Path(m.__file__).resolve().is_relative_to(tools))
    inputs={str(path):sha(path.read_bytes()) for path in paths}
    n=Control(cache/'public/decoder-16.21-macos',args.client)
    trace=install_resource_publication_trace(n)
    n.initialize_character_types()
    descriptor=n.type_catalog['43368569']
    selected_field=[row for row in descriptor['properties'] if row['hash']==0x92a53e77]
    if len(selected_field)!=1 or selected_field[0]['offset']!=0x638:
        raise ValueError('Original SpellDataResource resolver-list metadata differs')
    binary=initialize_binary_resource_cache(n)
    setup=initialize_global_resource_collection(n)
    maps=[]
    for identity,keys in [('first',[0xffffffe1,0xffffffe2]),
                           ('second',[0xffffffe1,0xffffffe3]),('empty',[])]:
        resolver=n.allocate(24)
        n.call(0x16659b0,{r.UC_X86_REG_RDI:resolver})
        table=n.allocate(max(16,len(keys)*16))
        for index,key in enumerate(keys):n.put(table+index*16,'IIQ',key,0,0)
        n.put(resolver+8,'QII',table,len(keys),len(keys))
        maps.append({'id':identity,'object':resolver,
                     'rows':[{'key':key,'referenceToken':0} for key in keys]})
    by_id={row['id']:row for row in maps}
    cases=[]
    for index,ids in enumerate([[],['first'],['second','first'],['empty'],[]]):
        owner=n.allocate(0x800)
        links=n.allocate(max(16,len(ids)*16))
        generation=n.u32(binary['object']+0x68)
        for i,identity in enumerate(ids):
            n.put(links+i*16,'IIQ',i+1,generation,by_id[identity]['object'])
        n.put(owner+0x638,'QI',links,len(ids))
        n.fragment(0x898709,0x8987a3,{r.UC_X86_REG_R14:owner})
        cases.append({'sourceEventId':'control:spell:'+str(index),
                      'sourceIds':ids,'rows':[
                          {'key':row['key'],'referenceToken':row['value']}
                          for row in n.map_rows(setup['resolver'])],
                      'componentPublished':bool(n.q(n.base+0x24a8560))})
    queries=[]
    for key in [0xffffffe1,0xffffffe2,0xffffffe3,0xffffffff]:
        selected=n.resolve_globals(key)
        direct=n.lookup_resource(setup['resolver'],key)
        if selected['value'] or direct['value'] or (direct['found']!=(key!=0xffffffff)):
            raise ValueError('Original resource-only postload/query differs')
        queries.append({'key':key,'found':direct['found'],'value':selected['value'],
                        'selectedResolver':selected['selectedResolver']})
    expected_counts={'global0-merge-entered':4,'global0-publication-entered':4,
                     'global-component-publication-entered':1,'global0-asset-registration-entered':4}
    counts={kind:sum(event['kind']==kind for event in trace.events) for kind in expected_counts}
    if len(trace.events)!=13 or counts!=expected_counts:
        raise ValueError('Read-only original resource producer trace differs')
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Producer input changed: '+path)
    result={'schema':1,'kind':'original-spell-global-resource-publication-controls',
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
            'decoderImageSha256':sha(n.image),'inputs':inputs,
            'setup':setup,'binaryCache':binary,'maps':maps,'cases':cases,'queries':queries,
            'publicationTrace':trace.snapshot(),
            'sourceField':{'ownerTypeHash':0x43368569,'fieldHash':0x92a53e77,
                           'descriptorRva':descriptor['rva'],'property':selected_field[0]},
            'otherProducerFamilies':[
                {'callRvas':[0x42f99b,0x42f9c0,0x42f9e5,0x42fa0a],
                 'resourceFieldOffsets':[0x70,0x88,0xa0,0xb8],
                 'historyRecovered':False},
                {'callRvas':[0x4a9499],'historyRecovered':False}],
            'staticProducerBlocks':[{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])}
                                    for a,b in [(0x42f976,0x42fa0f),
                                                (0x4a9440,0x4a949e)]],
            'originalBlocks':list(n.blocks.values()),
            'scope':{'originalSpellResolverListAndPublication':True,
                     'suppliedResolvedLinkCache':True,'suppliedNullVfxValues':True,
                     'actualSpellModeProducerHistoryRecovered':False,
                     'actualReplayGlobal0ContentsRecovered':False,
                     'nonnullVfxRegistrationEstablished':False,'actualEffectsActivated':False}}
    output=cache/'research/spell-resource-publication-native.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'queries':len(queries)}))


if __name__=='__main__':main()
