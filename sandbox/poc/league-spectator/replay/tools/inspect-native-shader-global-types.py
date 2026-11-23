"""Observe original registered Shared shader metadata types, without ABI guesses."""
import argparse
import inspect
import json
import struct
import capstone
from pathlib import Path
from character_asset_native import NativeCharacterAssets
from vfx_spawn_native import sha
parser=argparse.ArgumentParser(description=__doc__)
for name in ['package','client','output']:parser.add_argument(name,type=Path)
args=parser.parse_args();n=NativeCharacterAssets(args.package,args.client)
count=n.initialize_character_types();catalog=n.catalog()
rows=[]
decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
for key in [0x344a9a75,0x3745189b,0x4bcf438a]:
    value=catalog.get(format(key,'08x'))
    occurrences=[];at=0
    while True:
        at=n.image.find(struct.pack('<I',key),at)
        if at<0:break
        start=n.image.rfind(b'\x55\x48\x89\xe5',max(0,at-0x1000),at)
        instructions=[] if start<0 or at>=0x1fef000 else [{'rva':item.address,'mnemonic':item.mnemonic,'operands':item.op_str} for item in decoder.disasm(n.image[start:min(start+0x180,at+0x60)],start)]
        occurrences.append({'rva':at,'nearestPriorPrologue':start,'instructions':instructions});at+=4
    rows.append({'classHash':format(key,'08x'),'registered':value is not None,'descriptor':value,'hashOccurrences':occurrences})
result={'schema':1,'kind':'original-shared-shader-metadata-type-controls','build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),'registryCount':count,'classes':rows,'sources':{Path(inspect.getfile(base)).name:sha(Path(inspect.getfile(base)).read_bytes()) for base in type(n).__mro__ if base is not object},'originalBlocks':list(n.blocks.values()),'scope':{'originalTypeRegistryExecuted':True,'typedSharedDataLoaded':False,'globalResourceRegistryInitialized':False}}
args.output.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
print(json.dumps({'output':str(args.output),'classes':[{'classHash':row['classHash'],'registered':row['registered'],'occurrences':[{'rva':item['rva'],'prologue':item['nearestPriorPrologue']} for item in row['hashOccurrences']]} for row in rows]}))
