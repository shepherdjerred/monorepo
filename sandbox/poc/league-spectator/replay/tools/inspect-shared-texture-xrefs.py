"""Locate bounded original Shared texture-name registration references."""
import argparse
import json
from pathlib import Path
import struct
import capstone
from capstone import x86_const as x
from vfx_spawn_native import sha
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('package',type=Path);parser.add_argument('output',type=Path)
args=parser.parse_args();image=(args.package/'image.bin').read_bytes();profile=json.loads((args.package/'profile.json').read_bytes())
if sha(image)!=profile['decoderImageSha256']:raise ValueError('Original image changed')
targets={}
for name in ['PIXEL_COLOR_REMAP_RAMP','PARTICLE_COLOR_TEXTURE','FOW_MAP']:
    at=0
    while True:
        at=image.find(name.encode()+b'\0',at)
        if at<0:break
        targets[at]={'name':name,'kind':'string'};at+=1
for address,target in list(targets.items()):
    at=0;needle=struct.pack('<Q',address+profile['imageBase'])
    while True:
        at=image.find(needle,at)
        if at<0:break
        targets[at]={'name':target['name'],'kind':'original-pointer-to-string','targetRva':address};at+=1
targets[0x2408570]={'name':'original-backend-device-vtable','kind':'original-vtable'}
targets[0x247da80]={'name':'original-shared-default-texture-cache-global','kind':'original-global'}
targets[0x256e1b8]={'name':'original-graphics-service-global','kind':'original-global'}
decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
instructions={}
for prefix in [b'\x48\x8d',b'\x4c\x8d',b'\x48\x8b',b'\x4c\x8b',b'\x48\x89',b'\x4c\x89']:
    at=0
    while True:
        at=image.find(prefix,at,0x1fef000)
        if at<0:break
        instruction=next(decoder.disasm(image[at:at+15],at,count=1),None)
        if instruction:
            for operand in instruction.operands:
                if operand.type==x.X86_OP_MEM and operand.mem.base==x.X86_REG_RIP:
                    target=instruction.address+instruction.size+operand.mem.disp
                    if target in targets:instructions[at]={'rva':at,'mnemonic':instruction.mnemonic,'operands':instruction.op_str,'target':targets[target],'targetRva':target,'bytesHex':instruction.bytes.hex()}
        at+=1
result={'schema':1,'kind':'original-shared-texture-name-xrefs','decoderImageSha256':sha(image),'targets':targets,'references':list(instructions.values()),'scope':{'originalConsumerExecuted':False}}
args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'targets':targets,'references':list(instructions.values())}))
