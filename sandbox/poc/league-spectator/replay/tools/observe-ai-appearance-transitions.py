"""Replay ordered appearance storage prefixes on originally constructed AI units.

Units/defaults/cache keys are supplied controls. Projection and post-projection
callbacks are not executed, so this does not recover accepted live match state.
Unknown target defaults remain unresolved rather than becoming empty defaults.
"""
import argparse
from collections import Counter
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache,args.client)
    n,cache = fixture.native,fixture.cache
    captured = fixture.read(cache/'research/appearance-packets.json')
    semantics = fixture.read(cache/'research/latest-semantics-effects.json')
    effects = fixture.read(cache/'public/latest-effects/manifest.json')
    if (captured['decoderImageSha256'] != sha(n.image) or semantics['decoderImageSha256'] != sha(n.image) or
            semantics['build'] != captured['build'] or effects['build'] != captured['build']):
        raise ValueError('Matching original packet/candidate/asset build required')
    for path,digest in captured['inputs'].items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Original appearance packet capture input changed')
    for path,digest in captured['sources'].items():
        if sha(fixture.raw(fixture.root/path)) != digest:
            raise ValueError('Original appearance packet capture source changed')
    heroes = {hero['entityId']:hero for hero in semantics['heroes']}
    prepared = {}
    for hero in heroes.values():
        actor_key = 'champions/%s/%u' % (hero['champion'].lower(),hero['skinId'])
        actor = effects['actors'][actor_key]
        if actor['character'] != hero['champion'] or actor['skinId'] != hero['skinId']:
            raise ValueError('Supplied hero candidate lacks matching prepared asset identity')
        prepared[(hero['champion'],'',hero['skinId'])] = True
    for event in captured['records']:
        if event['opcode'] == 984:
            prepared[(event['strings']['character'],event['strings']['namespace'],event['skinId'])] = True
    n.prepare_cache([{'name':name,'namespace':namespace,'skinId':skin,'keyFlags':0,'context':0}
                     for name,namespace,skin in sorted(prepared)])

    def stored(unit):
        stack = unit+0x35e0
        state = n.stack_input(stack)
        pointers = [stack+0x18]+list(range(n.q(stack),n.q(stack+8),0xa0))
        for entry,at in zip([state['defaultEntry']]+state['entries'],pointers):
            entry.update(entryId=n.u32(at+0x80),overrideMask=n.u32(at+0x98),
                         alternateSkinA=n.u32(at+0x48),alternateSkinB=n.u32(at+0x70))
        return state

    def apply_expected(state,default,event):
        if event['opcode'] == 984:
            if event['preloadFlag'] or event['modifierNames'] or event['strings']['alternateCharacterA'] or event['strings']['alternateCharacterB']:
                raise ValueError('Explicit replay storage control excludes unresolved preloads/modifiers/alternates')
            skin = event['skinId']
            if skin == 0xffffffff:
                skin = next((entry['key']['skinId'] for entry in reversed(state) if entry['overrideMask'] == 16),default['key']['skinId'])
            state.append({'key':{'name':event['strings']['character'],'namespace':event['strings']['namespace'],'skinId':skin,'keyFlags':0},
                          'flags':[event[key] for key in ['flagR8','flagR9','flagStack0','flagStack2','flagStack3']],
                          'gearIndex':event['gearIndex'],'modifierNames':[],
                          'alternateCharacterA':'','alternateCharacterB':'','entryId':event['entryId'],'overrideMask':event['overrideMask'],
                          'alternateSkinA':default['key']['skinId'] if event['alternateSkinA'] == 0xffffffff else event['alternateSkinA'],
                          'alternateSkinB':default['key']['skinId'] if event['alternateSkinB'] == 0xffffffff else event['alternateSkinB']})
        elif event['opcode'] == 459:
            index = next((i for i,entry in enumerate(state) if entry['entryId'] == event['entryId']),None)
            if index is not None:
                state.pop(index)
        elif event['opcode'] == 1045:
            state.clear()
        else:
            raise ValueError('Unsupported appearance storage operation')
    units,expected,defaults = {},{},{}
    for entity,hero in heroes.items():
        unit = fixture.construct_ai()
        fixture.initialize_default_storage(unit,hero['champion'],hero['skinId'])
        units[entity],expected[entity] = unit,[]
        defaults[entity] = stored(unit)['defaultEntry']
    handlers = {984:0xf7700,459:0xf7b90,1045:0xf7c80}
    records,unresolved,boundaries = [],[],[]
    for event in captured['records']:
        if event['entityId'] not in units or event['opcode'] not in handlers or event['stream'] != 1:
            unresolved.append({'transportSequence':event['transportSequence'],'opcode':event['opcode'],
                               'entityId':event['entityId'],'reason':'target-default-or-operation-unresolved'})
            continue
        entity,unit = event['entityId'],units[event['entityId']]
        obj,heap = bytes.fromhex(event['objectHex']),bytes.fromhex(event['heapHex'])
        if heap[:len(obj)] != obj or int.from_bytes(obj[8:12],'little') != event['opcode'] or int.from_bytes(obj[12:16],'little') != entity:
            raise ValueError('Original appearance captured object/arena differs')
        before = stored(unit)
        try:
            n.u.mem_write(0x10200000,heap)
            endpoint = fixture.run_to(handlers[event['opcode']],0x668c0,
                                     {r.UC_X86_REG_RDI:unit,r.UC_X86_REG_RSI:0x10200000},True)
            fixture.check_guard(unit)
        except Exception as exception:
            boundaries.append({'transportSequence':event['transportSequence'],'opcode':event['opcode'],'entityId':entity,
                               'time':event['time'],'kind':type(exception).__name__,'message':str(exception),
                               'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'before':before})
            break
        state = expected[entity]
        apply_expected(state,defaults[entity],event)
        actual = stored(unit)
        if actual['defaultEntry'] != defaults[entity] or actual['entries'] != state:
            raise ValueError('Ordered original AI appearance storage differs: '+json.dumps({'actual':actual['entries'],'expected':state}))
        projection = n.project(unit+0x35e0)
        records.append({'transportSequence':event['transportSequence'],'opcode':event['opcode'],'entityId':entity,'time':event['time'],
                        'endpoint':endpoint,'unit':unit,'stack':actual,'projection':projection})
    controls = []
    if not boundaries:
        unit = fixture.construct_ai()
        fixture.initialize_default_storage(unit,'Viego',43)
        default,state = stored(unit)['defaultEntry'],[]
        template = next(event for event in captured['records'] if event['opcode'] == 984)
        def push(entry_id,skin,mask):
            return {**template,'strings':{'character':'Viego','namespace':'','alternateCharacterA':'','alternateCharacterB':''},
                    'entryId':entry_id,'skinId':skin,'overrideMask':mask,'alternateSkinA':0xffffffff,'alternateSkinB':0xffffffff}
        operations = [push(100,2,16),push(101,0xffffffff,1),push(100,43,1),
                      {'opcode':459,'entryId':100,'popFlagR8':False},push(103,0xffffffff,1),
                      {'opcode':459,'entryId':999,'popFlagR8':False},
                      {'opcode':1045,'clearFlag':False},push(104,43,1),{'opcode':1045,'clearFlag':True}]
        for event in operations:
            if event['opcode'] == 984:
                n.push_storage(unit+0x35e0,event)
            elif event['opcode'] == 459:
                fixture.run_to(0x66cc0,0x668c0,{r.UC_X86_REG_RDI:unit+0x35e0,r.UC_X86_REG_RSI:event['entryId'],
                                              r.UC_X86_REG_RDX:0,r.UC_X86_REG_RCX:0},True)
            else:
                fixture.run_to(0x66f10,0x668c0,{r.UC_X86_REG_RDI:unit+0x35e0,r.UC_X86_REG_RSI:int(event['clearFlag'])},True)
            apply_expected(state,default,event)
            actual = stored(unit)
            fixture.check_guard(unit)
            if actual['entries'] != state or actual['defaultEntry'] != default:
                raise ValueError('Original signed-skin/duplicate-pop/clear storage control differs')
            controls.append({'operation':event,'stack':actual})
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in NativeGameModeData.__mro__ if c is not object]}
    result = {'schema':1,'kind':'ordered-original-ai-appearance-storage-observations','build':n.profile['clientVersion'],
              'protocol':n.profile['protocolDigest'],'inputs':fixture.inputs,
              'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},'originalBlocks':list(n.blocks.values()),
              'defaultInputs':list(heroes.values()),'units':units,'preparedCache':n.prepared_appearance_cache,
              'initialStates':{entity:{'localPlayer':'absent','defaultEntry':default,'entries':[]} for entity,default in defaults.items()},
              'loadingConfiguration':fixture.loading_configuration,
              'records':records,'unresolved':unresolved,'boundaries':boundaries,'controls':controls,
              'counts':{'originalAiUnitsConstructed':len(units)+(1 if controls else 0),
                        'suppliedTargetUnits':len(units),'orderedOperations':len(records),
                        'operationsByOpcode':dict(Counter(record['opcode'] for record in records)),
                        'syntheticStorageControls':len(controls),
                        'unresolvedTargetDefaultsOrOperations':len(unresolved),'boundaries':len(boundaries)},
              'completeControls':not boundaries,
              'scope':{'originalUnitConstructorsExecuted':True,'originalPacketHandlersAndVirtualUnitPreludesExecuted':True,
                       'suppliedRoutingUnits':True,'suppliedDefaultAppearanceCandidates':True,'suppliedCacheKeysOnly':True,
                       'stoppedBeforeProjectionPerOperation':True,'separateOriginalProjectionExecuted':True,
                       'postProjectionUnitCallbacksExecuted':False,'liveWorldRouteVerified':False,
                       'acceptedLiveAppearanceRecovered':False,'assetReadinessVerified':False,'mainViewerExpanded':False}}
    (cache/'research/ai-appearance-transitions-native.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'counts':result['counts'],'completeControls':result['completeControls'],'boundaries':boundaries[:1]}))


if __name__ == '__main__':
    main()
