"""Bounded original material texture-acquisition disassembly; no ABI inference."""
import argparse
import json
import struct
from pathlib import Path
import capstone
from capstone import x86_const as x
from vfx_spawn_native import sha

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('package',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
image=(args.package/'image.bin').read_bytes()
profile=json.loads((args.package/'profile.json').read_bytes())
if sha(image)!=profile['decoderImageSha256'] or profile['clientVersion']!='16.21.829.8620':raise ValueError('Original material image required')
decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
blocks=[]
virtuals={str(offset):struct.unpack_from('<Q',image,0x2408570+offset)[0]-profile['imageBase'] for offset in range(0x220,0x318,8)}
ranges=[(0x16dea09,0x16deec2),(0x16e3910,0x16e3c00),(0x745680,0x745900),(0x17407b0,0x1740890),(0x174c6e0,0x174c780),(0x1751950,0x1751a00),(0x1914dc0,0x1914e50),(0x1917340,0x19173b0),(0x1914d50,0x1914dc0),(0x1914f30,0x1915060),(0x19125f0,0x1912dd0),(0x19224e0,0x19228b0),(0x1914440,0x19145e0),(0x1912580,0x19125f0)]+[(start,start+0x180) for start in virtuals.values() if 0<start<0x1fef000]
for start,end in ranges:
    lines=[]
    for instruction in decoder.disasm(image[start:end],start):
        references=[]
        for operand in instruction.operands:
            if operand.type==x.X86_OP_MEM and operand.mem.base==x.X86_REG_RIP:
                target=instruction.address+instruction.size+operand.mem.disp
                references.append({'rva':target,'bytesHex':image[target:target+32].hex()})
        lines.append({'rva':instruction.address,'bytesHex':instruction.bytes.hex(),'mnemonic':instruction.mnemonic,'operands':instruction.op_str,'references':references})
    blocks.append({'start':start,'end':end,'sha256':sha(image[start:end]),'instructions':lines})
result={'schema':1,'kind':'original-material-texture-site-disassembly','decoderImageSha256':sha(image),'virtuals':virtuals,'blocks':blocks,'scope':{'originalFunctionsExecuted':False,'defaultTextureBindingsEstablished':False}}
functions=[];at=0x1912500
while True:
    at=image.find(b'\x55\x48\x89\xe5',at,0x1915000)
    if at<0:break
    instructions=[]
    for instruction in decoder.disasm(image[at:at+0x800],at):
        if instruction.mnemonic=='ret':break
        if instruction.mnemonic=='call' or ('0xa0]' in instruction.op_str and instruction.mnemonic=='lea'):
            instructions.append({'rva':instruction.address,'mnemonic':instruction.mnemonic,'operands':instruction.op_str})
    functions.append({'entry':at,'calls':instructions});at+=1
result['sharedDeviceFunctions']=functions
args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
for block in blocks:
    for instruction in block['instructions']:
        if instruction['mnemonic']=='call' or instruction['references'] or any(value in instruction['operands'] for value in ['0xa0]','0xa8]','0xb0]','0xd8]']):print('%x %s %s'%(instruction['rva'],instruction['mnemonic'],instruction['operands']))
