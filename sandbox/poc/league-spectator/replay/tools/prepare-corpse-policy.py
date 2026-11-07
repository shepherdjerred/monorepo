"""Compile native minion corpse retention policy; no League process is launched.

The original character/default constructors, lifetime getter and frame retention
prefix execute on owned storage. The stopwatch is supplied in its paused/elapsed
form. Native live-clock scheduling, animation/fade and registry deletion do not
execute. --observe adds replay-derived presentation-clock observations separately.
"""
import argparse,json,math,struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,ADDRESSES,sha

def f32(x):return struct.unpack('<f',struct.pack('<f',x))[0]
def bits(x):return struct.unpack('<I',struct.pack('<f',x))[0]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    p.add_argument('--observe',action='store_true');a=p.parse_args();cache=a.cache.resolve();n=NativeSpawn(cache/'public/decoder-16.21-macos',a.client)
    inputs={}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    scene_path=cache/'public/latest-scene/manifest.json';world_path=cache/'public/latest-scene/world.json'
    scene=read(scene_path);world=read(world_path)
    if scene['build']!=n.profile['clientVersion']or world['build']!=scene['build']or world['protocol']!=n.profile['protocolDigest']:raise ValueError('Corpse assets/build mismatch')
    entity=n.allocate(0x5000);n.u.mem_write(entity,bytes(0x5000));n.put(entity,'Q',n.base+0x23013b8)
    manager=n.allocate(0x78);n.u.mem_write(manager,bytes(0x78));n.call(0x18ae90,{r.UC_X86_REG_RDI:manager})
    default=struct.unpack('<f',n.u.mem_read(manager+0x28,4))[0]
    n.call(0x2c8280,{});record=n.u.reg_read(r.UC_X86_REG_RAX);record_default=struct.unpack('<f',n.u.mem_read(record+0x474,4))[0]
    wrapper=n.allocate(0x180);n.u.mem_write(wrapper,bytes(0x180));n.put(wrapper+0x28,'Q',record);n.put(wrapper+0x168,'I',7);n.put(entity+0x3598,'Q',wrapper)
    # The scale is initialized from the host clock's measured frequency, not a
    # static constant. Use the original conversion with an explicitly declared
    # caller-owned nanosecond frequency; this is not an observed macOS clock.
    frequency=1000000000
    n.call(0x15eaeb6,{r.UC_X86_REG_RAX:frequency,r.UC_X86_REG_RCX:frequency},0x15eaf0a)
    scale=struct.unpack('<d',n.u.mem_read(n.base+0x256d398,8))[0]
    if scale!=1e-9 or default!=4.0 or record_default!=-1.0:raise ValueError('Native lifetime/stopwatch defaults changed')
    for offset,entry in [(0xf8,0x18d7e0),(0x9d8,0x189040),(0xf78,0x18cc10),(0x2b0,0xcb700),(0xb98,0xd29e0)]:
        if struct.unpack_from('<Q',n.image,0x23013b8+offset)[0]!=n.base+entry:raise ValueError('Minion virtual dispatch changed')
    def duration(value):
        n.put(record+0x474,'f',value);n.call(0x1897d0,{r.UC_X86_REG_RDI:entity});raw=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
        return struct.unpack('<f',struct.pack('<I',raw))[0]
    assets={}
    for key,asset in world['assets'].items():
        if'spellCatalog'not in asset:continue
        path=cache/'public/latest-scene'/asset['spellCatalog'];catalog=read(path);records={}
        for name in asset['characterRecords']:
            data=catalog['records'][name]['data']
            if data['__type']!='CharacterRecord':raise ValueError('Minion record type differs')
            value=data.get('deathTime',record_default)
            if type(value)not in [int,float]or not math.isfinite(value):raise ValueError('Invalid authored corpse lifetime')
            records[name]={'deathTime':f32(value),'duration':duration(value),'durationBits':bits(duration(value))}
        assets[key]={'catalog':asset['spellCatalog'],'catalogSha256':inputs[str(path.resolve())],'records':records}
    probes=[]
    for value in [-2,-1,0,0.125,1,2.5,4,30]:
        expected=default if value<0 else f32(value)
        if duration(value)!=expected:raise ValueError('Native lifetime getter differs')
        probes.append({'deathTime':value,'duration':expected,'durationBits':bits(expected)})
    death_input=n.allocate(88);n.u.mem_write(death_input,bytes(88));death_mode_table=[];death_mode_probes=[]
    def death_mode(value):
        n.put(death_input+0x54,'B',value)
        n.call(0xc63d8,{r.UC_X86_REG_RBX:death_input,r.UC_X86_REG_R14:entity,r.UC_X86_REG_R13:n.base+0x20cae40},0xc641e)
        stored=struct.unpack('<I',n.u.mem_read(entity+0x38,4))[0]
        n.call(0xc3d23,{r.UC_X86_REG_RBX:entity},0xc3d30)
        return not bool(n.u.reg_read(r.UC_X86_REG_EFLAGS)&0x40),stored
    for value in range(256):
        sets_dead,stored=death_mode(value);death_mode_table.append(sets_dead);death_mode_probes.append({'raw':value,'setsDeadFlag':sets_dead,'storedModeWord':stored})
    # Stop before unrelated frame work on the retained path. Expired paths run
    # their original false return and unwind to the owned return address.
    def stop_retained(uc,address,size,user):uc.emu_stop()
    hook=n.u.hook_add(unicorn.UC_HOOK_CODE,stop_retained,begin=n.base+0x18d82a,end=n.base+0x18d82a)
    def retain(dead,ticks,value):
        n.put(record+0x474,'f',value);n.put(entity+0x154,'I',0x9f63d0ef if dead else 0)
        n.put(entity+0x2170+0x11,'B',0);n.put(entity+0x2170+0x28,'q',ticks)
        n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop']);n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack']);n.u.reg_write(r.UC_X86_REG_RDI,entity)
        n.u.emu_start(n.base+0x18d7e0,ADDRESSES['stop'],count=5000000);pc=n.u.reg_read(r.UC_X86_REG_RIP)
        if pc==n.base+0x18d82a:return True
        if pc==ADDRESSES['stop']and n.u.reg_read(r.UC_X86_REG_RAX)==0:return False
        raise ValueError('Unadmitted native frame-retention exit')
    clock_probes=[]
    for value in [-1,0,0.125,1,2.5,4,30]:
        threshold=default if value<0 else f32(value)
        ages=sorted(set([0,1,100000000,4000000000,4000000001,4000000500,30000000000,*[max(0,round((threshold+delta)*1e9))for delta in [-0.001,-0.0000005,-0.000000001,0,0.000000001,0.0000005,0.001]]]))
        for dead in [False,True]:
            for ticks in ages:
                actual=retain(dead,ticks,value);age=f32(ticks*scale);expected=not dead or age<=threshold
                if actual!=expected:raise ValueError('Native corpse-retention predicate differs')
                clock_probes.append({'dead':dead,'ticks':ticks,'deathTime':value,'ageBits':bits(age),'durationBits':bits(threshold),'retained':actual})
    n.u.hook_del(hook)
    retirement_queue=[];list_manager=n.allocate(0x110);rows=n.allocate(24);members=[n.allocate(0x100)for _ in range(3)]
    for index in range(3):
        n.u.mem_write(list_manager,bytes(0x110));n.put(rows,'QQQ',*members);n.put(list_manager+0xf8,'QQQ',rows,rows+index*8,rows+24)
        # A false frame result marks the entity inactive and queues it. This is
        # a retirement queue, not the active-entity list or physical deletion.
        n.call(0x54c3b0,{r.UC_X86_REG_R13:members[index]},0x54c3bb)
        n.call(0x548940,{r.UC_X86_REG_RDI:list_manager,r.UC_X86_REG_RSI:members[index]},0x5489e0)
        # The scene callback at 3ad3d0 remains outside this storage component.
        n.call(0x5489ea,{r.UC_X86_REG_RBX:list_manager,r.UC_X86_REG_R14:members[index]},0x548ae1)
        n.call(0x548940,{r.UC_X86_REG_RDI:list_manager,r.UC_X86_REG_RSI:members[index]})
        end=n.q(list_manager+0x100);remaining=[n.q(rows+i*8)for i in range((end-rows)//8)]
        if remaining!=members[:index+1]:raise ValueError('Native retirement queue append/deduplication differs')
        retirement_queue.append({'index':index,'before':members[:index],'after':remaining,'inactiveWord':struct.unpack('<I',n.u.mem_read(members[index]+0xb0,4))[0]})
    ranges=[(0x2af96d,0x2af984),(0x2c8280,0x2c82c0),(0x2b1b40,0x2b3fc0),(0x18ae90,0x18af00),(0x1897d0,0x1898e0),
        (0x18d7e0,0x18d82a),(0x18d8c2,0x18d8d0),(0x15eef00,0x15eef50),(0x15eaeb6,0x15eaf0a),(0x189108,0x18914c),(0x18cc10,0x18cc7c),(0xcb700,0xcb720),(0x23013b8,0x2302340),
        (0xc63d8,0xc641e),(0xc3d23,0xc3d86),(0x20cae40,0x20caf40),(0x54c2d3,0x54c3d3),(0x548940,0x548ae1),(0x3ad3d0,0x3ad410)]
    meta={'schema':1,'kind':'native-minion-corpse-policy','build':scene['build'],'protocol':world['protocol'],
        'decoderImageSha256':n.profile['decoderImageSha256'],'sliceSha256':n.profile['sliceSha256'],
        'sceneManifestSha256':inputs[str(scene_path)],'worldCatalogSha256':inputs[str(world_path)],
        'characterDeathTimeOffset':0x474,'characterDeathTimeDefault':record_default,'minionDeathTimeDefault':default,'ticksToSeconds':scale,
        'clockFrequencyInput':frequency,'clockPolicy':'caller-owned-paused-stopwatch-in-nanosecond-units; native-host-clock-binding-unverified',
        'unitDeathMode':{'opcode':514,'objectSize':88,'rawOffset':0x54,'setsDeadFlag':death_mode_table},
        'rule':'retire-only-when-dead-and-float32-stopwatch-age-strictly-greater-than-duration',
        'assets':assets,'sourceBlocks':[{'startRva':x,'endRva':y,'sha256':sha(n.image[x:y])}for x,y in ranges],
        'scope':{'nativeDefaultConstructorExecuted':True,'nativeLifetimeGetterExecuted':True,'nativeFrameRetentionPrefixExecuted':True,
            'nativeDeathModePredicateExecuted':True,'nativeRetirementQueueStorageExecuted':True,'nativeLiveClockBindingVerified':False,'registryDeletionExecuted':False,'sceneRetirementCallbackExecuted':False,'deathAnimationTimingVerified':False,'corpseFadeVerified':False,'championCorpsePolicyVerified':False,'referenceAvCompared':False}}
    raw=json.dumps(meta,indent=2).encode();out=cache/'public/latest-corpse';out.mkdir(exist_ok=True);(out/'package.json').write_bytes(raw)
    observations=[];death_modes=[]
    if a.observe:
        samples=read(cache/'research/lifecycle-input.json');native_packets=read(cache/'research/lifecycle-native.json')['observations']
        for key,packet in samples['packets'].items():
            if packet['opcode']!=514:continue
            observation=native_packets[key]
            if observation['status']!='complete':raise ValueError('Unit death packet incomplete')
            body=bytes.fromhex(observation['object'])
            if len(body)!=88:raise ValueError('Unit death object size differs')
            value=body[0x54];sets_dead,stored=death_mode(value)
            death_modes.append({'packetKey':key,'entityId':packet['param'],'time':packet['time'],'chunkId':packet['chunkId'],'blockOffset':packet['blockOffset'],
                'raw':value,'setsDeadFlag':sets_dead,'storedModeWord':stored})
        report=read(cache/'research/latest-semantics-inventory.json');ids={e['entityId']:e for e in report['worldEntities']if e['entityClass']=='lane-minion'}
        hook=n.u.hook_add(unicorn.UC_HOOK_CODE,stop_retained,begin=n.base+0x18d82a,end=n.base+0x18d82a)
        for e in report['lifecycle']:
            if e['entityId']not in ids or e['kind']!='death-candidate':continue
            entity_meta=ids[e['entityId']];record_values=[assets[entity_meta['asset']]['records'][name]for name in entity_meta['characterRecords']]
            if len({row['durationBits']for row in record_values})!=1:raise ValueError('Recorded corpse variant duration unresolved')
            authored=record_values[0]['deathTime']
            # These are explicit caller-owned clock inputs, not reference frames.
            for delta in [0,0.25,1,3.999,4,4.000001,5]:
                t=e['time']+delta
                if t>report['endTime']:continue
                start=math.floor(e['time']*1e9+0.5);end=math.floor(t*1e9+0.5);ticks=end-start
                observations.append({'entityId':e['entityId'],'deathTime':e['time'],'sequence':e['sequence'],'time':t,'ticks':ticks,
                    'authoredDeathTime':authored,'duration':record_values[0]['duration'],
                    'retained':retain(True,ticks,authored),'ageBits':bits(f32(ticks*scale))})
        n.u.hook_del(hook)
    proof={'schema':1,'kind':'native-minion-corpse-observations','packageSha256':sha(raw),'preparerSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,
        'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},
        'originalBlocks':list(n.blocks.values()),'durationProbes':probes,'clockProbes':clock_probes,'observations':observations,'deathModeProbes':death_mode_probes,'deathModes':death_modes,'retirementQueueCases':retirement_queue,
        'counts':{'assets':len(assets),'characterRecords':sum(len(a['records'])for a in assets.values()),'durationProbes':len(probes),'clockProbes':len(clock_probes),'recordedDeathBoundaries':len(observations),
            'deathModeProbes':len(death_mode_probes),'unitDeathModePackets':len(death_modes),'ordinaryDeathModes':sum(d['setsDeadFlag']for d in death_modes),'retirementQueueCases':len(retirement_queue)},
        'scope':meta['scope']}
    (cache/'research/corpse-policy-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8');print(json.dumps({'packageSha256':sha(raw),'counts':proof['counts']}))
if __name__=='__main__':main()
