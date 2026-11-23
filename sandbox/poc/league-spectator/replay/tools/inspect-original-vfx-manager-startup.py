"""Source-only original scene/manager allocation and constructor call chain."""
import argparse
import json
from pathlib import Path
import capstone
from capstone import x86_const as x
from macho import MachImage
from vfx_spawn_native import sha

parser=argparse.ArgumentParser(description=__doc__)
for name in ['package','client','output']:parser.add_argument(name,type=Path)
args=parser.parse_args();profile=json.loads((args.package/'profile.json').read_bytes());image=(args.package/'image.bin').read_bytes();client=args.client.read_bytes();source=MachImage(client)
if profile['clientVersion']!='16.21.829.8620' or profile['protocolDigest']!='20e09df23c66b85e' or sha(image)!=profile['decoderImageSha256'] or source.base!=profile['imageBase']:raise ValueError('Exact approved original VFX image required')
decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
blocks=[];globals=[]
for start,end in [(0x36fd40,0x36fd97),(0x1746750,0x174675a),(0x1745410,0x1745440),(0x36e980,0x36ea30)]:
    if image[start:end]!=source.image[start:end]:raise ValueError('Original VFX startup differs from pristine client')
    instructions=[]
    for instruction in decoder.disasm(image[start:end],start):
        instructions.append({'rva':instruction.address,'bytesHex':instruction.bytes.hex(),'mnemonic':instruction.mnemonic,'operands':instruction.op_str})
        if instruction.mnemonic=='mov' and instruction.operands[0].type==x.X86_OP_MEM and instruction.operands[0].mem.base==x.X86_REG_RIP:
            globals.append({'storeRva':instruction.address,'globalRva':instruction.address+instruction.size+instruction.operands[0].mem.disp,'sourceRegister':instruction.reg_name(instruction.operands[1].reg)})
    blocks.append({'startRva':start,'endRva':end,'sha256':sha(image[start:end]),'instructions':instructions})
expected={0x36fd4f:0x1474a30,0x36fd5a:0x36e980,0x36fd6b:0x1474a30,0x36fd79:0x1746750,0x1746755:0x1745410}
for at,target in expected.items():
    instruction=next(decoder.disasm(image[at:at+5],at,count=1))
    if instruction.mnemonic not in ['call','jmp'] or instruction.operands[0].type!=x.X86_OP_IMM or instruction.operands[0].imm!=target:raise ValueError('Original VFX startup branch identity differs')
result={'schema':1,'kind':'original-vfx-manager-startup-source','build':profile['clientVersion'],'protocol':profile['protocolDigest'],'decoderImageSha256':sha(image),'inputs':{str(file.resolve()):sha(file.read_bytes()) for file in [args.package/'profile.json',args.package/'image.bin',args.client]},'sources':{file.name:sha(file.read_bytes()) for file in [Path(__file__),Path(__file__).with_name('macho.py')]},'startupEntryRva':0x36fd40,'sceneOwner':{'allocationBytes':0xa0,'allocationCallRva':0x36fd4f,'constructorRva':0x36e980,'constructorCallRva':0x36fd5a,'managerArgumentRegister':'rsi'},'manager':{'allocationBytes':0x3a8,'allocationCallRva':0x36fd6b,'constructorThunkRva':0x1746750,'constructorBodyRva':0x1745410,'constructorCallRva':0x36fd79},'globalStores':globals,'sourceBlocks':blocks,'scope':{'sourceOnly':True,'originalStartupExecuted':False,'managerReadinessAdmitted':False}}
args.output.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8');print(json.dumps({'output':str(args.output),'startupEntryRva':result['startupEntryRva'],'globalStores':globals}))
