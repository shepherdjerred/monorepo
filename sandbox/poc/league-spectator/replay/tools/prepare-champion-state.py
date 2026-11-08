"""Original champion replication schema and consumer observations.

Registration runs over an owned zero entity with its original vtable. Optional
replication-observer configuration is explicitly cached false. This does not
execute the complete entity constructor, world registry or game loop.
"""
import argparse,json,struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,sha

ENTITY,INPUT,SLOT=0x10080000,0x100a0000,0x100b0000
GROUPS=[1,2,4,8,16,32,64]
KNOWN={
    'currentHealth':(32,0x918,'float',0x1faa60,0x918),
    'maxHealth':(32,0x940,'float',0x1fab20,0x918),
    'resourceValue':(32,0x230,'float',0xe49d0,0),
    'resourceMax':(32,0x258,'float',0xe4a00,0),
    'level':(32,0x3fc8,'uint32',0x16b2c0,0),
    'currentGold':(1,0x1ff8,'float',0x1fa250,0x1ff8),
}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    args=p.parse_args();cache=args.cache.resolve();dec=cache/'public/decoder-16.21-macos'
    n=NativeSpawn(dec,args.client)
    n.u.mem_write(ENTITY,bytes(0x10000));n.put(ENTITY,'Q',n.base+0x22f80e0)
    n.u.mem_write(n.base+0x255b7d0,b'\x01\x00\x00\x00')
    n.call(0x13e690,{r.UC_X86_REG_RDI:ENTITY})
    replicator=n.q(ENTITY+0x2400);schemas={}
    for index,group in enumerate(GROUPS):
        address=n.q(replicator+8+index*8);raw=bytes(n.u.mem_read(address,0x198));count=struct.unpack_from('<I',raw)[0]
        if count>32:raise ValueError('Native champion schema exceeds group mask')
        mask=n.q(address+8)
        schemas[str(group)]={'descriptorRva':address-n.base,'count':count,'floatMask':mask,
            'offsets':list(struct.unpack_from('<'+'I'*count,raw,0x10)),
            'symbols':[f'{v:016x}'for v in struct.unpack_from('<'+'Q'*count,raw,0x90)],'descriptorHex':raw.hex()}
    fields={}
    for name,(group,offset,kind,getter,base_offset)in KNOWN.items():
        schema=schemas[str(group)]
        if schema['offsets'].count(offset)!=1:raise ValueError('Known field absent/duplicated in native registration')
        index=schema['offsets'].index(offset);actual='float'if(schema['floatMask']>>index)&1 else'uint32'
        if actual!=kind:raise ValueError('Known consumer field type differs')
        fields[name]={'group':group,'index':index,'offset':offset,'type':kind,'consumerRva':getter,'consumerBaseOffset':base_offset}
    inputs={}
    def read(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return json.loads(b)
    core_path=cache/'public/latest-replication/package.json';core=read(core_path)
    native=read(cache/'research/latest-replication-native.json');records=[];native_groups=0;native_bytes=0;consumer_checks=0
    for packet in native['records']:
        for record in packet['records']:
            if record['entityId']not in native['heroIds']:continue
            n.u.mem_write(ENTITY,bytes(0x10000));n.put(ENTITY,'Q',n.base+0x22f80e0)
            observed=[];updated=set()
            for g in record['groups']:
                schema=schemas[str(g['group'])];mask=g['mask'];data=bytes.fromhex(g['dataHex']);count=schema['count']
                if count<32 and mask>>count:raise ValueError('Packet references unregistered champion field')
                n.put(SLOT,'Q',n.base+schema['descriptorRva']);n.u.mem_write(INPUT,data+bytes(16))
                n.call(0x1db4e0,{r.UC_X86_REG_RDI:SLOT,r.UC_X86_REG_RSI:ENTITY,r.UC_X86_REG_RDX:mask,r.UC_X86_REG_RCX:INPUT})
                consumed=n.u.reg_read(r.UC_X86_REG_RAX)
                if consumed!=len(data):raise ValueError('Native full champion group did not consume exact body')
                values={str(i):struct.unpack('<I',n.u.mem_read(ENTITY+at,4))[0]for i,at in enumerate(schema['offsets'])if mask&(1<<i)}
                observed.append({'group':g['group'],'mask':mask,'consumed':consumed,'fieldBits':values});native_groups+=1;native_bytes+=consumed
                updated.update(name for name,f in fields.items()if f['group']==g['group']and mask&(1<<f['index']))
            consumers={}
            for name in sorted(updated):
                f=fields[name]
                n.call(f['consumerRva'],{r.UC_X86_REG_RDI:ENTITY+f['consumerBaseOffset'],r.UC_X86_REG_RSI:0})
                bits=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff if f['type']=='float'else n.u.reg_read(r.UC_X86_REG_RAX)&0xffffffff
                stored=struct.unpack('<I',n.u.mem_read(ENTITY+f['offset'],4))[0]
                if bits!=stored:raise ValueError(f'Native field consumer differs: {name}')
                consumers[name]=bits;consumer_checks+=1
            records.append({'packetKey':packet['key'],'time':packet['time'],'stream':packet['stream'],
                'recordIndex':packet['records'].index(record),'entityId':record['entityId'],'groups':observed,'consumerBits':consumers})
    wire_probes=[]
    def probe(mask,data):
        schema=schemas['32'];n.u.mem_write(ENTITY,bytes(0x10000));n.u.mem_write(INPUT,data+bytes(16))
        n.put(SLOT,'Q',n.base+schema['descriptorRva'])
        n.call(0x1db4e0,{r.UC_X86_REG_RDI:SLOT,r.UC_X86_REG_RSI:ENTITY,r.UC_X86_REG_RDX:mask,r.UC_X86_REG_RCX:INPUT})
        consumed=n.u.reg_read(r.UC_X86_REG_RAX)
        if consumed!=len(data):raise ValueError('Diagnostic wire length differs')
        wire_probes.append({'group':32,'mask':mask,'dataHex':data.hex(),'consumed':consumed,
            'fieldBits':{str(i):struct.unpack('<I',n.u.mem_read(ENTITY+at,4))[0]
                for i,at in enumerate(schema['offsets'])if mask&(1<<i)}})
    def varuint(v):
        out=bytearray()
        while v>127:out.append((v&127)|128);v>>=7
        out.append(v);return bytes(out)
    for value in [0,1,127,128,255,16383,16384,2097151,2097152,268435455,268435456,0xffffffff]:
        for prefix in [b'',struct.pack('<f',5.0)]:probe((1<<28)|(1 if prefix else 0),prefix+varuint(value))
    for length in [6,7,8]:
        probe(1<<28,bytes([0xff])*(length-1)+b'\x00')
        probe(1<<28,bytes([0x80])*(length-1)+b'\x00')
    for bits in [0,1,0x80000000,0x7f800000,0xff800000,0x7fc00001,*[0xbbccdd00|i for i in range(256)]]:
        data=struct.pack('<I',bits)
        if data[0]in [254,255]:data=b'\xfe'+data
        probe(4,data)
    probe(4,b'\xff');probe(4,b'\xfe\x00\x00\x00\x00')
    # Matching property registration binds these fields to the original slot
    # constructor. Defaults are observed, not borrowed from a different patch.
    n.call(0x2cd930,{})
    resource=n.u.reg_read(r.UC_X86_REG_RAX);resource_raw=bytes(n.u.mem_read(resource,0xe8))
    defaults={'arType':resource_raw[0],'arIsShown':bool(resource_raw[0x8c]),
        'arDisplayAsPips':bool(resource_raw[0x8b]),'arIncrements':struct.unpack_from('<I',resource_raw,0x80)[0],
        'arMaxSegments':struct.unpack_from('<I',resource_raw,0x84)[0]}
    if defaults!={'arType':2,'arIsShown':True,'arDisplayAsPips':False,'arIncrements':0,'arMaxSegments':0}:
        raise ValueError('Original primary resource defaults changed')
    ranges=[(0x13e690,0x140450),(0x1db4e0,0x1db750),(0x1dc360,0x1dc400),(0x1e9fe0,0x1ea010),
        (0x1ea3b0,0x1ea610),(0xe5bb0,0xe6210),(0x6c3e0,0x6ce70),
        (0xe49b0,0xe4a30),(0x1f77b0,0x1f7830),(0x16b2c0,0x16b2e0),(0x1f9aa0,0x1f9ae0),
        (0x140480,0x140490),(0x1fa250,0x1fa290),(0x72f34b,0x72f4ec),(0x730e1d,0x730ea4),
        (0x2b10c0,0x2b1350),(0x2cd930,0x2cda10)]
    for a,b in ranges:
        if n.image[a:b]!=n.source.image[a:b]:raise ValueError('Champion state code differs from pristine build')
    meta={'schema':1,'kind':'native-champion-state-schema','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
        'decoderImageSha256':n.profile['decoderImageSha256'],'sliceSha256':n.profile['sliceSha256'],
        'replicationPackageSha256':inputs[str(core_path.resolve())],'registrationRva':0x13e690,'entityVtableRva':0x22f80e0,
        'optionalObserverConfig':False,'optionalObserverCacheRva':0x255b7d0,'groups':schemas,'fields':fields,
        'primaryResourceDefaults':defaults,
        'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])}for a,b in ranges],
        'scope':{'originalSchemaRegistrationExecuted':True,'nativeConsumersExecuted':True,'completeEntityConstructorExecuted':False,
            'worldRegistryExecuted':False,'shieldSemanticsVerified':False,'referenceAvCompared':False}}
    raw=json.dumps(meta,indent=2).encode();dest=cache/'public/latest-champion-state/package.json';dest.parent.mkdir(exist_ok=True);dest.write_bytes(raw)
    proof={'schema':1,'kind':'native-champion-state-observations','packageSha256':sha(raw),'inputs':inputs,
        'preparerSha256':sha(Path(__file__).read_bytes()),'records':records,'originalBlocks':list(n.blocks.values()),
        'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},
        'resourceDefaultsHex':resource_raw.hex(),
        'wireProbes':wire_probes,
        'counts':{'registeredGroups':len(schemas),'registeredFields':sum(g['count']for g in schemas.values()),
            'championRecords':len(records),'nativeGroups':native_groups,'nativeBytes':native_bytes,'consumerChecks':consumer_checks,
            'wireProbes':len(wire_probes)}}
    (cache/'research/champion-state-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'fields':fields,'counts':proof['counts']}))


if __name__=='__main__':main()
