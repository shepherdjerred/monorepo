"""Original startup plus scoped unit collection insertion/deduplication."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from aligned_asset_memory_native import AlignedAssetMemory
from game_mode_data_native import NativeGameModeData
from native_ai_unit_fixture import NativeAIUnitFixture
from unit_collection_native import initialize_unit_collection
from vfx_spawn_native import sha, ADDRESSES


class Control(AlignedAssetMemory, NativeGameModeData): pass


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path);p.add_argument('client',type=Path)
    args=p.parse_args()
    f=NativeAIUnitFixture(args.cache,args.client,Control);n=f.native
    setup=initialize_unit_collection(n);collection=setup['object']
    rejected=False
    try: initialize_unit_collection(n)
    except ValueError: rejected=True
    if not rejected: raise ValueError('Duplicate global publication admitted')
    cases=[];objects=[n.allocate(8) for _ in range(12)]
    for pointer in [*objects, objects[0], objects[6], objects[-1]]:
        # Supplied opaque pointer; the original scoped block stores identity
        # only and invokes the original no-op collection notification virtual.
        n.call(0xc0980,{r.UC_X86_REG_R14:pointer,r.UC_X86_REG_RSP:ADDRESSES['stack']-8},0xc0ab3)
        count=n.u32(collection+0x10);items=[n.q(n.q(collection+8)+i*8) for i in range(count)]
        expected=list(dict.fromkeys([*[row['pointer'] for row in cases],pointer]))
        if items != expected or count > 12:
            raise ValueError('Original unit collection insertion/deduplication differs')
        cases.append({'pointer':pointer,'items':items,'count':count,'capacity':n.u32(collection+0x14)})
    ranges=[(0x66a2c9,0x66a2eb),(0xc0980,0xc0ab3),(0x67c670,0x67c686)]
    paths={Path(__file__),Path(inspect.getfile(initialize_unit_collection)),Path(inspect.getfile(NativeAIUnitFixture)),
           *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result={'schema':1,'kind':'original-unit-pointer-collection-control','build':n.profile['clientVersion'],
            'decoderImageSha256':sha(n.image),'setup':setup,'cases':cases,'duplicateStartupRejected':rejected,
            'inputs':f.inputs,'sources':{str(p.resolve()):sha(p.read_bytes()) for p in paths},
            'sourceBlocks':[{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])} for a,b in ranges],
            'scope':{'originalStartupCompleted':True,'originalInsertionAndDeduplication':True,
                     'suppliedOpaquePointerIdentities':True,'fullHeroHandlerCompleted':False,
                     'acceptedReplayEntities':False,'resourceContextAccepted':False}}
    out=f.cache/'research/unit-collection-native.json';out.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(out),'cases':len(cases),'finalCount':n.u32(collection+0x10)}))


if __name__=='__main__':main()
