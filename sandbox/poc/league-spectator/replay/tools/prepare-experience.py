"""Bind champion accumulated experience to original replication and level curves.

The champion's experience/level component is returned by 140480. Its float at
+0 is read by 1f9a60, while +28 holds the independently verified level. The
fractional-level and within-level readers subtract cumulative thresholds from
ExperienceCurveData.mExperienceRequiredPerLevel. Mode/curve selection remains
unresolved, so this package admits accumulated XP only, not a progress gauge.
"""
import argparse,json,struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn,sha

ENTITY,INPUT,SLOT=0x10080000,0x100a0000,0x100b0000

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['cache','client']:p.add_argument(key,type=Path)
    p.add_argument('--observe',action='store_true',help='Additionally compare recorded fixture groups')
    args=p.parse_args();cache=args.cache.resolve();dec=cache/'public/decoder-16.21-macos';inputs={}
    def read(path):
        raw=path.read_bytes();inputs[str(path.resolve())]=sha(raw);return json.loads(raw)
    schema_path=cache/'public/latest-champion-state/package.json';champion=read(schema_path)
    native=read(cache/'research/latest-replication-native.json')if args.observe else {'records':[],'heroIds':[]};n=NativeSpawn(dec,args.client)
    schema=champion['groups']['32'];offset=0x3fa0
    if schema['offsets'].count(offset)!=1:raise ValueError('Experience storage not uniquely registered')
    index=schema['offsets'].index(offset)
    if not(schema['floatMask']>>index)&1:raise ValueError('Experience is not a native float')
    # Execute the original registration independently, and require its descriptor
    # bytes to agree with the existing complete champion package.
    n.u.mem_write(ENTITY,bytes(0x10000));n.put(ENTITY,'Q',n.base+0x22f80e0)
    n.u.mem_write(n.base+0x255b7d0,b'\x01\x00\x00\x00')
    n.call(0x13e690,{r.UC_X86_REG_RDI:ENTITY})
    replicator=n.q(ENTITY+0x2400);descriptor=n.q(replicator+8+5*8)
    if bytes(n.u.mem_read(descriptor,0x198)).hex()!=schema['descriptorHex']:raise ValueError('Original experience registration differs')
    n.call(0x140480,{r.UC_X86_REG_RDI:ENTITY})
    n.call(0x1f9a60,{r.UC_X86_REG_RDI:n.u.reg_read(r.UC_X86_REG_RAX)})
    binding={'group':32,'index':index,'offset':offset,'type':'float','consumerRva':0x1f9a60,'consumerBaseOffset':offset}
    observations=[];byte_count=0
    for packet in native['records']:
        for record_index,record in enumerate(packet['records']):
            if record['entityId']not in native['heroIds']:continue
            for group in record['groups']:
                if group['group']!=32 or not(group['mask']&(1<<index)):continue
                n.u.mem_write(ENTITY,bytes(0x10000));n.put(ENTITY,'Q',n.base+0x22f80e0)
                data=bytes.fromhex(group['dataHex']);n.put(SLOT,'Q',descriptor);n.u.mem_write(INPUT,data+bytes(16))
                n.call(0x1db4e0,{r.UC_X86_REG_RDI:SLOT,r.UC_X86_REG_RSI:ENTITY,r.UC_X86_REG_RDX:group['mask'],r.UC_X86_REG_RCX:INPUT})
                consumed=n.u.reg_read(r.UC_X86_REG_RAX)
                if consumed!=len(data):raise ValueError('Native XP group length differs')
                n.call(0x140480,{r.UC_X86_REG_RDI:ENTITY})
                component=n.u.reg_read(r.UC_X86_REG_RAX)
                if component!=ENTITY+offset:raise ValueError('Native component getter differs')
                n.call(0x1f9a60,{r.UC_X86_REG_RDI:component})
                bits=n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff
                if bits!=struct.unpack('<I',n.u.mem_read(component,4))[0]:raise ValueError('XP consumer differs')
                observations.append({'packetKey':packet['key'],'recordIndex':record_index,'entityId':record['entityId'],
                    'time':packet['time'],'consumed':consumed,'bits':bits})
                byte_count+=consumed
    ranges=[(0x140480,0x140490),(0x1f9880,0x1f99c0),(0x1f99c0,0x1f9a30),(0x1f9a60,0x1f9dd0),
            (0x1f9e60,0x1f9fc0),(0x409880,0x409890),(0x40a1f0,0x40a200),(0x16b2c0,0x16b2e0),
            (0x13e690,0x140450),(0x1db4e0,0x1db750)]
    for a,b in ranges:
        if n.image[a:b]!=n.source.image[a:b]:raise ValueError('Original XP code changed')
    meta={'schema':1,'kind':'native-champion-experience','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
        'decoderImageSha256':n.profile['decoderImageSha256'],'sliceSha256':n.profile['sliceSha256'],
        'championStatePackageSha256':inputs[str(schema_path)],'fields':{'experience':binding},
        'semanticEvidence':{'componentGetterRva':0x140480,'accumulatedGetterRva':0x1f9a60,'levelGetterRva':0x1f9aa0,
            'fractionalLevelRva':0x1f9ae0,'withinLevelExperienceRva':0x1f9d20,'requiredExperienceRva':0x1f9c90,
            'curveRegistrationRva':0x1f9880,'curveTypeHash':'93f5c410','requiredExperiencePropertyHash':'bba38682',
            'curvePropertyOffset':0,'curveGetterRva':0x40a1f0},
        'sourceBlocks':[{'startRva':a,'endRva':b,'sha256':sha(n.image[a:b])}for a,b in ranges],
        'scope':{'originalRegistrationExecuted':True,'nativeGetterExecuted':True,'curveSelectionVerified':False,
            'experienceProgressGaugeAdmitted':False,'referenceAvCompared':False}}
    raw=json.dumps(meta,indent=2).encode();dest=cache/'public/latest-experience/package.json';dest.parent.mkdir(exist_ok=True);dest.write_bytes(raw)
    if not args.observe:
        print(json.dumps({'packageSha256':sha(raw),'mode':'static-build-package-only','binding':binding}));return
    proof={'schema':1,'kind':'native-experience-observations','packageSha256':sha(raw),'inputs':inputs,
        'preparerSha256':sha(Path(__file__).read_bytes()),'records':observations,'originalBlocks':list(n.blocks.values()),
        'sources':{name:sha(Path(__file__).with_name(name).read_bytes())for name in ['vfx_spawn_native.py','macho.py']},
        'counts':{'nativeExperienceGroups':len(observations),'nativeBytes':byte_count,'getterChecks':len(observations)}}
    (cache/'research/experience-native.json').write_text(json.dumps(proof,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'packageSha256':sha(raw),'binding':binding,'counts':proof['counts']}))

if __name__=='__main__':main()
