"""Original TriggerOnHit construction and no-hit local lifecycle controls.

Original spec/action factories, component creation, ordered phase/frame callbacks
and explicit stop run on owned no-child actors. A supplied-hit control invokes
the original component hit entry; its downstream Cast dispatcher is a recorded
omitted side effect. No actual match collision or active family is admitted.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import sys

import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Trigger input changed during capture')
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    scene = read(cache/'public/latest-scene/manifest.json')
    actor_asset = scene['champions']['akshan/20']
    catalog = read(cache/'public/latest-scene'/actor_asset['spellCatalog'])
    spell = catalog['spells']['43261541']
    source_spec = spell['data']['mMissileSpec']['behaviors']
    if source_spec != [{'mActions': [{'__type': 'Cast'}], '__type': 'TriggerOnHit'},
                       {'__type': 'DestroyOnMovementComplete'}]:
        raise ValueError('Exact authored TriggerOnHit+Cast source required')
    n = NativeSpawn(cache/'public/decoder-16.21-macos', args.client)
    for name in ['profile.json', 'image.bin', 'vfx-birth.json', 'vfx-values.json']:
        raw(cache/'public/decoder-16.21-macos'/name)
    raw(args.client)
    actor_package_bytes=raw(cache/'public/decoder-16.21-macos/missile-actors.json')
    actor_package=json.loads(actor_package_bytes)
    if sha(actor_package_bytes)!=n.profile['missileActorsSha256'] or actor_package['behaviors']['CastOnHit']['runtimeVtableRva']!=0x235df20:
        raise ValueError('Original independent CastOnHit metadata differs')
    actor, motion, presentation = [n.allocate(size) for size in [0x8100, 0x200, 0x100]]
    callbacks, mode = [], {'suppliedHit': False}

    def capture(engine, address, size, user):
        entry = address-n.base
        if entry == 0x8950e0:
            if engine.reg_read(r.UC_X86_REG_RDI) != presentation:
                raise ValueError('Stop escaped owned presentation')
            callbacks.append({'kind': 'stop-presentation', 'entryRva': entry})
        elif entry == 0x8b5740:
            if not mode['suppliedHit'] or engine.reg_read(r.UC_X86_REG_RDI) != actor+0x1a8:
                raise ValueError('No-hit path dispatched a Cast action')
            pointer = engine.reg_read(r.UC_X86_REG_RSI)
            if not ADDRESSES['stack']-0x1000 <= pointer <= ADDRESSES['stack']-12:
                raise ValueError('Cast direction escaped original callback stack')
            callbacks.append({'kind': 'omitted-cast-dispatch', 'entryRva': entry,
                              'directionHex': bytes(engine.mem_read(pointer,12)).hex()})
        n.ret()

    for entry in [0x8950e0,0x8b5740]:
        n.u.hook_add(unicorn.UC_HOOK_CODE,capture,begin=n.base+entry,end=n.base+entry)
    mask64=(1<<64)-1
    encoded=motion ^ 0x453b8f8b
    encoded=(((((encoded<<53)|(encoded>>11))+0x453b8f8b)&mask64)^0x496e69c7)
    byte=lambda at:bytes(n.u.mem_read(at,1))[0]

    def components():
        return [n.q(at) for at in range(n.q(actor+0x3b0),n.q(actor+0x3b8),8)]

    def snapshot():
        rows=[]
        for component in components():
            actions=[]
            for at in range(n.q(component+0x10),n.q(component+0x18),8):
                action=n.q(at)
                actions.append({'vtableRva':n.q(action)-n.base,
                                'executed':bool(byte(action+8))})
            rows.append({'vtableRva':n.q(component)-n.base,
                         'ownerMatches':n.q(component+8)==actor,'actions':actions,
                         **({'remainingDelay':struct.unpack('<i',n.u.mem_read(component+0x28,4))[0],
                             'fired':bool(byte(component+0x2c))}
                            if n.q(component)-n.base==0x235c300 else {})})
        return {'phase':byte(actor+0x368),'phaseLatch':bool(byte(actor+0x36d)),
                'phaseCount':byte(actor+0x36b),'stopped':bool(byte(actor+0x3c8)),
                'positionHex':bytes(n.u.mem_read(actor+0x15c,12)).hex(),
                'velocityHex':bytes(n.u.mem_read(actor+0x58,12)).hex(),
                'components':rows,'callbacks':[dict(row) for row in callbacks]}

    cases=[]
    for velocity in [[1.25,-3.5,7.75],[0,0,0],[0.1,0.2,0.3]]:
      for order in [[],['trigger'],['destroy'],['trigger','destroy'],['destroy','trigger'],
                    ['trigger','trigger','destroy']]:
        n.u.mem_write(actor,bytes(0x8000))
        n.u.mem_write(actor+0x8000,b'\xa5'*0x100)
        n.put(actor,'Q',n.base+0x235ae00)
        n.call(0x8639bb,{r.UC_X86_REG_RBX:actor},0x863a3b)
        n.put(actor+0x340,'Q',encoded)
        n.put(actor+0x348,'Q',presentation)
        n.put(actor+0x15c,'fff',17,19,23)
        n.put(actor+0x58,'fff',*velocity)
        n.put(motion,'Q',n.base+0x235d018)
        spec_defaults=[]
        for kind in order:
            if kind=='trigger':
                n.call(0x86f770,{})
                spec=n.u.reg_read(r.UC_X86_REG_RAX)
                if n.q(spec)-n.base!=0x235b5f0 or bytes(n.u.mem_read(spec+8,16))!=bytes(16):
                    raise ValueError('Original TriggerOnHit spec defaults differ')
                n.call(0x86fd80,{})
                action_spec=n.u.reg_read(r.UC_X86_REG_RAX)
                if byte(action_spec+8)!=0:
                    raise ValueError('Original Cast action default differs')
                action_list=n.allocate(8)
                n.put(action_list,'Q',action_spec)
                n.put(spec+8,'QII',action_list,1,1)
                n.call(0x868730,{r.UC_X86_REG_RDI:spec,r.UC_X86_REG_RSI:actor})
                spec_defaults.append({'type':'TriggerOnHit','specVtableRva':n.q(spec)-n.base,
                                      'actionSpecVtableRva':n.q(action_spec)-n.base,
                                      'actions':1,'rollForCriticalHitResult':False})
            else:
                spec=n.allocate(0x80)
                n.put(spec,'Q',n.base+0x235bb70)
                n.put(spec+8,'iB',0,1)
                n.call(0x869860,{r.UC_X86_REG_RDI:spec,r.UC_X86_REG_RSI:actor})
        first,end=n.q(actor+0x3d0),n.q(actor+0x3d8)
        n.call(0x86cc70,{r.UC_X86_REG_RDI:actor+0x3b0,r.UC_X86_REG_RSI:n.q(actor+0x3b8),
                        r.UC_X86_REG_RDX:first,r.UC_X86_REG_RCX:end,r.UC_X86_REG_R8:(end-first)//8})
        n.put(actor+0x3d8,'Q',first)
        callbacks.clear()
        mode['suppliedHit']=False
        case={'velocity':velocity,'componentOrder':order,'specDefaults':spec_defaults,
              'initial':snapshot(),'operations':[]}
        if len(case['initial']['components'])!=len(order) or any(
            not row['ownerMatches'] or len(row['actions'])!=1 or
            row['vtableRva']!=(0x235df20 if kind=='trigger' else 0x235c300) or
            row['actions'][0]['vtableRva']!=(0x235c610 if kind=='trigger' else 0x235c648)
            for kind,row in zip(order,case['initial']['components'])):
            raise ValueError('Original ordered component/action ownership differs')
        for operation in ['phase','frame-arrived','frame-not-arrived','phase','stop','frame-arrived','phase']:
            if operation=='phase':n.call(0x864a60,{r.UC_X86_REG_RDI:actor})
            elif operation=='stop':n.call(0x865150,{r.UC_X86_REG_RDI:actor})
            else:
                n.put(motion+0xac,'B',int(operation=='frame-arrived'))
                for component in components():
                    entry=n.q(n.q(component)+0x40)-n.base
                    if entry not in [0x8838e0,0x875940]:
                        raise ValueError('Unexpected original component frame')
                    n.call(entry,{r.UC_X86_REG_RDI:component})
            current=snapshot()
            if any(row['kind']=='omitted-cast-dispatch' for row in current['callbacks']):
                raise ValueError('No-hit lifecycle dispatched a Cast')
            if any(action['executed'] for component in current['components']
                   if component['vtableRva']==0x235df20 for action in component['actions']):
                raise ValueError('No-hit lifecycle executed a Trigger action')
            case['operations'].append({'operation':operation,'state':current})
        # A separate supplied-hit action boundary proves the armed action is not
        # absent. It is not an observation that any replay hit actually occurred.
        triggers=[at for at in components() if n.q(at)-n.base==0x235df20]
        if triggers:
            n.put(actor+0x58,'fff',*velocity)
            mode['suppliedHit']=True
            n.call(0x875c90,{r.UC_X86_REG_RDI:triggers[0],r.UC_X86_REG_RSI:0})
            case['suppliedHitActionBoundary']=snapshot()
            if len([x for x in callbacks if x['kind']=='omitted-cast-dispatch'])!=1:
                raise ValueError('Armed original Cast action was not dispatched once')
        if bytes(n.u.mem_read(actor+0x8000,0x100))!=b'\xa5'*0x100:
            raise ValueError('Original component escaped owned actor')
        cases.append(case)
    # Compare no-hit local actor outputs to independent no-trigger controls.
    local=lambda state:{key:state[key] for key in ['phase','phaseLatch','phaseCount','stopped','positionHex','velocityHex','callbacks']}
    for case in cases:
        baseline=next(row for row in cases if row['velocity']==case['velocity'] and
                      row['componentOrder']==[x for x in case['componentOrder'] if x!='trigger'])
        if local(case['initial'])!=local(baseline['initial']) or any(
            local(a['state'])!=local(b['state']) for a,b in zip(case['operations'],baseline['operations'])):
            raise ValueError('TriggerOnHit changed no-hit local actor lifecycle')
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Trigger native input changed: '+path)
    output=cache/'research/trigger-on-hit-native-v35.json'
    report={'schema':1,'kind':'original-trigger-on-hit-no-hit-local-controls','artifactVersion':35,
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'inputs':inputs,
            'sourceSpell':{'hash':spell['hash'],'name':spell['name'],'behaviors':source_spec},
            'contract':{'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
                        'specConstructorRva':0x86f770,'specVtableRva':0x235b5f0,
                        'factoryRva':0x868730,'runtimeVtableRva':0x235df20,
                        'phaseRva':0x8838b0,'frameRva':0x8838e0,'hitRva':0x875c90,
                        'castActionFactoryRva':0x8692d0,'castActionVtableRva':0x235c610,
                        'castDispatcherRva':0x8b5740,'castOnHitFactoryRva':0x869b90},
            'originalBlocks':list(n.blocks.values()),'cases':cases,
            'scope':{'originalSpecActionAndComponentFactories':True,'orderedOriginalPhaseFrameAndStop':True,
                     'noHitLocalIsolationCompared':True,'suppliedHitActionBoundaryCompared':True,
                     'actualReplayCollisionObserved':False,'downstreamCastDispatcherExecuted':False,
                     'nativeMatchMotionAccepted':False,'activeFamilyAdmissionChanged':False}}
    output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'operations':sum(len(x['operations']) for x in cases),
                      'suppliedHitControls':sum('suppliedHitActionBoundary' in x for x in cases),
                      'originalBlocks':len(n.blocks),'noHitLocalIsolation':True}))


if __name__=='__main__':main()
