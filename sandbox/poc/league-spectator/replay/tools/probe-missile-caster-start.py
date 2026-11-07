"""Original caster-root/terrain start with exact decoded-world query inputs.

The AI is an originally constructed and registered owned control. Its root is
supplied from the shared replay world view, not recovered native match state.
An independently original constructed installed rig proves the empty key miss.
"""
import argparse
import json
import struct
import sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from animation_rig_native import NativeAnimationRig,POSE,OUTPUT
from ai_hero_stack_native import NativeHeroStackProbe
from ai_client_native import NativeAIClientInputs
from libcpp_shared_native import NativeLibcppSharedOwnership
from ai_hero_type_native import initialize_hero_client_types
from mode_dependency_types_native import initialize_mode_dependency_types
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


class Control(NativeHeroStackProbe,NativeLibcppSharedOwnership,NativeAIClientInputs):
    pass


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path)
    parser.add_argument('client',type=Path)
    args=parser.parse_args()
    fixture=NativeAIUnitFixture(args.cache,args.client,Control)
    n,cache=fixture.native,fixture.cache
    blocks=[]
    for start,end in [(0x874b30,0x874e99),(0x144b3a0,0x144b3f6),(0x20ca4b8,0x20ca4bc)]:
        if n.image[start:end]!=n.source.image[start:end]:raise ValueError('Original source-start bytes differ')
        blocks.append({'startRva':start,'endRva':end,'sha256':sha(n.image[start:end])})
    if struct.unpack_from('<f',n.image,0x20ca4b8)[0]!=100:
        raise ValueError('Original fallback terrain height constant changed')
    raw,read=fixture.raw,fixture.read
    frontier=read(cache/'research/projectile-family-frontier.json')
    for path,digest in frontier['inputs'].items():
        if sha(raw(Path(path)))!=digest:raise ValueError('Current world query provenance changed: '+path)
    reconstruction_path=cache/'research/viewer-root-reconstruction.json'
    if sha(raw(reconstruction_path))!=frontier['inputs'][str(reconstruction_path)]:
        raise ValueError('Captured world-query replay input changed')
    report=read(cache/'research/viewer-root-reconstruction.json')['report']
    scene=read(cache/'public/latest-scene/manifest.json')
    heights=raw(cache/'public/latest-scene/heights.bin')
    candidates=[row for row in frontier['missiles'] if row['champion']=='Jinx']
    if len(candidates)!=3:raise ValueError('Expected three actual untracked FixedTime records')
    actor=scene['champions']['jinx/2']
    catalog=read(cache/'public/latest-scene'/actor['animationCatalog'])
    rig_path=Path(actor['animationCatalog']).parent/'model.skl'
    rig_raw=raw(cache/'public/latest-scene'/rig_path)
    rig=NativeAnimationRig(cache/'public/decoder-16.21-macos',args.client)
    rig_observation=rig.prepare(rig_raw,catalog['joints'])
    if any(j['resolvedBoneKey']==0 for j in rig_observation['joints']):
        raise ValueError('Empty source key must be absent from exact installed rig')
    rig.u.mem_write(OUTPUT,b'\xa5'*40)
    rig.call(0x157f5d0,{r.UC_X86_REG_RDI:POSE,r.UC_X86_REG_RSI:0,r.UC_X86_REG_RDX:OUTPUT})
    if rig.u.reg_read(r.UC_X86_REG_AL) or bytes(rig.u.mem_read(OUTPUT,40))!=b'\xa5'*40:
        raise ValueError('Original installed rig empty-key query did not miss without modifying output')
    n.initialize_character_types()
    n.call(0x665f24,{},0x665f51)
    n.initialize_audio_facade();n.initialize_ui_data_prefix()
    initialize_product_configuration(n,'LoL')
    initialize_mode_dependency_types(n)
    initialize_hero_client_types(n,reuse_existing=True)
    unit=n.allocate(0x4aa0)
    n.call(0x154c10,{r.UC_X86_REG_RDI:unit})
    world=n.allocate(0x268)
    n.call(0x54a4d0,{r.UC_X86_REG_RDI:world})
    n.put(unit+0x78,'I',candidates[0]['ownerId'])
    n.call(0x549f30,{r.UC_X86_REG_RDI:world,r.UC_X86_REG_RSI:unit})
    internal=n.u32(unit+0x20)
    if n.q(n.base+0x24722c0)!=world or internal==0:
        raise ValueError('Original world local-id registration differs')
    manager,grid,height_at=n.allocate(0x20),n.allocate(0x200),n.allocate(len(heights))
    n.put(manager+8,'Q',grid);n.put(n.base+0x246c948,'Q',manager)
    n.put(grid+0xbc,'fff',*scene['map']['min']);n.put(grid+0xc8,'fff',*scene['map']['max'])
    n.put(grid+0xf8,'Q',height_at)
    dimensions=scene['map']['heightGrid']
    n.put(grid+0x100,'IIff',dimensions['x'],dimensions['z'],*dimensions['step'])
    n.u.mem_write(height_at,heights)
    cast,descriptor,zero,string=[n.allocate(0x200) for _ in range(4)]
    n.call(0x14c2d60,{r.UC_X86_REG_RDI:string,r.UC_X86_REG_RSI:n.allocate_text('')})
    records={row['sequence']:row for row in report['missiles']}
    cases=[]
    visits=[]
    def branch(engine,address,size,user):
        visits.append(address-n.base)
        if address==n.base+0x874dd0 and engine.reg_read(r.UC_X86_REG_R15)!=unit:
            raise ValueError('Original checked caster conversion did not select the registered hero')
    for address in [0x874dd0,0x874e50]:
        n.u.hook_add(unicorn.UC_HOOK_CODE,branch,begin=n.base+address,end=n.base+address)
    for row in candidates:
        source=records[row['sequence']]
        if (source['cast']['forceRecordedSourcePosition'] or row['sourceBoneName']!='' or
                source['cast']['ownerId']!=candidates[0]['ownerId'] or
                row['startInitialization']['settings']!={'castType':1,'particleStartOffset':[0,0,0]}):
            raise ValueError('Exact nonforced empty-bone source branch required')
        for offset in [[0,0,0],[17,33,-29]]:
            root=[float(value+delta) for value,delta in zip(row['casterView']['position'],offset)]
            n.put(unit+0x15c,'fff',*root)
            n.u.mem_write(cast,bytes(0x200));n.put(cast+0x98,'I',internal)
            n.put(cast+0xc8,'fff',*source['cast']['sourcePosition'])
            n.put(cast+0xd4,'fff',*source['cast']['targetPosition'])
            n.put(cast+0x150,'B',0)
            n.call(0x874b30,{r.UC_X86_REG_RDI:descriptor,r.UC_X86_REG_RSI:0,r.UC_X86_REG_RDX:string})
            visits.clear()
            n.call(0x874b60,{r.UC_X86_REG_RDI:descriptor,r.UC_X86_REG_RSI:cast,r.UC_X86_REG_RDX:0,r.UC_X86_REG_RCX:zero})
            if visits!=[0x874dd0]:raise ValueError('Original caster branch not selected: '+repr(visits))
            cases.append({'sequence':row['sequence'],'sourceEventId':row['sourceEventId'],'time':row['time'],
                'ownerId':source['cast']['ownerId'],'settings':row['startInitialization']['settings'],'sourceBoneName':row['sourceBoneName'],
                'suppliedWorldRoot':root,'rootOffsetControl':offset,'sourceQuery':row['casterView'],
                'recordedCastSource':source['cast']['sourcePosition'],'recordedCreationPosition':source['creationPosition'],
                'position':list(struct.unpack('<fff',n.u.mem_read(descriptor,12))),
                'planeHeightOffset':struct.unpack('<f',n.u.mem_read(descriptor+12,4))[0],
                'attachmentHeightOffset':struct.unpack('<f',n.u.mem_read(descriptor+16,4))[0],
                'originalBranchVisits':list(visits)})
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):raw(Path(path))
    raw(Path(__file__));raw(args.client)
    for path,digest in fixture.inputs.items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Caster start proof input changed: '+path)
    output=cache/'research/missile-caster-start-native.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-caster-terrain-empty-bone-start-control','build':report['build'],
        'protocol':report['protocol'],'inputs':fixture.inputs,'cases':cases,
        'originalBlocks':blocks,'originalTerrainAugment':100,
        'rigEmptyKey':{'rigPath':rig_path.as_posix(),'joints':len(rig_observation['joints']),'originalConstructor':True,
            'resolvedBoneKeys':[j['resolvedBoneKey'] for j in rig_observation['joints']],
            'lookupRva':0x157f5d0,'key':0,'found':False,'outputUnchanged':True},
        'scope':{'fullStartHelperExecuted':True,'originalAiConstructorAndWorldRegistration':True,
            'worldRootSuppliedFromReplayAdapter':True,'currentWorldProducerCertified':False,'nativeMatchRootRecovered':False,
            'originalFullRenderModelProducer':False,'liveNativeModelReadyEstablished':False,
            'nativeWorldPixelParity':False,'runtimeAdmissionChanged':False}},indent=2))
    print(json.dumps({'output':str(output),'cases':len(cases),'rigJoints':len(rig_observation['joints']),'positions':[c['position'] for c in cases]}))


if __name__=='__main__':main()
