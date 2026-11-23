"""Original BuffData attribute getter on exact archived field projections.

Only the getter's recovered byte dependency is read. Name/context resolution,
live buff membership and other authored metadata remain outside this proof.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from buff_metadata_native import initialize_buff_metadata_types
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','input','output']:
        parser.add_argument(name,type=Path)
    args=parser.parse_args()
    encoded=args.input.read_bytes()
    request=json.loads(encoded)
    root=Path(__file__).resolve().parent
    if (request['kind']!='original-native-buff-metadata-field-input' or request['build']!='16.21.829.8620' or
            request['protocol']!='20e09df23c66b85e' or request['preparerSha256']!=sha((root/'prepare-native-buff-metadata-input.mjs').read_bytes()) or
            request['readerSha256']!=sha((root/'exact-map-bin.mjs').read_bytes()) or not 0<len(request['roots'])<=10000):
        raise ValueError('Exact original BuffData byte-dependency input required')
    for file,expected in request['inputs'].items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('Archived buff input changed: '+file)
    n=NativeCharacterAssets(args.cache/'public/decoder-16.21-macos',args.client)
    paths={Path(__file__),Path(inspect.getfile(initialize_buff_metadata_types)),
           *[Path(inspect.getfile(klass)) for klass in type(n).__mro__ if klass is not object]}
    sources={str(file.resolve()):sha(file.read_bytes()) for file in paths}
    n.initialize_character_types()
    initializers=initialize_buff_metadata_types(n)
    if sha(n.image)!=request['decoderImageSha256'] or n.image[0x830bc0:0x830bcd]!=n.source.image[0x830bc0:0x830bcd]:
        raise ValueError('Original BuffData getter image differs')
    cases,boundary,active=[],None,None
    try:
        for item in request['roots']:
            active={key:item[key] for key in ['sourceSha256','ownerPathHash']}
            raw=Path(item['source']['file']).read_bytes()
            if sha(raw)!=item['source']['sha256'] or len(raw)!=item['source']['bytes'] or item['classHash']!='4633d794':
                raise ValueError('Original archived BuffData owner differs')
            fields=[]
            if len(item['fields'])>1: raise ValueError('One original BuffData byte field required')
            for span in item['fields']:
                offset,length=span['offset'],span['bytes']
                if length!=6 or not 0<=offset<=len(raw)-length or span['fieldHash']!='d7e2c71d':
                    raise ValueError('Original BuffData U8 field escaped source')
                field=raw[offset:offset+length]
                if sha(field)!=span['sha256'] or struct.unpack_from('<IB',field)!=(0xd7e2c71d,3):
                    raise ValueError('Original BuffData U8 source bytes differ')
                fields.append(field)
            observed=n.observe_actor_fields(0x4633d794,fields)
            value=n.u.mem_read(observed['object']+0x7c,1)[0]
            if (observed['originalSkippedFields'] or observed['pendingReferences'] or
                    value!=item['expectedAttributeByte'] or observed['size']!=128):
                raise ValueError('Original BuffData projection reader differs')
            n.call(0x830bc0,{r.UC_X86_REG_RDI:observed['object'],r.UC_X86_REG_RSI:2})
            result=n.u.reg_read(r.UC_X86_REG_RAX)&255
            if result!=int(bool(value&2)): raise ValueError('Original archived attribute getter differs')
            cases.append(active|{'origins':item['origins'],'actorScopes':item['actorScopes'],
                                 'attributeByte':value,'attributeSource':item['attributeSource'],
                                 'originalMask2Result':bool(result),'originalRead':observed})
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),'active':active,
                  'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    for file,expected in {**sources,**request['inputs']}.items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('Native BuffData source changed: '+file)
    if args.input.read_bytes()!=encoded: raise ValueError('Native BuffData input changed during controls')
    result={'schema':1,'kind':'original-archived-buff-attribute-observation','build':request['build'],'protocol':request['protocol'],
            'decoderImageSha256':sha(n.image),'inputSha256':sha(encoded),'layoutProofSha256':request['layoutProof']['sha256'],
            'sourceAuthoritySha256':request['sourceAuthority']['sha256'],'sources':sources,'initializers':initializers,
            'cases':cases,'absentMetadata':request['absentMetadata'],'boundary':boundary,'originalBlocks':list(n.blocks.values()),
            'scope':{'originalArchivedAttributeFieldsRead':boundary is None,'originalCompleteGetterExecuted':boundary is None,
                     'otherMetadataFieldsInterpreted':False,'resourceContextIdentityResolved':False,
                     'buffMembershipEstablished':False,'liveAnimationProviderAdmitted':False}}
    args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'cases':len(cases),'mask2True':sum(row['originalMask2Result'] for row in cases),'boundary':boundary}))
    if boundary: raise SystemExit(1)


if __name__=='__main__': main()
