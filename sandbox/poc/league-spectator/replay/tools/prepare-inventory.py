"""Original inventory field conversions and owned slot mutations, exact build.

Static compilation reads no match. --observe adds recorded packet observations.
Callbacks are projected before UI/spell/resource side effects; complete packet
handlers, world construction and material/item-asset factories do not execute.
"""
import argparse,json,struct,random
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,sha

INPUT,INV,SLOTS,TEMP,DEF=0x10080000,0x10090000,0x100a0000,0x100b0000,0x100c0000
MODES={
 'set':{'size':144,'fields':{'slot':(0x89,1),'itemId':(0x30,4),'count':(0x88,1),'counterB2':(0x38,2),'scalarBits':(0x34,4),'flagB0':(0x50,1)}},
 'snapshot':{'size':168,'fields':{'slot':(0x91,1),'itemId':(0x38,4),'count':(0x90,1),'counterB2':(0x40,2),'scalarBits':(0x3c,4),'flagB0':(0x58,1)}},
 'count':{'size':28,'fields':{'slot':(0x11,1),'count':(0x18,1)}},
 'swap':{'size':20,'fields':{'from':(0x11,1),'to':(0x10,1)}},
 'stack':{'size':20,'fields':{'slot':(0x10,1),'count':(0x11,1),'counterB2':(0x12,2)}},
 'counter':{'size':20,'fields':{'slot':(0x12,1),'counterB2':(0x10,2)}},
}
PACKETS={502:'set',390:'snapshot',437:'snapshot',803:'count',951:'swap',1008:'stack',590:'counter'}

def evaluate(n,mode,data):
    n.u.mem_write(INPUT,data+bytes(512-len(data)))
    if mode in ['set','snapshot']:
        a,b,regs=(0x1705b4,0x17084e,{r.UC_X86_REG_RBX:INPUT,r.UC_X86_REG_R14:INV})if mode=='set'else(0x17427a,0x174518,{r.UC_X86_REG_R14:INPUT,r.UC_X86_REG_R12:INV})
        n.call(a,regs,b)
        return {k:n.u.reg_read(reg)&mask for k,reg,mask in [('slot',r.UC_X86_REG_ESI,255),('itemId',r.UC_X86_REG_EDX,0xffffffff),
            ('count',r.UC_X86_REG_ECX,255),('counterB2',r.UC_X86_REG_R8,65535),('scalarBits',r.UC_X86_REG_XMM0,0xffffffff),('flagB0',r.UC_X86_REG_R9,255)]}
    if mode=='count':
        n.call(0x170e4a,{r.UC_X86_REG_R14:INPUT,r.UC_X86_REG_R15:n.base+0x20cbce0},0x170e99)
        return {'slot':n.u.reg_read(r.UC_X86_REG_R15)&255,'count':n.u.reg_read(r.UC_X86_REG_R12)&255}
    if mode=='swap':
        n.call(0x170f90,{r.UC_X86_REG_RSI:INPUT},0x170fdd)
        return {'from':n.u.reg_read(r.UC_X86_REG_ESI)&255,'to':n.u.reg_read(r.UC_X86_REG_EDX)&255}
    if mode=='stack':
        n.call(0x17105e,{r.UC_X86_REG_RSI:INPUT},0x171080);slot=n.u.reg_read(r.UC_X86_REG_EAX)&255
        n.put(TEMP+0x10,'Q',DEF)
        n.call(0x1710de,{r.UC_X86_REG_R15:INPUT,r.UC_X86_REG_R12:TEMP},0x171172)
        return {'slot':slot,'count':n.u.mem_read(TEMP,1)[0],'counterB2':n.u.reg_read(r.UC_X86_REG_ECX)&65535}
    n.call(0x171fc6,{r.UC_X86_REG_RSI:INPUT},0x171fe8);slot=n.u.reg_read(r.UC_X86_REG_EAX)&255
    n.call(0x172002,{r.UC_X86_REG_RBX:struct.unpack_from('<H',data,16)[0]},0x172052)
    return {'slot':slot,'counterB2':n.u.reg_read(r.UC_X86_REG_EDX)&65535}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client']:p.add_argument(key,type=Path)
    p.add_argument('--observe',action='store_true');args=p.parse_args();cache=args.cache.resolve();dec=cache/'public/decoder-16.21-macos'
    n=NativeSpawn(dec,args.client);schemas={};probes=[];rng=random.Random(0x16218298)
    for mode,config in MODES.items():
        fields={}
        for name,(offset,width)in config['fields'].items():
            columns=[[]for _ in range(width)]
            for v in range(256):
                data=bytearray(config['size']);data[offset:offset+width]=bytes([v])*width
                result=evaluate(n,mode,bytes(data))[name]
                for lane in range(width):columns[lane].append((result>>(lane*8))&255)
            fields[name]={'offset':offset,'bytes':width,'decode':columns,'semantic':'opaque-native-member'if name in ['counterB2','scalarBits','flagB0']else'name-backed-slot-identity'}
            if name!='flagB0'and any(len(set(c))!=256 for c in columns):raise ValueError('Non-bijective inventory field')
        schemas[mode]={'size':config['size'],'fields':fields}
        for _ in range(128):
            data=bytes(rng.randrange(256)for _ in range(config['size']));observed=evaluate(n,mode,data)
            for name,f in fields.items():
                decoded=sum(f['decode'][i][data[f['offset']+i]]<<(i*8)for i in range(f['bytes']))
                if decoded!=observed[name]:raise ValueError('Inventory fields are not separable byte conversions')
            probes.append({'mode':mode,'dataHex':data.hex(),'values':observed})
    ranges=[(0x16e6a0,0x170110),(0x170190,0x170ce0),(0x170ce0,0x171230),(0x171fc0,0x172070),(0x173fb0,0x1752e0),
        (0x149470,0x149720),(0x173270,0x173280),(0x1777b0,0x1777c0),(0x5a5f90,0x5a6000),(0x5a6ab0,0x5a6af0),
        (0x5ae000,0x5ae0d2),(0x5aec70,0x5aec80),(0x72d5d6,0x72d610),(0x72d6ca,0x72d713),(0x141320,0x141350)]
    for a,b in ranges:
        if n.image[a:b]!=n.source.image[a:b]:raise ValueError('Original inventory code differs')
    profile=n.profile
    meta={'schema':1,'kind':'native-inventory-fields','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
        'decoderImageSha256':profile['decoderImageSha256'],'sliceSha256':profile['sliceSha256'],'slots':39,'snapshotClearedSlots':10,
        'packets':{str(op):{'mode':mode,'objectSize':profile['packets'][str(op)]['objectSize']}for op,mode in PACKETS.items()},
        'modes':schemas,'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])}for a,b in ranges],
        'scope':{'fieldConversionsNativeExecuted':True,'completePacketConsumersExecuted':False,'itemIdAndStackCountSemanticsVerified':True,
            'counterB2SemanticsVerified':False,'scalarB4SemanticsVerified':False,'itemAssetFactoriesExecuted':False,'referenceAvCompared':False}}
    raw=json.dumps(meta,indent=2).encode();dest=cache/'public/latest-inventory/package.json';dest.parent.mkdir(exist_ok=True);dest.write_bytes(raw)
    if not args.observe:print(json.dumps({'packageSha256':sha(raw),'mode':'static-build-package-only'}));return
    inputs={}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    source=read(cache/'research/inventory-input.json');objects=read(cache/'research/inventory-objects-native.json')['observations']
    facts=[]
    for key,packet in source['packets'].items():
        op=packet['opcode']
        if op not in PACKETS:continue
        observation=objects[key]
        if observation['status']!='complete':raise ValueError('Incomplete native inventory packet')
        body=bytes.fromhex(observation['object']);mode=PACKETS[op];entries=[]
        if mode=='snapshot':
            pointer,count=struct.unpack_from('<QI',body,32);heap=bytes.fromhex(observation['heap']);offset=pointer-0x10200000
            if count>39 or offset<0 or offset+count*168>len(heap):raise ValueError('Native inventory vector outside arena')
            entries=[heap[offset+i*168:offset+(i+1)*168]for i in range(count)]
        else:entries=[body[:MODES[mode]['size']]]
        values=[evaluate(n,mode,e)for e in entries]
        if any(any(not 0<=v[k]<39 for k in ['slot']if k in v)or any(not 0<=v[k]<39 for k in ['from','to']if k in v)for v in values):raise ValueError('Observed inventory slot outside native array')
        facts.append({'packetKey':key,'opcode':op,'entityId':packet['param'],'time':packet['time'],'stream':packet['stream'],
            'mode':mode,'entries':[{'dataHex':e.hex(),'values':v}for e,v in zip(entries,values)]})
    proof={'schema':1,'kind':'native-inventory-observations','packageSha256':sha(raw),'inputs':inputs,'records':facts,'wireProbes':probes,
        'preparerSha256':sha(Path(__file__).read_bytes()),'originalBlocks':list(n.blocks.values()),
        'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},
        'counts':{'packets':len(facts),'entries':sum(len(f['entries'])for f in facts),'wireProbes':len(probes)}}
    (cache/'research/inventory-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'counts':proof['counts']}))

if __name__=='__main__':main()
