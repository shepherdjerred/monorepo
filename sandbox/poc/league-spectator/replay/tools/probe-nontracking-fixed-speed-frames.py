"""Original supplied-input FixedSpeed/FollowTerrain/FaceTarget full frames.

Composes original FixedSpeed constructor/initializer/packet code with named-start
and projected-endpoint fixture outputs. The three supplied ranges are controls,
never claims about actual slot51 state. No active presentation is changed.
"""
import argparse
import json
from pathlib import Path
import struct
import sys
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache,inputs=args.cache.resolve(),{}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Packet bridge input changed')
        inputs[str(path)]=digest;return data
    def read(path):return json.loads(raw(path))
    starts=read(cache/'research/named-bone-caster-start-native-v35.json')
    endpoints=read(cache/'research/projected-missile-endpoint-native-v35.json')
    for source in [starts,endpoints]:
        for path,digest in source['inputs'].items():
            if sha(raw(path))!=digest:raise ValueError('Original provider control source changed: '+path)
    scene=read(cache/'public/latest-scene/manifest.json')
    catalog=read(cache/'public/latest-scene'/scene['champions']['akshan/20']['spellCatalog'])
    component=catalog['spells']['43261541']['data']['mMissileSpec']['movementComponent']
    motion=read(cache/'public/decoder-16.21-macos/missile-motion.json')
    packets=read(cache/'research/projectile-combat-native.json')
    objects={row['payloadSha256']:row for row in packets['observations'].values() if row['opcode']==28 and row['status']=='complete'}
    n=NativeSpawn(cache/'public/decoder-16.21-macos',args.client)
    if packets['decoderImageSha256']!=n.profile['decoderImageSha256'] or packets['constructorImageSha256']!=n.profile['constructorImageSha256']:
        raise ValueError('Original decoded packet image differs')
    for name in ['profile.json','image.bin','vfx-birth.json','vfx-values.json']:raw(cache/'public/decoder-16.21-macos'/name)
    raw(args.client)
    manager,view=n.allocate(0x20),n.allocate(0x20)
    n.put(manager+0x10,'Q',view);n.put(n.base+0x246d000,'Q',manager)
    clock={'time':0.,'delta':1/60}
    def supplied_time(engine,address,size,user):
        if engine.reg_read(r.UC_X86_REG_RDI)!=view:raise ValueError('Constructor clock escaped supplied view')
        value=clock['time'] if address==n.base+0x15ed8e0 else clock['delta']
        if address==n.base+0x15ed930 and n.q(engine.reg_read(r.UC_X86_REG_RSP))-n.base!=0x88b90a:raise ValueError('Unexpected FixedSpeed frame delta caller')
        engine.reg_write(r.UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',value),'little'));n.ret()
    for entry in [0x15ed8e0,0x15ed930]:n.u.hook_add(unicorn.UC_HOOK_CODE,supplied_time,begin=n.base+entry,end=n.base+entry)
    def bounds(engine,address,size,user):n.ret()
    n.u.hook_add(unicorn.UC_HOOK_CODE,bounds,begin=n.base+0x865060,end=n.base+0x865060)
    controllers=read(cache/'public/decoder-16.21-macos/missile-controllers.json')
    heights=raw(cache/'public/latest-scene/heights.bin')
    gm,grid,ha=n.allocate(0x20),n.allocate(0x200),n.allocate(len(heights))
    n.put(gm+8,'Q',grid);n.put(n.base+0x246c948,'Q',gm)
    n.put(grid+0xbc,'fff',*scene['map']['min']);n.put(grid+0xc8,'fff',*scene['map']['max'])
    n.put(grid+0xf8,'Q',ha);dims=scene['map']['heightGrid']
    n.put(grid+0x100,'IIff',dims['x'],dims['z'],*dims['step']);n.u.mem_write(ha,heights)
    f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
    bits=lambda at,count:list(struct.unpack('<'+'I'*count,n.u.mem_read(at,count*4)))
    cases=[]
    for source in starts['cases']:
        if source['label']!='actual-causal-pose':continue
        record=source['record']
        if record['sequence'] not in [3676,4313] or record['elapsedSeconds']!=0 or record['cast']['targetCount']!=0:
            raise ValueError('Bounded actual zero-age source records required')
        for supplied_range,schedule in [(v,k) for v in [250,750,1250] for k in ['creation-ticks','replay-uniform','supplied-interior-split']]:
            endpoint=next(row for row in endpoints['projectionCases'] if row['sequence']==record['sequence'] and
                          row['suppliedRange']==supplied_range and row['mUseGroundHeightAtTarget'] is False and
                          row['targetPosition']==record['cast']['targetPosition'])
            actor,controller,spec,target,descriptor,packet=[n.allocate(size) for size in [0x500,0x200,0x100,12,0x40,0x500]]
            n.put(actor,'Q',n.base+0x235ae00)
            n.call(0x8639c2,{r.UC_X86_REG_RBX:actor},0x863a3b)
            n.put(actor+0x15c,'fff',*source['position'])
            n.put(actor+0x358,'Q',descriptor)
            n.put(descriptor,'fffff',*source['position'],source['planeHeightOffset'],source['attachmentHeightOffset'])
            n.call(0x88602a,{r.UC_X86_REG_RDI:spec},0x88606b)
            n.call(0x88607b,{r.UC_X86_REG_RBX:spec},0x88609c)
            settings={key:component.get(key,field['default']) for key,field in motion['fields'].items()}
            if settings['mTracksTarget'] or settings['mUseHeightOffsetAtEnd'] or settings['mStartDelay']!=0:
                raise ValueError('Exact original nontracking no-end-height source required')
            for key,field in motion['fields'].items():n.put(spec+field['offset'],'?' if field['type']=='bool' else 'f',settings[key])
            n.u.mem_write(target,bytes.fromhex(endpoint['positionHex']))
            clock['time']=record['time']
            n.call(0x88a020,{r.UC_X86_REG_RDI:controller,r.UC_X86_REG_RSI:actor,r.UC_X86_REG_EDX:0,r.UC_X86_REG_RCX:target,r.UC_X86_REG_R8:spec})
            n.put(controller,'Q',n.base+0x235d018)
            n.put(controller+0xa0,'f',settings['mSpeed'])
            n.call(0x87f480,{r.UC_X86_REG_RDI:controller})
            def snapshot():
                return {'positionHex':bytes(n.u.mem_read(actor+0x15c,12)).hex(),
                        'velocityHex':bytes(n.u.mem_read(actor+0x58,12)).hex(),
                        'initialPositionHex':bytes(n.u.mem_read(controller+0x70,12)).hex(),
                        'targetPositionHex':bytes(n.u.mem_read(controller+0x7c,12)).hex(),
                        'cachedVelocityHex':bytes(n.u.mem_read(controller+0x88,12)).hex(),
                        'speedHex':bytes(n.u.mem_read(controller+0xa0,4)).hex(),
                        'holderPresent':bool(n.q(controller+0x28))}
            before=snapshot()
            n.u.mem_write(packet,bytes.fromhex(objects[record['payloadSha256']]['object']))
            n.call(0x88ae40,{r.UC_X86_REG_RDI:controller,r.UC_X86_REG_RSI:packet})
            after=snapshot()
            if before['targetPositionHex']!=after['targetPositionHex'] or before['velocityHex']!=after['velocityHex'] or after['holderPresent']:
                raise ValueError('Packet bridge unexpectedly changed retained endpoint/velocity/holder')
            solver,update=n.allocate(0x80),n.allocate(0x40)
            height_spec=catalog['spells']['43261541']['data']['mMissileSpec']['heightSolver']
            meta=controllers['heightSolvers'][height_spec['__type']]
            n.put(solver,'Q',n.base+meta['runtimeVtableRva'])
            for key,field in meta['fields'].items():n.put(solver+field['offset'],'f',height_spec.get(key,field['default']))
            n.put(controller+0x30,'Q',solver)
            n.call(0x874950,{r.UC_X86_REG_RSI:controller})
            frames=[];elapsed=0.;tick=f(1/60)
            if schedule=='creation-ticks':times=[f(record['time']+tick*i) for i in range(1,200)]
            else:
                import math
                first=math.floor(record['time']/tick)+1
                times=[f(tick*i) for i in range(first,first+200)]
                if schedule=='supplied-interior-split':times=sorted(set(times+[f(record['time']+0.175)]))
            previous=f(record['time'])
            for time in times:
                clock['time']=time;clock['delta']=f(time-previous);previous=time
                n.call(0x88d350,{r.UC_X86_REG_RDI:update,r.UC_X86_REG_RSI:controller})
                n.call(0x88b760,{r.UC_X86_REG_RDI:controller,r.UC_X86_REG_RSI:update})
                sample={'time':time,'delta':clock['delta'],'globalDelta':tick,'updateHex':bytes(n.u.mem_read(update,32)).hex(),
                        'arrived':bool(bytes(n.u.mem_read(update+0x1c,1))[0]),'canPassOnce':bool(bytes(n.u.mem_read(actor+0x3ca,1))[0]),
                        'historySize':n.q(controller+0x68)}
                history=bytearray();history_start=n.q(controller+0x60);history_map=n.q(controller+0x48)
                for offset in range(sample['historySize']):
                    block,lane=divmod(history_start+offset,341)
                    history+=n.u.mem_read(n.q(history_map+block*8)+lane*12,12)
                sample['historySha256']=sha(history)
                n.call(0x88a590,{r.UC_X86_REG_RDI:controller,r.UC_X86_REG_RSI:update})
                sample.update(positionHex=bytes(n.u.mem_read(actor+0x15c,12)).hex(),velocityHex=bytes(n.u.mem_read(actor+0x58,12)).hex())
                frames.append(sample)
                if sample['arrived']:break
            else:raise ValueError('Bounded supplied-range flight did not arrive')
            cases.append({'schedule':schedule,'frames':frames,'heightSpec':height_spec,'sequence':record['sequence'],'sourceEventId':source['sourceEventId'],
                          'suppliedRange':supplied_range,'record':record,'start':source,
                          'suppliedOriginalEndpoint':endpoint,'settings':settings,'beforePacket':before,'afterPacket':after})
    for sequence in [3676,4313]:
        group=[row for row in cases if row['sequence']==sequence]
        if len(group)!=9 or len({row['afterPacket']['targetPositionHex'] for row in group})!=3 or len({row['afterPacket']['velocityHex'] for row in group})<2:
            raise ValueError('Range-dependent endpoint/velocity sensitivity not established')
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Packet bridge source drifted: '+path)
    output=cache/'research/nontracking-fixed-speed-frames-native-v35.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-supplied-input-nontracking-fixed-speed-complete-frames','artifactVersion':35,
        'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'inputs':inputs,'cases':cases,'blocks':list(n.blocks.values()),
        'scope':{'originalControllerConstructorInitializerAndPacket':True,'sourceAndEndpointFromSeparateOriginalControls':True,
                 'actualPacketsUnmodified':True,'suppliedRangesAreDiagnosticControls':True,'packetErasesRangeDependence':False,
                 'actualConsumedRangeRecovered':False,'nativeMatchMotionEstablished':False,'activeFamilyAdmissionChanged':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':len(cases),'frames':sum(len(c['frames']) for c in cases),'packets':2,'endpointAndVelocityRemainRangeDependent':True,'blocks':len(n.blocks)}))


if __name__=='__main__':main()
