"""Actual Akshan hero packet to original cold constructor return, then stop.

No appearance/network acceptance or snapshot continuation is claimed. The
original navgrid loader supplies its own readiness over installed Map12 bytes;
its optional owner is explicitly absent in this bounded prefix control.
"""
import argparse
import importlib.util
import inspect
import json
from pathlib import Path
import struct
import sys
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from ai_hero_type_native import initialize_hero_client_types
from process_arguments_native import initialize_product_configuration
from mode_dependency_types_native import initialize_mode_dependency_types
from navgrid_world_native import initialize_navgrid_world
from champion_catalog_native import initialize_binary_resource_cache,initialize_binary_postload_tls,initialize_champion_catalog
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from vfx_spawn_native import ADDRESSES,sha

_spec=importlib.util.spec_from_file_location('recorded_hero_prefix_dependencies',Path(__file__).with_name('probe-recorded-hero-creation.py'))
_module=importlib.util.module_from_spec(_spec);sys.modules[_spec.name]=_module;_spec.loader.exec_module(_module)
Control=_module.Control


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path);parser.add_argument('client',type=Path);parser.add_argument('installation',type=Path)
    args=parser.parse_args();fixture=NativeAIUnitFixture(args.cache,args.client,Control);n=fixture.native
    samples=fixture.read(fixture.cache/'research/initial-heroes-input.json')
    oracle=fixture.read(fixture.cache/'research/initial-heroes-native.json')
    codecs=fixture.read(fixture.cache/'public/decoder-16.21-macos/field-codecs.json')
    semantics=fixture.read(fixture.cache/'research/latest-semantics-effects.json')
    if (samples['build']!=n.profile['clientVersion'] or samples['protocol']!=n.profile['protocolDigest'] or
        samples['replaySha256']!=semantics['replaySha256'] or oracle['decoderImageSha256']!=n.profile['decoderImageSha256'] or
        oracle['constructorImageSha256']!=n.profile['constructorImageSha256']):
        raise ValueError('Original initial hero fixtures required')
    codec_path=fixture.cache/'public/decoder-16.21-macos/field-codecs.json'
    if sha(fixture.raw(codec_path))!=n.profile['fieldCodecsSha256']:raise ValueError('Original field codec bytes required')
    selected=[]
    for key,sample in samples['packets'].items():
        observed=oracle['observations'][key]
        if sample['opcode']!=1049 or sample['stream']!=2 or sample['time']!=0 or sample['param']!=0 or observed['status']!='complete' or observed['payloadSha256']!=sha(bytes.fromhex(sample['payloadHex'])):raise ValueError('Original startup packet identity differs')
        packet=bytes.fromhex(observed['object']);heap=bytes.fromhex(observed['heap'])
        at,length=struct.unpack_from('<QI',packet,80);offset=at-0x10200000
        if len(packet)!=120 or heap[:120]!=packet or not 0<=offset<=len(heap)-length:raise ValueError('Original decoded hero heap bounds differ')
        name=heap[offset:offset+length].decode('ascii')
        if name=='Akshan':selected.append((key,sample,observed,packet,heap))
    if len(selected)!=1:raise ValueError('One actual Akshan creation packet required')
    key,sample,observed,packet,heap=selected[0]
    def field(name,at,width):
        meta=codecs['codecs'][name]
        if meta['bytes']!=width or any(sorted(column)!=list(range(256)) for column in meta['decode']):raise ValueError('Exact original byte codec required')
        return int.from_bytes(bytes(meta['decode'][i][packet[at+i]] for i in range(width)),'little')
    entity,slot=field('heroNetworkId',56,4),field('heroSlot',16,1)
    if not any(hero['entityId']==entity and hero['slot']==slot and hero['champion']=='Akshan' for hero in semantics['heroes']):raise ValueError('Actual roster identity differs')
    setup={};state={'constructorEntered':False,'constructorReturned':False,'handlerReturned':False,'networkEntityVerified':False};boundary=None;phase='setup';captures=[]
    try:
        setup['arena']=n.initialize_asset_arena(128)
        setup['physicalClientFiles']=n.configure_client_loose_files(args.installation/'Game')
        setup['audio']=n.initialize_audio_facade();setup['ui']=n.initialize_ui_data_prefix()
        setup['product']=initialize_product_configuration(n,'LoL')
        setup['characterTypes']=n.initialize_character_types()
        setup['modeDependencyTypes']=initialize_mode_dependency_types(n)
        setup['heroTypes']=initialize_hero_client_types(n,reuse_existing=True)
        phase='original-installed-champion-catalog'
        setup['archives']=[]
        for name in ['DATA.wad.client','Global.wad.client','Bootstrap.windows.wad.client']:
            archive=register_resource_archive(fixture,args.installation,name);path=Path(archive['path'])
            archive['subchunks']=load_installed_subchunks(fixture,args.installation,path,archive['archive'],fixture.raw(path));setup['archives'].append(archive)
        setup['binaryCache']=initialize_binary_resource_cache(n)
        setup['binaryTLS']=initialize_binary_postload_tls(n)
        setup['championCatalog']=initialize_champion_catalog(n)
        setup['navgrid']=initialize_navgrid_world(fixture,owner_context=0)
        world=n.allocate(0x268);n.u.mem_write(world+0x168,b'\xa5'*0x100)
        n.call(0x54a4d0,{r.UC_X86_REG_RDI:world})
        if n.q(n.base+0x24722c0)!=world or n.q(world+0x48) or n.u32(world+0x14):raise ValueError('Original empty world publication required')
        setup['world']={'object':world,'constructorRva':0x54a4d0}
        phase='original-recorded-hero-handler-prefix'
        def constructor(engine,address,size,user):
            if state['constructorEntered']:raise ValueError('More than one original hero constructor entered')
            state['constructorEntered']=True
            pointer=engine.reg_read(r.UC_X86_REG_RDI);ret=n.q(engine.reg_read(r.UC_X86_REG_RSP))
            capture={'unit':pointer,'allocationBytes':n.allocations.get(pointer),'constructorRva':0x154c10,'originalCallerReturnRva':ret-n.base}
            if capture['allocationBytes']!=0x49a0:raise ValueError('Original concrete hero allocation differs')
            captures.append(capture)
            def returned(engine,address,size,user):
                book=pointer+0x2850;slot_pointer=n.q(book+0xae0+51*8)
                if n.q(pointer)!=n.base+0x22f9ac8 or n.allocations.get(slot_pointer)!=0x150 or n.q(slot_pointer)!=n.base+0x235a078:raise ValueError('Complete original concrete hero/slot51 class differs')
                capture.update(book=book,slot51=slot_pointer,slot51RangeHex=bytes(n.u.mem_read(slot_pointer+0x8c,4)).hex(),slot51BytesHex=bytes(n.u.mem_read(slot_pointer,0x150)).hex(),networkIdAtConstructorReturn=n.u32(pointer+0x78))
                if capture['slot51RangeHex']!='00000000':raise ValueError('Original cold slot51 range is not+0')
                state['constructorReturned']=True;engine.emu_stop()
            n.u.hook_add(unicorn.UC_HOOK_CODE,returned,begin=ret,end=ret)
        n.u.hook_add(unicorn.UC_HOOK_CODE,constructor,begin=n.base+0x154c10,end=n.base+0x154c10)
        n.u.mem_write(0x10200000,heap)
        n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack']);n.u.reg_write(r.UC_X86_REG_RDI,0);n.u.reg_write(r.UC_X86_REG_RSI,0x10200000)
        at=n.base+0x6e8f40
        for _ in range(8):
            n.u.emu_start(at,ADDRESSES['stop'],count=5000000);at=n.u.reg_read(r.UC_X86_REG_RIP)
            if state['constructorReturned']:break
            if at==ADDRESSES['stop']:state['handlerReturned']=True;break
        if not state['constructorReturned']:raise ValueError('Original handler did not reach bounded constructor return')
    except Exception as error:
        boundary={'kind':type(error).__name__,'message':str(error),'phase':phase,'rva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base,'registers':{name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name)) for name in ['RDI','RSI','RAX','RSP']}}
    paths={Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),*[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object,Control]],*[Path(inspect.getfile(fn)) for fn in [initialize_hero_client_types,initialize_product_configuration,initialize_mode_dependency_types,initialize_navgrid_world]],Path(_module.__file__)}
    for path in paths:fixture.raw(path)
    for path,digest in fixture.inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Recorded prefix source drifted')
    output=fixture.cache/'research/recorded-slot-constructor-prefix-native-v35.json'
    result={'schema':1,'kind':'actual-recorded-hero-to-cold-slot-constructor-prefix','artifactVersion':35,'inputs':fixture.inputs,'sourcePacket':{'key':key,'sample':sample,'payloadSha256':observed['payloadSha256'],'entityId':entity,'slot':slot,'character':'Akshan','originalByte17':packet[17]},'setup':setup,'state':state,'captures':captures,'boundary':boundary,'originalBlocks':list(n.blocks.values()),'scope':{'actualPacketAndOriginalHandlerPrefix':True,'originalConstructorNotCalledByHost':True,'originalNavgridReadinessNotSupplied':True,'optionalNavgridOwnerAbsent':True,'stoppedBeforeHandlerContinuation':True,'actualInitialSnapshotRestorationEstablished':False,'actualCasterRangeAtMissileCreationEstablished':False,'activeFamilyAdmissionChanged':False}}
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'state':state,'captures':captures,'boundary':boundary}))
    if boundary:raise SystemExit(1)


if __name__=='__main__':main()
