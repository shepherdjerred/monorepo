"""Recover latest-build replication grammar and native health field storage.

Current/max health are linked to the matching Live Client API consumer. The
remaining four registered float fields retain ABI names pending consumer proof.
No entity registry or League process is executed.
"""
import argparse
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha
from vfx_retirement_native import NativeVfxRetirement

ENTITY, DESC, SLOT, INPUT = 0x10080000, 0x10090000, 0x10091000, 0x10092000
FIELD_BLOCKS = [(0xe5bd0, 0xe5be9), (0xe5c61, 0xe5c7d), (0xe5cf1, 0xe5d0d),
    (0xe5d81, 0xe5d9d), (0xe5e11, 0xe5e2d), (0xe5ea1, 0xe5ebd)]
OFFSETS = [0x918, 0x940, 0x968, 0x9b8, 0x9e0, 0xa08]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']: p.add_argument(name, type=Path)
    args = p.parse_args(); cache = args.cache.resolve(); decoder = cache / 'public/decoder-16.21-macos'
    n = NativeSpawn(decoder, args.client); fragment = lambda a,b,regs: NativeVfxRetirement.fragment(n,a,b,regs)
    n.call(0x1db640, {r.UC_X86_REG_RDI: DESC, r.UC_X86_REG_RSI: 0})
    for index, (start, end) in enumerate(FIELD_BLOCKS):
        fragment(start,end,{r.UC_X86_REG_RDI: ENTITY, r.UC_X86_REG_RSI: ENTITY,
            r.UC_X86_REG_RBX: ENTITY, r.UC_X86_REG_R14: ENTITY, r.UC_X86_REG_R15: DESC})
        if n.u.reg_read(r.UC_X86_REG_RAX) != index: raise ValueError('Native health prefix registration differs')
    descriptor = bytes(n.u.mem_read(DESC, 0x198))
    if n.q(DESC+8) != 63 or list(struct.unpack_from('<6I', descriptor, 0x10)) != OFFSETS:
        raise ValueError('Health prefix float mask/storage differs')
    n.put(SLOT,'Q',DESC)
    count_table = []
    for value in range(256):
        n.put(ENTITY+0x20,'B',value)
        fragment(0x1db775,0x1db791,{r.UC_X86_REG_RDI: ENTITY})
        count_table.append(n.u.reg_read(r.UC_X86_REG_RAX)&255)
    if len(set(count_table)) != 256: raise ValueError('Replication record count is not a byte permutation')
    inputs = {}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    samples=read(cache/'research/latest-replication-input.json')
    objects=read(cache/'research/latest-replication-objects-native.json')
    report=read(cache/'research/latest-semantics-creations.json');hero_ids={v['entityId'] for v in report['heroes']}
    records=[];total_groups=0;health_groups=0;prefix_bytes=0
    for key, sample in samples['packets'].items():
        o=objects['observations'][key];obj=bytes.fromhex(o['object']);heap=bytes.fromhex(o['heap'])
        if o['status']!='complete' or o['opcode']!=26 or len(obj)!=48:raise ValueError('Incomplete replication packet')
        pointer,count=struct.unpack_from('<QI',obj,16);offset=pointer-0x10200000
        if offset<0 or offset+count>len(heap):raise ValueError('Replication byte vector escaped owned arena')
        data=heap[offset:offset+count];cursor=0;packet_records=[]
        while cursor<len(data):
            if cursor+5>len(data):raise ValueError('Truncated native replication record')
            begin=cursor;groups=data[cursor];entity=struct.unpack_from('<I',data,cursor+1)[0];cursor+=5
            if groups&128:raise ValueError('Unsupported replication group mask')
            row={'entityId':entity,'offset':begin,'groups':[]}
            for group in [1,2,4,8,16,32,64]:
                if not groups&group:continue
                if cursor+5>len(data):raise ValueError('Truncated native replication group')
                mask,length=struct.unpack_from('<IB',data,cursor);cursor+=5
                body=data[cursor:cursor+length]
                if len(body)!=length:raise ValueError('Truncated native group body')
                g={'group':group,'mask':mask,'dataHex':body.hex()};total_groups+=1
                if group==32 and entity in hero_ids:
                    n.u.mem_write(ENTITY, bytes(0x1000));n.u.mem_write(INPUT,body+bytes(16))
                    n.call(0x1db4e0,{r.UC_X86_REG_RDI:SLOT,r.UC_X86_REG_RSI:ENTITY,
                        r.UC_X86_REG_RDX:mask,r.UC_X86_REG_RCX:INPUT})
                    consumed=n.u.reg_read(r.UC_X86_REG_RAX)
                    if consumed>length:raise ValueError('Native health prefix exceeded group length')
                    g['nativePrefixBytes']=consumed
                    g['nativeFieldBits']={str(i):struct.unpack('<I',n.u.mem_read(ENTITY+at,4))[0]
                        for i,at in enumerate(OFFSETS) if mask&(1<<i)}
                    health_groups+=1;prefix_bytes+=consumed
                row['groups'].append(g);cursor+=length
            packet_records.append(row)
        if len(packet_records)!=count_table[obj[32]]:raise ValueError('Native count differs from bounded vector grammar')
        records.append({'key':key,'time':sample['time'],'stream':sample['stream'],'records':packet_records})
    ranges=[(0x1db775,0x1db791),(0x1db4e0,0x1db640),(0x1db640,0x1db6e0),*FIELD_BLOCKS,
        (0x1dbff0,0x1dc166),(0x13f939,0x13f953),(0x1faa60,0x1faaa0),(0x1fab20,0x1fab60),
        (0xd2330,0xd2350),(0xd23e0,0xd2400),(0x72f34b,0x72f3ec)]
    for a,b in ranges:
        if n.image[a:b]!=n.source.image[a:b]:raise ValueError('Replication source differs from matching client')
    package={'schema':1,'kind':'latest-champion-health-replication','build':n.profile['clientVersion'],
        'protocol':n.profile['protocolDigest'],'decoderImageSha256':n.profile['decoderImageSha256'],
        'sliceSha256':n.profile['sliceSha256'],'opcode':26,'objectBytes':48,'vectorOffset':16,'countOffset':32,
        'countDecode':count_table,'groupHeaderBytes':5,'groups':[1,2,4,8,16,32,64],
        'healthGroup':32,'prefixFloatOffsets':OFFSETS,'fieldNames':{'0':'currentHealth','1':'maxHealth'},
        'unassignedFields':[2,3,4,5], 'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])}for a,b in ranges],
        'scope':{'championHealth':True,'shieldSemanticsVerified':False,'npcLayoutVerified':False,
            'liveEntityRegistryExecuted':False,'referenceAvCompared':False}}
    raw=json.dumps(package,indent=2).encode();dest=cache/'public/latest-replication/package.json'
    dest.parent.mkdir(exist_ok=True);dest.write_bytes(raw)
    evidence={'schema':1,'kind':'native-latest-replication-health','packageSha256':sha(raw),
        'preparerSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,'heroIds':sorted(hero_ids),
        'descriptorHex':descriptor.hex(),'records':records,'originalBlocks':list(n.blocks.values()),
        'counts':{'packets':len(records),'records':sum(len(x['records'])for x in records),
            'groups':total_groups,'championHealthGroups':health_groups,'nativePrefixBytes':prefix_bytes}}
    (cache/'research/latest-replication-native.json').write_text(json.dumps(evidence,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'counts':evidence['counts']}))


if __name__=='__main__':main()
