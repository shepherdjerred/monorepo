"""Recover original minion/turret replication layouts and observe recorded groups.

Executes registration and field readers, not complete entities or a League process.
The lane-minion route is 1084 -> 6deef9 -> fc8920 -> 186b10 -> 186970 -> 187190.
The building route is 1005 -> 6de28d -> 1b7b40 -> fe5de0 -> fe55c0 -> 1b4cd0.
That factory initializes the turret through 1b4f70 -> 1b50a0.
"""
import argparse,json,struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,sha

ENTITY,HANDLE,CHARACTER,INPUT,SLOT=0x10080000,0x10090000,0x100a0000,0x100b0000,0x100c0000
GROUPS=[1,2,4,8,16,32,64]
CLASSES={'minion':(0x187190,0x23013b8,0),'minion-bit8':(0x187190,0x23013b8,8),'turret':(0x1b50a0,0x2308d38,None)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client']:p.add_argument(key,type=Path)
    p.add_argument('bindings',type=Path,nargs='?')
    args=p.parse_args();cache=args.cache.resolve();dec=cache/'public/decoder-16.21-macos'
    inputs={}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    scene_path=cache/'public/latest-scene/manifest.json';scene=read(scene_path)
    world_path=cache/'public/latest-scene'/scene['world'];world=read(world_path)
    binding_input=read(args.bindings)if args.bindings else {'entities':[]}
    if args.bindings:
        if binding_input['sceneManifestSha256']!=inputs[str(scene_path)] or binding_input['worldCatalogSha256']!=inputs[str(world_path)]:
            raise ValueError('World binding source changed')
        report_path=Path(binding_input['reportPath']);read(report_path)
        if inputs[str(report_path.resolve())]!=binding_input['reportSha256']:raise ValueError('Binding report changed')
        for path,h in binding_input['sources'].items():
            if sha(Path(path).read_bytes())!=h:raise ValueError('Binding source changed')
            inputs[path]=h
    core_path=cache/'public/latest-replication/package.json';read(core_path)
    native=read(cache/'research/latest-replication-native.json')if args.bindings else {'records':[]}
    probe=NativeSpawn(dec,args.client);probe.call(0x2c8280,{})
    character=probe.u.reg_read(r.UC_X86_REG_RAX)
    defaults={'minionFlags':struct.unpack('<I',probe.u.mem_read(character+0x64,4))[0],
              'healthBarHeight':struct.unpack('<f',probe.u.mem_read(character+0xc0,4))[0]}
    if defaults!={'minionFlags':0,'healthBarHeight':100.0}:raise ValueError('Character defaults changed')
    assets={}
    for key,asset in world['assets'].items():
        if 'spellCatalog'not in asset:continue
        catalog=read(cache/'public/latest-scene'/asset['spellCatalog']);records={}
        for path in asset['characterRecords']:
            data=catalog['records'][path]['data']
            if data.get('__type')!='CharacterRecord':raise ValueError('Expected CharacterRecord')
            flags=data.get('minionFlags',defaults['minionFlags']);height=data.get('healthBarHeight',defaults['healthBarHeight'])
            if type(flags)is not int or not 0<=flags<=0xffffffff or type(height)not in[int,float]or not 0<height<10000:
                raise ValueError('Unsupported minion definition')
            records[path]={'minionFlags':flags,'schema':'minion-bit8'if flags&8 else'minion','healthBarHeight':height}
        assets[key]={'catalogSha256':inputs[str((cache/'public/latest-scene'/asset['spellCatalog']).resolve())],
                     'catalogPath':asset['spellCatalog'],'records':records}
    schemas={};engines={}
    for key,(registration,vt,flags)in CLASSES.items():
        n=NativeSpawn(dec,args.client);engines[key]=n
        n.u.mem_write(ENTITY,bytes(0x10000));n.put(ENTITY,'Q',n.base+vt)
        n.put(ENTITY+0x3598,'Q',HANDLE);n.put(HANDLE+0x28,'Q',CHARACTER);n.put(CHARACTER+0x64,'I',flags or 0)
        n.u.mem_write(n.base+0x255b7d0,b'\x01\x00\x00\x00')
        n.call(registration,{r.UC_X86_REG_RDI:ENTITY})
        replicator=n.q(ENTITY+0x2400);groups={};fields={}
        for i,g in enumerate(GROUPS):
            at=n.q(replicator+8+i*8);raw=bytes(n.u.mem_read(at,0x198));count=struct.unpack_from('<I',raw)[0]
            if count>32:raise ValueError('Native field count exceeds mask')
            groups[str(g)]={'descriptorRva':at-n.base,'count':count,'floatMask':n.q(at+8),
                'offsets':list(struct.unpack_from('<'+'I'*count,raw,0x10)),'descriptorHex':raw.hex()}
        for name,offset,getter in [('currentHealth',0x918,0x1faa60),('maxHealth',0x940,0x1fab20)]:
            matches=[(g,s['offsets'].index(offset))for g,s in groups.items()if offset in s['offsets']]
            if len(matches)!=1:raise ValueError('Health field registration ambiguous')
            g,i=matches[0]
            if not groups[g]['floatMask']&(1<<i):raise ValueError('Health field not float')
            fields[name]={'group':int(g),'index':i,'offset':offset,'type':'float','consumerRva':getter,'consumerBaseOffset':0x918}
        schemas[key]={'registrationRva':registration,'entityVtableRva':vt,'selectorBit8':bool(flags)if flags is not None else None,'groups':groups,'fields':fields}
        for field in fields.values():
            n.call(field['consumerRva'],{r.UC_X86_REG_RDI:ENTITY+field['consumerBaseOffset']})
    entities={}
    for e in binding_input['entities']:
        if e['entityId']in entities:raise ValueError('Entity generation reuse unresolved')
        schema='turret'
        if e['entityClass']=='lane-minion':
            choices={assets[e['asset']]['records'][p]['schema']for p in e['characterRecords']}
            if len(choices)!=1:raise ValueError('Runtime minion form selection unresolved')
            schema=next(iter(choices))
        entities[e['entityId']]={**e,'schema':schema}
    records=[];group_count=byte_count=consumer_count=0
    for packet in native['records']:
        for index,record in enumerate(packet['records']):
            entity=entities.get(record['entityId'])
            if not entity:continue
            if packet['time']<entity['creationTime']:raise ValueError('Replication predates admitted world entity')
            schema=schemas[entity['schema']];n=engines[entity['schema']]
            n.u.mem_write(ENTITY,bytes(0x10000));n.put(ENTITY,'Q',n.base+schema['entityVtableRva'])
            observed=[];updated=set()
            for g in record['groups']:
                s=schema['groups'][str(g['group'])];mask=g['mask'];data=bytes.fromhex(g['dataHex'])
                if s['count']<32 and mask>>s['count']:raise ValueError('Unregistered world field')
                n.put(SLOT,'Q',n.base+s['descriptorRva']);n.u.mem_write(INPUT,data+bytes(16))
                n.call(0x1db4e0,{r.UC_X86_REG_RDI:SLOT,r.UC_X86_REG_RSI:ENTITY,r.UC_X86_REG_RDX:mask,r.UC_X86_REG_RCX:INPUT})
                consumed=n.u.reg_read(r.UC_X86_REG_RAX)
                if consumed!=len(data):raise ValueError('World body consumption differs')
                observed.append({'group':g['group'],'mask':mask,'consumed':consumed,
                    'fieldBits':{str(i):struct.unpack('<I',n.u.mem_read(ENTITY+o,4))[0]for i,o in enumerate(s['offsets'])if mask&(1<<i)}})
                group_count+=1;byte_count+=consumed
                updated.update(name for name,f in schema['fields'].items()if f['group']==g['group']and mask&(1<<f['index']))
            consumers={}
            for name in sorted(updated):
                f=schema['fields'][name];n.call(f['consumerRva'],{r.UC_X86_REG_RDI:ENTITY+f['consumerBaseOffset']})
                bits=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
                if bits!=struct.unpack('<I',n.u.mem_read(ENTITY+f['offset'],4))[0]:raise ValueError('Health consumer differs')
                consumers[name]=bits;consumer_count+=1
            records.append({'packetKey':packet['key'],'recordIndex':index,'time':packet['time'],'entityId':record['entityId'],
                            'schema':entity['schema'],'groups':observed,'consumerBits':consumers})
    ranges=[(0x187190,0x188580),(0x186970,0x186b10),(0x186b10,0x187190),(0x18bb30,0x18c020),
            (0xfc8920,0xfc8f30),(0x6deef9,0x6def30),(0x1b50a0,0x1b5720),(0x1b4cd0,0x1b4f60),(0x1b4f70,0x1b50a0),
            (0x1b7b40,0x1b7b80),(0xfe5de0,0xfe6380),(0xfe55c0,0xfe58d0),(0xc6b90,0xc6bb0),
            (0x2af8b5,0x2af8e3),(0x2c8280,0x2c82c0),(0x2b1b40,0x2b3fc0),(0x1db4e0,0x1db750),
            (0xe5bb0,0xe6210),(0x1faa60,0x1faa80),(0x1fab20,0x1fab40)]
    for a,b in ranges:
        if probe.image[a:b]!=probe.source.image[a:b]:raise ValueError('Original world instructions changed')
    meta={'schema':1,'kind':'native-world-state-schema','build':probe.profile['clientVersion'],'protocol':probe.profile['protocolDigest'],
          'decoderImageSha256':probe.profile['decoderImageSha256'],'sliceSha256':probe.profile['sliceSha256'],
          'replicationPackageSha256':inputs[str(core_path)],'sceneManifestSha256':inputs[str(scene_path)],
          'worldCatalogSha256':inputs[str(world_path)],'mapId':scene['map']['id'],'characterDefaults':defaults,
          'characterPropertyOffsets':{'minionFlags':0x64,'healthBarHeight':0xc0},'classes':schemas,'assets':assets,
          'optionalObserverConfig':False,'optionalObserverCacheRva':0x255b7d0,
          'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(probe.image[a:b])}for a,b in ranges],
          'scope':{'laneMinionAndTurretClassesOnly':True,'originalRegistrationExecuted':True,'bit8VariantHasRecordedFixture':False,
                   'nativeHealthConsumersExecuted':True,'completeWorldConstructorExecuted':False,'referenceAvCompared':False}}
    raw=json.dumps(meta,indent=2).encode();dest=cache/'public/latest-world-state/package.json';dest.parent.mkdir(exist_ok=True);dest.write_bytes(raw)
    if args.bindings is None:
        print(json.dumps({'packageSha256':sha(raw),'mode':'static-build-package-only','classes':len(schemas)}));return
    blocks={}
    for n in [probe,*engines.values()]:blocks.update(n.blocks)
    proof={'schema':1,'kind':'native-world-state-observations','packageSha256':sha(raw),'inputs':inputs,'entities':list(entities.values()),
           'preparerSha256':sha(Path(__file__).read_bytes()),'records':records,'originalBlocks':list(blocks.values()),
           'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},
           'counts':{'classes':len(schemas),'entities':len(entities),'worldRecords':len(records),'nativeGroups':group_count,
                     'nativeBytes':byte_count,'consumerChecks':consumer_count}}
    (cache/'research/world-state-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'defaults':defaults,'counts':proof['counts']}))

if __name__=='__main__':main()
