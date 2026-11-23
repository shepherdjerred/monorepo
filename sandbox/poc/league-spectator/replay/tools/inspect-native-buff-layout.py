"""Original SpellObject/Buff metadata reflection layout and constructor defaults.

No authored asset, live buff, spell registry or provider state is synthesized.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from character_asset_native import NativeCharacterAssets
from unicorn import x86_const as r
from vfx_spawn_native import sha, name_hash
from buff_metadata_native import initialize_buff_metadata_types


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','output']:
        parser.add_argument(name,type=Path)
    args=parser.parse_args()
    n=NativeCharacterAssets(args.cache/'public/decoder-16.21-macos',args.client)
    paths={Path(__file__),Path(inspect.getfile(initialize_buff_metadata_types)),*[Path(inspect.getfile(klass)) for klass in type(n).__mro__ if klass is not object]}
    sources={str(file.resolve()):sha(file.read_bytes()) for file in paths}
    n.initialize_character_types()
    # These classes belong to additional original modules, not the existing
    # character initializer subset. Execute their actual caller LEA/CALL pairs;
    # no descriptor, property table or constructor pointer is fabricated.
    initializers=initialize_buff_metadata_types(n)
    catalog=n.catalog()
    spell=catalog['%08x'%name_hash('SpellObject')]
    fields=[row for row in spell['properties'] if row['offset']==0x60]
    if len(fields)!=1: raise ValueError('One original SpellObject metadata pointer at+60 required')
    referenced=[(identity,layout) for identity,layout in catalog.items() if layout['rva']==fields[0]['referencedTypeRva']]
    if len(referenced)!=1: raise ValueError('One original referenced buff metadata class required')
    identity,layout=referenced[0]
    defaults=n.observe_actor_fields(int(identity,16),[])
    if defaults['pendingReferences'] or defaults['originalSkippedFields']:
        raise ValueError('Complete original buff constructor defaults required')
    selected=[field for field in layout['properties'] if field['offset']==0x7c]
    if (identity!='4633d794' or layout['size']!=0x80 or len(selected)!=1 or selected[0]['type']!=3 or
            selected[0]['hash']!=0xd7e2c71d or fields[0]['hash']!=0x7f0f5a79 or fields[0]['type']!=0x82):
        raise ValueError('Original SpellObject/BuffData authored attribute layout differs')
    getter_controls=[]
    for value in range(256):
        serialized=struct.pack('<IBB',selected[0]['hash'],3,value)
        authored=n.observe_actor_fields(int(identity,16),[serialized])
        if authored['originalSkippedFields'] or authored['pendingReferences'] or n.u.mem_read(authored['object']+0x7c,1)!=bytes([value]):
            raise ValueError('Original authored BuffData U8 reader differs')
        for mask in [0,1,2,4,128,255]:
            n.call(0x830bc0,{r.UC_X86_REG_RDI:authored['object'],r.UC_X86_REG_RSI:mask})
            result=n.u.reg_read(r.UC_X86_REG_RAX)&255
            if result!=int(bool(value&mask)): raise ValueError('Original buff attribute predicate differs')
            getter_controls.append({'authoredByte':value,'mask':mask,'result':result})
    # The original SpellObject pointer reader must construct the nested BuffData
    # itself. These are serialized controls, not an authored archived resource.
    # Pointer payload carries a bounded length word before the field count.
    nested=struct.pack('<IBIIH',0x7f0f5a79,0x82,0x4633d794,8,1)+struct.pack('<IBB',0xd7e2c71d,3,2)
    spell_control=n.observe_actor_fields(name_hash('SpellObject'),[nested])
    buff_pointer=n.q(spell_control['object']+0x60)
    if (spell_control['pendingReferences'] or spell_control['originalSkippedFields'] or
            not n.library_pointer(buff_pointer,0x80) or n.u.mem_read(buff_pointer+0x7c,1)!=b'\x02'):
        raise ValueError('Original nested SpellObject/BuffData reader differs')
    for file,expected in sources.items():
        if sha(Path(file).read_bytes())!=expected: raise ValueError('Native buff layout source changed')
    output={'schema':1,'kind':'original-buff-metadata-layout','build':n.profile['clientVersion'],
            'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
            'spellObject':spell,'metadataField':fields[0],'metadataClassHash':identity,
            'additionalOriginalInitializers':initializers,
            'metadataClass':layout,'homeguardByteProperties':selected,'defaults':defaults,
            'authoredU8GetterControls':getter_controls,'nestedSpellObjectControl':spell_control,
            'sources':sources,'originalBlocks':list(n.blocks.values()),
            'scope':{'originalReflectionExecuted':True,'originalDefaultConstructorExecuted':True,
                     'originalU8ReaderAndCompleteAttributeGetterCompared':True,
                     'originalNestedPointerReaderExecuted':True,
                     'authoredResourceLoaded':False,'liveBuffProviderAdmitted':False}}
    args.output.write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'classHash':identity,'bytes':layout['size'],
                      'flagProperties':selected,'getterControls':len(getter_controls)}))


if __name__=='__main__': main()
