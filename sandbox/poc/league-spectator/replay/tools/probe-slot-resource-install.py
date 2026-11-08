"""Bounded original resource-install tail; actual typed spell, supplied handle ABI."""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import runpy
import cdtb.binfile as binfile
from unicorn import x86_const as r
from vfx_spawn_native import sha
from native_ai_unit_fixture import NativeAIUnitFixture
from libcpp_shared_native import NativeLibcppSharedOwnership
from startup_map_skin_native import recover_startup_map_skin
from linked_game_mode_native import initialize_linked_mode_provider
from mode_dependency_types_native import initialize_mode_dependency_types
from wad_file_native import NativeWadFiles

spec = importlib.util.spec_from_file_location('slot_basis_control',Path(__file__).with_name('probe-missile-effect-basis.py'))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class Control(NativeLibcppSharedOwnership, module.Control, NativeWadFiles):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('client',type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    def raw(path):
        path=Path(path).resolve();data=path.read_bytes();digest=sha(data)
        if str(path) in inputs and inputs[str(path)]!=digest:raise ValueError('Changed install input')
        inputs[str(path)]=digest;return data
    for dictionary in [value for key,value in vars(binfile).items() if key.startswith('hashfile_')]:dictionary.hashes={}
    for dictionary,name in [(binfile.hashfile_binfields,'binfields'),(binfile.hashfile_bintypes,'bintypes')]:
        dictionary.hashes={int(line.split()[0],16):line.split(maxsplit=1)[1].strip() for line in raw(cache/'vfx'/('hashes.'+name+'.txt')).decode().splitlines()}
    data=raw(cache/'installed-assets/16.21.829.8620-6f8712cf8ff0/characters/akshan.bin')
    class Reader(binfile.BinReader):
        def __init__(self,*args):super().__init__(*args);self.spans={}
        def read_field(self,kind):
            start=self.f.tell();field=super().read_field(kind);self.spans[id(field)]=(start,self.f.tell());return field
    stream=io.BytesIO(data)
    if stream.read(4)!=b'PROP':raise ValueError('Original typed spell BIN required')
    reader=Reader(stream);_,_,types=reader.read_binfile_header()
    entries=[reader.read_binfile_entry(kind) for kind in types]
    entry=next(entry for entry in entries for field in entry.fields if str(field.name)=='ObjectName' and field.value=='AkshanEMissile')
    spell=next(field.value for field in entry.fields if str(field.name)=='mSpell')
    fixture=NativeAIUnitFixture(cache,args.client,Control)
    n=fixture.native
    n.initialize_character_types()
    mode_types=initialize_mode_dependency_types(n)
    recorded_mode=recover_startup_map_skin(n,fixture.cache,fixture.root,fixture.read,fixture.raw)
    if recorded_mode['mapId']!=12 or recorded_mode['mode']!='KIWI':
        raise ValueError('Actual recorded Map12/KIWI configuration required')
    observer=runpy.run_path(str(Path(__file__).with_name('observe-map-asset-links.py')))['observe_map_assets']
    graph=observer(fixture,recorded_mode['variant'],additional_roots=[fixture.reference['selectedIdentity']])
    graph_path=cache/'research/slot-resource-install-mode-graph-v35.json'
    graph_path.write_text(json.dumps(graph,indent=2),encoding='utf-8')
    raw(graph_path)
    print(json.dumps({'modeGraph':graph['counts'],'boundaries':graph['boundaries'],
                      'referenceLinksFixed':graph['scope']['referenceLinksFixed']}),flush=True)
    mode_provider=initialize_linked_mode_provider(n,graph,fixture.reference)
    n.call(0x409880,{})
    if n.u.reg_read(r.UC_X86_REG_RAX)!=mode_provider['provider']:
        raise ValueError('Original selected-mode getter did not return its published source object')
    inputs.update(fixture.inputs)
    n.call(0x870ae0,{})
    registry,count=n.q(n.base+0x247b7c0),n.u32(n.base+0x247b7c8)
    n.types={n.u32(n.q(registry+i*8)+8):n.q(registry+i*8) for i in range(count)}
    n.type_catalog=n.catalog()
    spans=[reader.spans[id(field)] for field in spell.fields]
    loaded=n.observe_actor_fields(spell.type.h,[data[a:b] for a,b in spans]);obj=loaded['object']
    handle,slot=[n.allocate(size) for size in [0x100,0x150]]
    mask=(1<<64)-1
    ror=lambda x,k:((x>>k)|(x<<(64-k)))&mask
    n.put(handle+0x80,'Q',(ror(obj,17)-0x80104765)&mask)
    n.put(handle+0x2c,'I',43261541)
    name=n.allocate(32);n.u.mem_write(name,b'AkshanEMissile\0');n.put(handle+0x30,'Q',name)
    cases=[]
    for previous in ['unbound','same-resource','different-resource']:
        n.call(0x84b390,{r.UC_X86_REG_RDI:slot,r.UC_X86_REG_RSI:51,r.UC_X86_REG_RDX:0})
        if previous!='unbound':
            prior=handle
            if previous=='different-resource':
                prior=n.allocate(0x100);n.u.mem_write(prior,bytes(n.u.mem_read(handle,0x100)));n.put(prior+0x2c,'I',0x12345678)
            n.call(0x84bf80,{r.UC_X86_REG_RDI:slot,r.UC_X86_REG_RSI:prior})
        n.put(slot+0x8c,'f',900.)
        boundary=None;completed=False
        try:
            n.call(0x847f50,{r.UC_X86_REG_RDI:slot,r.UC_X86_REG_RSI:handle,r.UC_X86_REG_RDX:0,
                            r.UC_X86_REG_RCX:0,r.UC_X86_REG_XMM0:0})
            completed=True
        except Exception as error:
            boundary={'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'error':str(error)}
        cases.append({'previous':previous,'initialOverride':900.,'finalOverrideHex':bytes(n.u.mem_read(slot+0x8c,4)).hex(),
                      'completed':completed,'boundary':boundary,'slotHex':bytes(n.u.mem_read(slot,0x150)).hex()})
        if boundary:break
    for name in ['profile.json','image.bin']:raw(cache/'public/decoder-16.21-macos'/name)
    raw(args.client)
    for module_value in tuple(sys.modules.values()):
        path=getattr(module_value,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(path)
    result={'schema':1,'kind':'original-slot-resource-install-tail-control','artifactVersion':35,
            'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'inputs':inputs,
            'sourceSpell':{'name':'AkshanEMissile','entryPathHash':entry.path.h,'typeHash':spell.type.h,'loaded':loaded,
                           'fields':[{'offset':a,'length':b-a,'sha256':sha(data[a:b])} for a,b in spans]},
            'recordedMode':recorded_mode,'modeTypes':mode_types,'modeProvider':mode_provider,
            'mapGraph':{'counts':graph['counts'],'scope':graph['scope'],'boundaries':graph['boundaries'],
                        'selectedIdentity':fixture.reference['selectedIdentity'],
                        'selectedRoot':next(row for row in graph['cases'] if row['identity']==fixture.reference['selectedIdentity'])},
            'cases':cases,'blocks':list(n.blocks.values()),'scope':{'suppliedResourceHandleABI':True,
            'originalSelectedModeProviderPublished':True,'actualRecordedMapModeAndVariant':True,
            'fullAssetPostloadExecuted':False,'assetReadinessVerified':False,'liveWorldRoutingVerified':False,
            'actualTypedSpellReader':True,'fullNetworkAssignment':False,'liveRangeRecovered':False,'activeAdmission':False}}
    output=cache/'research/slot-resource-install-native-v35.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'cases':[{key:row[key] for key in ['previous','completed','boundary','finalOverrideHex']} for row in cases]}))


if __name__=='__main__':main()
