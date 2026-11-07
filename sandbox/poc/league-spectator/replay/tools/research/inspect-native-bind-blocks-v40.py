import hashlib,json
from pathlib import Path
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
root=Path(__file__).resolve().parents[6]
report=json.loads((root/'.cache/replay-spike/research/no-alpha-mult-stream-raster-v40.json').read_bytes())
image=(root/'.cache/replay-spike/public/decoder-16.21-macos/image.bin').read_bytes()
dis=Cs(CS_ARCH_X86,CS_MODE_64)
matches=[]
for block in report['originalBlocks']:
    code=image[block['rva']:block['rva']+block['size']]
    if hashlib.sha256(code).hexdigest()!=block['sha256']:raise ValueError('Original block changed')
    instructions=list(dis.disasm(code,block['rva']))
    for i,ins in enumerate(instructions):
        if '0x9c]' in ins.op_str:
            matches.append({'block':block,'instructions':[{'rva':hex(v.address),'mnemonic':v.mnemonic,'operands':v.op_str}for v in instructions[max(0,i-8):min(len(instructions),i+9)]]})
out=root/'.cache/replay-spike/research/no-alpha-mult-native-bind-instructions-v40.json'
if out.exists():raise ValueError('Preserve prior instruction witness')
out.write_text(json.dumps({'kind':'original-bound-pool-retained-delta-instruction-witness','imageSha256':hashlib.sha256(image).hexdigest(),'matches':matches},indent=2))
print(json.dumps({'output':str(out),'matches':matches},indent=2))
