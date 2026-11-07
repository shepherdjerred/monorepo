"""Exact-build replicated combat stats and original cache/API projections.

Static preparation reads no match. Native registration, raw-stat defaults, a
bounded cache initializer, raw-to-cache projection, and named API scalar paths
execute on owned storage. Optional attribute observers, full entity/frame logic
and the cache initializer's unrelated game-configuration tail do not execute.
--observe separately adds sequential native observations over recorded groups.
"""
import argparse,json,math,random,struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,sha

E,INPUT,SLOT,OUT=0x10080000,0x100a0000,0x100b0000,0x100c0000
DIRECT={
 'resourceRegenRate':(0x72f4e7,0x72f4f0,0xdb8,0x72f4f5),
 'healthRegenRate':(0x72f537,0x72f540,0xf98,0x72f545),
 'moveSpeed':(0x72f587,0x72f590,0xf9c,0x72f595),
 'attackRange':(0x72f636,0x72f63f,0xfa4,0x72f644),
 'armorPenetrationFlat':(0x72f78d,0x72f796,0xe58,0x72f79b),
 'physicalLethality':(0x72f7df,0x72f7e8,0xe78,0x72f7ed),
 'armorPenetrationPercent':(0x72f831,0x72f83a,0xe60,0x72f83f),
 'bonusArmorPenetrationPercent':(0x72f883,0x72f88c,0xe68,0x72f891),
 'magicPenetrationFlat':(0x72f8d5,0x72f8de,0xe5c,0x72f8e3),
 'magicLethality':(0x72f927,0x72f930,0xe7c,0x72f935),
 'magicPenetrationPercent':(0x72f979,0x72f982,0xe64,0x72f987),
 'bonusMagicPenetrationPercent':(0x72f9cb,0x72f9d4,0xe6c,0x72f9d9),
 'lifeSteal':(0x72fa1d,0x72fa26,0xf40,0x72fa2b),
 'spellVamp':(0x72fac5,0x72face,0xf48,0x72fad3),
 'omnivamp':(0x72fb15,0x72fb1e,0xf4c,0x72fb23),
 'physicalVamp':(0x72fb65,0x72fb6e,0xf50,0x72fb73),
 'critDamage':(0x72fc08,0x72fc11,0xf70,0x72fc16),
 'healShieldPower':(0x72fc60,0x72fc69,0xf38,0x72fc6e),
}
TOTAL={
 'armor':(0x1fd25d,0x1fd26e,0xf84,0x72f6f1,1,0x18),
 'magicResist':(0x1fd2ed,0x1fd2fe,0xf8c,0x72f749,6,0x20),
 'critChance':(0x1fd718,0x1fd729,0xf80,0x72fa83,8,0x88),
}
FORMULAS={
 'attackDamage':{'kind':'attack-damage','cacheOffsets':[0x1ac,0x1b0,0x24c,0x1a8,0x1b4],'apiKeyRva':0x72f5f2,'statEnum':2,'virtualOffset':0x28},
 'abilityPower':{'kind':'ability-power','cacheOffsets':[0x1b8,0x1bc,0x25c],'apiKeyRva':0x72f699,'statEnum':0,'virtualOffset':0x38},
 'abilityHaste':{'kind':'ability-haste','cacheOffsets':[0x60,0x64],'apiKeyRva':0x72fbc6,'consumerRva':0x68840},
}

def f32(x):return struct.unpack('<f',struct.pack('<f',x))[0]
def bits(x):return struct.unpack('<I',struct.pack('<f',x))[0]
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client']:p.add_argument(key,type=Path)
    p.add_argument('--observe',action='store_true');a=p.parse_args();cache=a.cache.resolve();inputs={}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    schema_path=cache/'public/latest-champion-state/package.json';schema=read(schema_path)
    n=NativeSpawn(cache/'public/decoder-16.21-macos',a.client);groups=[1,2,4,8,16,32,64]
    n.u.mem_write(E,bytes(0x10000));n.put(E,'Q',n.base+0x22f80e0);n.u.mem_write(n.base+0x255b7d0,b'\x01\x00\x00\x00');n.call(0x13e690,{r.UC_X86_REG_RDI:E})
    replicator=n.q(E+0x2400);descriptors={}
    for i,g in enumerate(groups):
        d=n.q(replicator+8+i*8)
        if bytes(n.u.mem_read(d,0x198)).hex()!=schema['groups'][str(g)]['descriptorHex']:raise ValueError('Native combat schema registration differs')
        descriptors[g]=d
    def initialize(entity):
        n.u.mem_write(entity,bytes(0x10000));n.put(entity,'Q',n.base+0x22f80e0)
        n.call(0x68860,{r.UC_X86_REG_RDI:entity+0x1340})
        n.call(0x68660,{r.UC_X86_REG_RDI:entity+0xd10},0x686fe)
        n.call(0x68450,{r.UC_X86_REG_RDI:entity+0xd10},0x68625)
        n.call(0x1fbee0,{r.UC_X86_REG_RDI:entity+0x168,r.UC_X86_REG_RSI:entity})
    def refresh(entity):n.call(0x69150,{r.UC_X86_REG_RDI:entity+0x1340,r.UC_X86_REG_RSI:entity+0xd10})
    initialize(E);sentinels={}
    for g in schema['groups'].values():
        for i,off in enumerate(g['offsets']):
            if 0x1340<=off<0x1e00 and g['floatMask']>>i&1:
                value=1000+len(sentinels);n.put(E+off,'f',value);sentinels[bits(value)]=off
    refresh(E);mapping={}
    for off in range(0,0x318,4):
        value=struct.unpack('<I',n.u.mem_read(E+0xd10+off,4))[0]
        if value in sentinels:mapping[off]={'sourceOffset':sentinels[value],'sentinelBits':value}
    fields={};stats={}
    def binding(off):
        if off not in mapping:raise ValueError('API cache input has no replicated source')
        source=mapping[off]['sourceOffset'];name=f'field_{source:x}';hits=[]
        for group,g in schema['groups'].items():
            for i,v in enumerate(g['offsets']):
                if v==source:hits.append((int(group),i,bool(g['floatMask']>>i&1)))
        if len(hits)!=1 or not hits[0][2]:raise ValueError('Stat input not uniquely registered as float')
        group,index,_=hits[0];fields[name]={'group':group,'index':index,'offset':source,'type':'float','cacheOffset':off};return name
    for name,(start,end,off,key)in DIRECT.items():
        stats[name]={'kind':'scale'if name=='critDamage'else'direct','cacheOffsets':[off-0xd10],'inputFields':[binding(off-0xd10)],
            'apiKeyRva':key,'consumerStartRva':start,'consumerEndRva':end,'factor':100.0 if name=='critDamage'else 1.0}
    for name,(start,end,off,key,enum,virtual)in TOTAL.items():
        stats[name]={'kind':'direct','cacheOffsets':[off-0xd10],'inputFields':[binding(off-0xd10)],'apiKeyRva':key,'consumerStartRva':start,'consumerEndRva':end,'statEnum':enum,'virtualOffset':virtual}
    for name,definition in FORMULAS.items():stats[name]={**definition,'inputFields':[binding(off)for off in definition['cacheOffsets']]}
    import capstone
    md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
    for name,spec in stats.items():
        i=next(md.disasm(n.image[spec['apiKeyRva']:spec['apiKeyRva']+12],spec['apiKeyRva']));target=i.address+i.size+i.operands[1].mem.disp
        if i.mnemonic!='lea'or n.image[target:target+len(name)+1]!=name.encode()+b'\0':raise ValueError('Native API stat name differs')
        spec['apiNameStringRva']=target
    def scalar(entity,name):
        if name in DIRECT:
            start,end,_,_=DIRECT[name];n.call(start,{r.UC_X86_REG_R14:entity},end);value=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
            if name=='critDamage':n.call(0x72fc35,{r.UC_X86_REG_XMM0:value},0x72fc3d);value=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
        elif name in TOTAL:
            start,end,*_=TOTAL[name];n.call(start,{r.UC_X86_REG_R14:n.q(entity+0x190),r.UC_X86_REG_RBX:OUT},end);value=struct.unpack('<I',n.u.mem_read(OUT+0xc,4))[0]
        elif name in ['attackDamage','abilityPower']:
            n.call(0x1fbfa0,{r.UC_X86_REG_RDI:entity+0x168,r.UC_X86_REG_ESI:stats[name]['statEnum'],r.UC_X86_REG_EDX:0});value=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
        else:
            n.call(0x68840,{r.UC_X86_REG_RDI:entity+0xd10});value=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
        return value
    probes=[];rng=random.Random(0x16218298)
    for i in range(96):
        initialize(E);values={}
        for name,f in fields.items():
            v=f32(rng.uniform(-2,25)if i else 0);n.put(E+f['offset'],'f',v);values[name]=v
        refresh(E);probes.append({'input':values,'bits':{name:scalar(E,name)for name in stats}})
    ranges=[(0x13e690,0x140450),(0x1db4e0,0x1db750),(0x68860,0x69140),(0x68660,0x686fe),(0x68450,0x68625),(0x69150,0x6a2f0),
        (0x1fbee0,0x1fbf20),(0x1fbfa0,0x1fc020),(0x1fc5c0,0x1fc88c),(0x1fd220,0x1fd420),(0x1fd6e0,0x1fd750),(0x68760,0x68860),(0x72f1e0,0x72fd40),(0x230bef0,0x230c058)]
    meta={'schema':1,'kind':'native-combat-stat-projections','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
        'decoderImageSha256':n.profile['decoderImageSha256'],'sliceSha256':n.profile['sliceSha256'],'championStatePackageSha256':inputs[str(schema_path)],
        'rawStatBaseOffset':0x1340,'cacheBaseOffset':0xd10,'groups':schema['groups'],'fields':fields,'stats':stats,
        'scope':{'originalRegistrationExecuted':True,'nativeRawToCacheExecuted':True,'namedApiScalarPathsExecuted':True,'completeApiObjectBuilt':False,
            'optionalAttributeObserversExecuted':False,'nativeFrameSchedulingVerified':False,'attackSpeedDecoded':False,'tenacityDecoded':False,'referenceAvCompared':False},
        'sourceBlocks':[{'startRva':x,'endRva':y,'sha256':sha(n.image[x:y])}for x,y in ranges]}
    raw=json.dumps(meta,indent=2).encode();dest=cache/'public/latest-combat-stats';dest.mkdir(exist_ok=True);(dest/'package.json').write_bytes(raw)
    if not a.observe:print(json.dumps({'packageSha256':sha(raw),'stats':len(stats),'inputs':len(fields)}));return
    native=read(cache/'research/latest-replication-native.json');entities={};known={};records=[];group_count=byte_count=scalar_count=0
    for packet in native['records']:
        for index,record in enumerate(packet['records']):
            id=record['entityId']
            if id not in native['heroIds']:continue
            if id not in entities:
                entity=n.allocate(0x10000);initialize(entity);entities[id]=entity;known[id]=set()
            entity=entities[id];observed=[];touched=set()
            for group in record['groups']:
                data=bytes.fromhex(group['dataHex']);n.u.mem_write(INPUT,data+bytes(16));n.put(SLOT,'Q',descriptors[group['group']])
                n.call(0x1db4e0,{r.UC_X86_REG_RDI:SLOT,r.UC_X86_REG_RSI:entity,r.UC_X86_REG_RDX:group['mask'],r.UC_X86_REG_RCX:INPUT});consumed=n.u.reg_read(r.UC_X86_REG_RAX)
                if consumed!=len(data):raise ValueError('Native combat group length differs')
                observed.append({'group':group['group'],'mask':group['mask'],'consumed':consumed});group_count+=1;byte_count+=consumed
                for name,f in fields.items():
                    if f['group']==group['group']and group['mask']&(1<<f['index']):touched.add(name)
            known[id].update(touched);refresh(entity);values={}
            for name,spec in stats.items():
                if all(f in known[id]for f in spec['inputFields']):values[name]=scalar(entity,name);scalar_count+=1
            records.append({'packetKey':packet['key'],'recordIndex':index,'entityId':id,'time':packet['time'],'groups':observed,
                'inputBits':{name:struct.unpack('<I',n.u.mem_read(entity+fields[name]['offset'],4))[0]for name in sorted(touched)},'statBits':values})
    proof={'schema':1,'kind':'native-combat-stat-observations','packageSha256':sha(raw),'preparerSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,
        'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},'originalBlocks':list(n.blocks.values()),
        'mapping':{str(k):v for k,v in mapping.items()},'probes':probes,'records':records,
        'counts':{'stats':len(stats),'inputFields':len(fields),'probes':len(probes),'probeScalars':len(probes)*len(stats),'records':len(records),'groups':group_count,'bytes':byte_count,'scalars':scalar_count},'scope':meta['scope']}
    (cache/'research/combat-stats-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8');print(json.dumps({'packageSha256':sha(raw),'counts':proof['counts']}))
if __name__=='__main__':main()
