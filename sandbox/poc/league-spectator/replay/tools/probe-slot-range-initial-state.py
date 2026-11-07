"""Original slot constructor/reset and bounded static write/reference audit.

This does not infer a replay hero's initial +8c from missing range packets.
Historical full-hero controls retain their explicit supplied-identity/boundary
limits. Generic pointer aliasing or arbitrary bulk-copy exclusion is not claimed.
"""
import argparse
import bisect
import json
from pathlib import Path
import struct
import sys
import capstone
from capstone.x86_const import X86_OP_MEM, X86_REG_RIP
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def function_starts(data):
    cursor=32
    for _ in range(struct.unpack_from('<I',data,16)[0]):
        command,size=struct.unpack_from('<II',data,cursor)
        if command==0x26:
            offset,length=struct.unpack_from('<II',data,cursor+8)
            at,current,starts=offset,0,[]
            while at<offset+length:
                value=shift=0
                while True:
                    byte=data[at];at+=1;value|=(byte&127)<<shift;shift+=7
                    if byte<128:break
                if value==0:return starts
                current+=value;starts.append(current)
            raise ValueError('Original function-start terminator missing')
        cursor+=size
    raise ValueError('Original function-start metadata required')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path)
    args=parser.parse_args();cache=args.cache.resolve();inputs={}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Slot initial input drift')
        inputs[str(path)]=digest;return data
    n=NativeSpawn(cache/'public/decoder-16.21-macos',args.client)
    raw(args.client)
    for name in ['profile.json','image.bin','vfx-birth.json','vfx-values.json']:raw(cache/'public/decoder-16.21-macos'/name)
    manager,view=n.allocate(0x20),n.allocate(0x20)
    n.put(manager+0x10,'Q',view);n.put(n.base+0x246d000,'Q',manager)
    def clock(engine,address,size,user):
        if engine.reg_read(r.UC_X86_REG_RDI)!=view:raise ValueError('Reset clock escaped supplied view')
        engine.reg_write(r.UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',17.5),'little'));n.ret()
    n.u.hook_add(unicorn.UC_HOOK_CODE,clock,begin=n.base+0x15ed8e0,end=n.base+0x15ed8e0)
    slots=[]
    for index in range(64):
        slot=n.allocate(0x160,0xa5)
        n.call(0x84b390,{r.UC_X86_REG_RDI:slot,r.UC_X86_REG_ESI:index,r.UC_X86_REG_RDX:0})
        if bytes(n.u.mem_read(slot+0x150,16))!=b'\xa5'*16 or bytes(n.u.mem_read(slot+0x8c,8))!=bytes(8):raise ValueError('Original constructor clear/guard differs')
        slots.append({'index':index,'rangeHex':bytes(n.u.mem_read(slot+0x8c,4)).hex(),'vtableRva':n.q(slot)-n.base,'resetRva':n.q(n.q(slot)+0x10)-n.base})
    controls=[]
    for entry in [0x848210,0x84b4d0]:
        for bits in [0x3f800000,0x44610000,0xbf800000,0x80000000,0x7f800000,0x7fc00001]:
            slot=n.allocate(0x160,0xa5)
            n.call(0x84b390,{r.UC_X86_REG_RDI:slot,r.UC_X86_REG_ESI:51,r.UC_X86_REG_RDX:0})
            n.put(slot+0x8c,'II',bits,0x41200000)
            n.call(entry,{r.UC_X86_REG_RDI:slot})
            result=bytes(n.u.mem_read(slot+0x8c,8)).hex()
            if result!='0000000000000000' or bytes(n.u.mem_read(slot+0x150,16))!=b'\xa5'*16:raise ValueError('Original reset clear/guard differs')
            controls.append({'resetRva':entry,'suppliedPriorRangeBits':bits,'rangeAndAdjacent90Hex':result})
    image=n.source.image;starts=function_starts(n.source.binary)
    decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
    writes=[];class_functions=[]
    for start,end in zip(starts,starts[1:]):
        if not 0x847c10<=start<0x84c500:continue
        code=bytes(image[start:end]);class_functions.append({'rva':start,'bytes':len(code),'sha256':sha(code)})
        for inst in decoder.disasm(code,start):
            for index,operand in enumerate(inst.operands):
                # This Capstone build omits write-access metadata on MOVLPS
                # and MOVUPS. Intel's first memory operand is their destination.
                written=bool(operand.access&capstone.CS_AC_WRITE) or (index==0 and inst.mnemonic.startswith('mov'))
                if operand.type==X86_OP_MEM and written and operand.mem.base!=X86_REG_RIP and operand.mem.disp<=0x8c<operand.mem.disp+operand.size:
                    writes.append({'functionRva':start,'rva':inst.address,'mnemonic':inst.mnemonic,'operands':inst.op_str,'bytesHex':inst.bytes.hex(),'memoryDisplacement':operand.mem.disp,'memoryBytes':operand.size})
    if [row['rva'] for row in writes]!=[0x8482ba,0x8492b4,0x84b3e7,0x84b587]:raise ValueError('Bounded original class write inventory changed: '+str(writes))
    references=[]
    for target in [0x84b390,0x848210,0x84b4d0,0x8492b0]:
        calls=[];at=0
        while True:
            at=image.find(b'\xe8',at)
            if at<0:break
            if at+5<=len(image) and at+5+struct.unpack_from('<i',image,at+1)[0]==target:
                start=starts[bisect.bisect_right(starts,at)-1]
                # Verify the candidate is an instruction boundary in its original function.
                if any(i.address==at and i.mnemonic=='call' for i in decoder.disasm(bytes(image[start:at+5]),start)):
                    calls.append({'callRva':at,'functionRva':start})
            at+=1
        absolute=[];at=0;pattern=struct.pack('<Q',n.base+target)
        while True:
            at=image.find(pattern,at)
            if at<0:break
            absolute.append(at);at+=1
        references.append({'targetRva':target,'directCalls':calls,'absolute64BitReferences':absolute})
    if [row['callRva'] for row in references[-1]['directCalls']]!=[0x1135a9,0x1137d9,0x113a09] or references[-1]['absolute64BitReferences']:raise ValueError('Original setter reference inventory changed')
    historical=[]
    for name in ['ai-hero-construction-native.json','recorded-hero-creation-native.json']:
        report=json.loads(raw(cache/'research'/name))
        observed={str(hex(at)):any(row['rva']<=at<row['rva']+row['size'] for row in report['originalBlocks']) for at in [0x84b390,0x848210,0x8492b0,0x8b01d0]}
        historical.append({'artifact':name,'scope':report['scope'],'completed':report.get('completed'),'state':{k:report.get('state',{}).get(k) for k in ['handlerEntered','handlerReturned','networkEntityVerified']},'boundary':{k:report.get('boundary',{}).get(k) for k in ['phase','instructionRva']} if report.get('boundary') else None,'observedOriginalBlocks':observed,'sourceHashesAreHistoricalProvenance':True,'currentReplaySlot51StateEstablished':False})
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Slot initial-state input changed')
    output=cache/'research/slot-range-initial-state-native-v35.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-slot-range-constructor-reset-and-bounded-write-audit','artifactVersion':35,'inputs':inputs,'constructedSlots':slots,'resetControls':controls,'originalBlocks':list(n.blocks.values()),'classFunctionRange':[0x847c10,0x84c500],'classFunctions':class_functions,'overlapping8cStores':writes,'wholeImageReferences':references,'historicalHeroControls':historical,'missingPreconditions':['actual-causal-hero-slot51-initial-state-or-proven-reset-before-query','all-accepted-initial-snapshot-slot-range-restoration-writes','complete-intervening-range-writes-and-identity-preserving-resource-state'],'scope':{'originalConstructorAndBothResetMethods':True,'boundedClassExplicitMemoryWriteInventory':True,'wholeImageDirectCallAndAbsolutePointerReferenceScan':True,'genericAliasedBulkCopyExclusionEstablished':False,'arbitraryIndirectOrEncodedFunctionPointerExclusionEstablished':False,'actualConsumedRangeRecovered':False,'activeFamilyAdmissionChanged':False}},indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'constructedSlots':len(slots),'resetControls':len(controls),'boundedClassStores':len(writes),'actualInitialStateEstablished':False}))


if __name__=='__main__':main()
