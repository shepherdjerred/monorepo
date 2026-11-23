"""Original ASCII resource-name ELF hash used by active buff source consumers."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','requests','output']:
        parser.add_argument(name,type=Path)
    args=parser.parse_args()
    encoded=args.requests.read_bytes()
    request=json.loads(encoded)
    if request['kind']!='recorded-buff-resource-requests' or request['build']!='16.21.829.8620' or request['protocol']!='20e09df23c66b85e':
        raise ValueError('Exact original buff resource request inventory required')
    for file,expected in request['inputs'].items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('Buff name input source changed: '+file)
    n=NativeSpawn(args.cache/'public/decoder-16.21-macos',args.client)
    paths={Path(__file__),*[Path(inspect.getfile(klass)) for klass in type(n).__mro__ if klass is not object]}
    sources={str(file.resolve()):sha(file.read_bytes()) for file in paths}
    if sha(n.image)!=request['decoderImageSha256'] or n.image[0x144b3a0:0x144b3f6]!=n.source.image[0x144b3a0:0x144b3f6]:
        raise ValueError('Original resource-name hash function differs')
    names={candidate['name'] for row in request['requests'] for candidate in row['knownSpellCatalogNames']}
    names.update(['','AhriR','AHRIR','ahrir','Homeguard','HOMEGUARD','ahriidleorbvfxbuff','SionPassive'])
    names.update(chr(value) for value in range(1,128))
    names.update('AaZz09_/'+chr(value)+'/'+chr(value)+'AaZz' for value in range(1,128))
    cases=[]
    for name in sorted(names):
        data=name.encode('ascii')
        if b'\0' in data or len(data)>1024: raise ValueError('Bounded ASCII resource names required')
        n.u.mem_write(0x100e0000,data+b'\0')
        n.call(0x144b3a0,{r.UC_X86_REG_RDI:0x100e0000})
        cases.append({'name':name,'hash':n.u.reg_read(r.UC_X86_REG_EAX)})
    for file,expected in {**sources,**request['inputs']}.items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('Original name source changed: '+file)
    if args.requests.read_bytes()!=encoded: raise ValueError('Original buff requests changed')
    output={'schema':1,'kind':'original-buff-resource-name-hash-controls','build':request['build'],'protocol':request['protocol'],
            'decoderImageSha256':sha(n.image),'inputSha256':sha(encoded),'entryRva':0x144b3a0,
            'casePolicy':'ASCII-A-Z-to-a-z-only','sourceFunctionSha256':sha(n.image[0x144b3a0:0x144b3f6]),
            'sources':sources,'cases':cases,'originalBlocks':list(n.blocks.values()),
            'scope':{'completeOriginalHashFunctionExecuted':True,'nativeResourceLookupEstablished':False,
                     'nonAsciiResourceNamesAdmitted':False,'nativeBuffMembershipEstablished':False}}
    args.output.write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'cases':len(cases),'entryRva':0x144b3a0}))


if __name__=='__main__': main()
