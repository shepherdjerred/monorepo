"""Exercise decoded detached creation requests through the complete factory.

Original packet vectors/scalars/flags and ordered context identities are retained.
Clock/seed are supplied preview policy. No retirement, attachment or match-level
resource overlay is inferred, and unsupported roots remain complete-root gaps.
"""
import argparse
import collections
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import time
import struct
import traceback
from unicorn import x86_const as r
from replay_descriptor_native import NativeReplayWorldDescriptors,ReplayDescriptorLibraries
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_parent_frames_native import f32
from vfx_spawn_native import sha

spec=importlib.util.spec_from_file_location('replay_descriptor_frames',Path(__file__).with_name('observe-parent-frames.py'))
frames=importlib.util.module_from_spec(spec);spec.loader.exec_module(frames)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','angle']:p.add_argument(name,type=Path)
    p.add_argument('--effect');p.add_argument('--limit-requests',type=int);args=p.parse_args()
    fixture=NativeVfxFixture(args.cache);libraries=ReplayDescriptorLibraries(fixture)
    report=fixture.read(fixture.cache/'research/latest-semantics-effects.json')
    resolver_package=fixture.read(fixture.assets/'latest-effect-resolvers/package.json')
    maps={a['contextIdentity']:a for a in resolver_package['actors']}
    if (report['build']!=resolver_package['build'] or report['protocol']!=resolver_package['protocol'] or
            len(report['effectDescriptors'])!=len(report['effectCreations'])):raise ValueError('Matching decoded request stream required')
    groups={};admission=[];gaps=collections.Counter()
    for creation,d in zip(report['effectCreations'],report['effectDescriptors']):
        if (creation['creationSequence']!=d['creationSequence'] or creation['entityId']!=d['entityId'] or
                creation['time']!=d['time'] or creation['resourceKey']!=d['resourceKey']):raise ValueError('Decoded creation/descriptor join differs')
        reason=None;selected=None
        if any(d[k] for k in ['resourceContextEntityId','attachmentEntityId','lookup14EntityId','lookupA8EntityId']):reason='requires-live-entity-registry'
        elif not d['resourceKey']:reason='requires-alternate-name-resolution'
        elif any(identity not in maps for identity in d['unresolvedAuxiliaryContextIds']):reason='requires-unprepared-character-context'
        else:
            for identity in d['unresolvedAuxiliaryContextIds']:
                actor=maps[identity]
                if actor['status']!='native-resource-map-loaded':reason='requires-runtime-context-resource-getter';break
                row=next((v for v in actor['rows'] if v['key']==d['resourceKey']),None)
                if row is not None:
                    resource=libraries.effects['actors'][actor['actorKey']]['resources'][format(d['resourceKey'],'08x')]
                    if resource['status']!='prepared-definition':reason='requires-nonprepared-authored-reference'
                    else:selected=resource['effectId']
                    break
            if selected is None and reason is None:reason='requires-global-resource-selection'
        admission.append({'creationSequence':d['creationSequence'],'status':reason or 'detached-authored-candidate','effectId':selected})
        if reason:gaps[reason]+=1;continue
        key=(selected,tuple(d['unresolvedAuxiliaryContextIds']))
        groups.setdefault(key,[]).append(d)
    selected_groups=[(key,requests) for key,requests in groups.items() if not args.effect or key[0]==args.effect]
    if not selected_groups and args.effect:raise ValueError('No matching decoded detached requests; live resource owners cannot be erased')
    device=GraphicsTextureDevice(args.angle);cases=[];blocks={};caches=[];began=time.monotonic()
    cache_directory=fixture.assets/'latest-replay-descriptor-caches';cache_directory.mkdir(exist_ok=True)
    try:
        for (effect_id,identities),requests in selected_groups:
            n=NativeReplayWorldDescriptors(fixture.assets/'decoder-16.21-macos',args.client,device=device)
            shader=GraphicsShaderCatalog(fixture.assets/'latest-shaders',device);n.shader_catalog=shader
            texture_start=len(device.textures);case={'effectId':effect_id,'contextIdentities':list(identities),'status':'boundary',
                'requestedSequences':[d['creationSequence'] for d in requests],'requests':[]}
            try:
                # Complete local fixup evidence is already available for all
                # champion libraries. Do not retry a known global-asset gap for
                # every request, or admit its partially fixed map.
                for identity in dict.fromkeys(identities):
                    actor=libraries.by_identity[identity]['actorKey']
                    path=fixture.cache/'research/effect-links-native'/('actor-'+actor.replace('/','-')+'.json')
                    links=fixture.read(path)
                    for name,digest in links['sources'].items():
                        if sha(fixture.raw(Path(__file__).with_name(name)))!=digest:raise ValueError('Typed link producer changed')
                    for path,digest in links['inputs'].items():
                        if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Typed link input changed')
                    if links['fixups']['status']!='typed-local-links-resolved':
                        raise ValueError('Complete authored library requires global asset fixups: '+actor)
                warm=fixture.activate(n,effect_id,12345,{'ticks':[1000000000]*3,'mode':0,'timebase':[1,1]},0,False)
                n.own_parent(warm['object']);n.suspend_parent(True)
                n.initialize_context_reflection();installed=libraries.install(n,identities,effect_id)
                case['libraries']=installed;case['world']=n.initialize_descriptor_factory()
                case['frameInput']=n.initialize_replay_frame()
                # The typed library owns a heap root, while the initial graphics
                # preparation used the fixed-address graph root. Warm the heap
                # root through the actual factory before retaining a checkpoint.
                # All of these inputs come from the authored build catalog.
                owner=next((v for v in installed['contexts'].values() if
                    'champions/'+v['context']['name'].lower()+'/'+str(v['context']['skinId'])==effect_id.rsplit('/',1)[0]),None)
                if owner is None:raise ValueError('Selected authored root has no installed owner context')
                actor=libraries.effects['actors'][effect_id.rsplit('/',1)[0]]
                warm_key=min(int(key,16) for key,v in actor['resources'].items() if v.get('effectId')==effect_id)
                warm_data=bytearray(0xc0);struct.pack_into('<I',warm_data,8,warm_key)
                struct.pack_into('<I',warm_data,0x48,0xb0);struct.pack_into('<2f',warm_data,0x78,1,1)
                warm_descriptor={'resourceContextEntityId':0,'attachmentEntityId':0,'lookup14EntityId':0,'lookupA8EntityId':0,
                    'descriptorHex':warm_data.hex(),'resourceKey':warm_key,'packetVectorsResolved':True,
                    'unresolvedAuxiliaryContextIds':[owner['context']['identity']]}
                n.supply_clock_inputs([1000000000]*3,0,[1,1]);n.set_random_seed(12345)
                case['staticOwnedRootWarm']=n.create_decoded_detached(warm_descriptor,installed)
                if case['staticOwnedRootWarm']['status']!='decoded-descriptor-created':raise ValueError('Original owned-root resource warm failed')
                n.suspend_parent(True)
                # Export static build resources before supplying any actual
                # replay clock, seed, packet descriptor or creation sequence.
                tag=effect_id.replace('/','-')+'-'+sha(json.dumps(sorted(set(identities)),separators=(',',':')).encode())[:16]
                directory=cache_directory/tag;directory.mkdir(exist_ok=True)
                warmed={**warm,'object':case['staticOwnedRootWarm']['object'],
                    'parent':case['staticOwnedRootWarm']['ownership']['parent']}
                cache_ref=frames.export_cache(n,warmed,frames.CAMERA,directory)
                cache_path=directory/cache_ref['file'];cache_record=json.loads(cache_path.read_bytes())
                cache_record['replayDescriptor']={'contexts':installed['contexts'],'selectedDefinition':installed['selectedDefinition'],
                    'preparedRootCopy':installed['preparedRootCopy'],'frameInput':case['frameInput'],'world':case['world'],
                    'warmOwnership':case['staticOwnedRootWarm']['ownership'],
                    'scope':{'completeAuthoredMaps':True,'typedLocalLinksResolved':True,'containsReplayEvents':False,
                        'containsDecodedDescriptors':False,'containsReplayClockInputs':False,'controlledCameraVolume':True}}
                encoded=json.dumps(cache_record,indent=2).encode();cache_path.write_bytes(encoded)
                cache_ref.update(sha256=sha(encoded),bytes=len(encoded),directory=tag)
                case['cache']=cache_ref
                checkpoint=n.checkpoint_parent()
                def observe(d):
                    n.restore_parent(checkpoint)
                    ticks=round(d['time']*1000000000)
                    clock={'ticks':[ticks]*3,'mode':0,'timebase':[1,1]}
                    n.supply_clock_inputs(clock['ticks'],clock['mode'],clock['timebase']);n.set_random_seed(9876)
                    created=n.create_decoded_detached(d,installed)
                    result={'creationSequence':d['creationSequence'],'entityId':d['entityId'],'time':d['time'],
                        'clockInput':clock,'suppliedSeed':9876,'descriptor':d,'creation':created,'frames':[]}
                    if created['status']=='decoded-descriptor-created':
                        for tick in range(1,7):
                            # The native parent origin can precede receipt by
                            # the decoded catch-up amount. Presentation samples
                            # start after the recorded request, not that origin.
                            f=n.tick_replay_frame(f32(d['time']+tick/60),20)
                            f['geometry']=n.render_parent(frames.CAMERA);f['tick']=tick;result['frames'].append(f)
                    result['finalCpuWorldSha256']=n.parent_memory_digest();return result
                chosen=requests[:args.limit_requests] if args.limit_requests else requests
                for d in chosen:
                    result=observe(d);case['requests'].append(result);repeated=observe(d)
                    if result!=repeated:raise ValueError('Restoring the original replay request changed factory/state/geometry')
                    result['wholeRequestRestoreCompared']=True
                n.release_parent_checkpoint(checkpoint)
                case['status']='decoded-requests-created-and-framed' if all(v['creation']['status']=='decoded-descriptor-created' for v in case['requests']) else 'native-null-factory-results'
                if case['status']=='decoded-requests-created-and-framed':caches.append(cache_ref)
            except Exception as error:
                ip=n.u.reg_read(r.UC_X86_REG_RIP)
                case.update(error=str(error),errorType=type(error).__name__,traceback=traceback.format_exc(),
                    instructionRva=ip-n.base if n.base<=ip<n.base+len(n.image) else None)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path)))!=digest:raise ValueError('Replay factory shader input changed')
                if n.material_backend is not None:n.material_backend.close()
                n.mesh_backend.close();shader.close()
                for handle in device.textures[texture_start:]:device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'effectId':effect_id,'status':case['status'],'requests':len(case['requests']),
                'error':case.get('error'),'elapsedSeconds':time.monotonic()-began}),flush=True)
        sources={Path(__file__),Path(frames.__file__),Path(inspect.getfile(ReplayDescriptorLibraries)),Path(inspect.getfile(NativeVfxFixture)),
            Path(inspect.getfile(GraphicsTextureDevice)),Path(inspect.getfile(GraphicsShaderCatalog)),Path(__file__).with_name('parse-latest-assets.py')}
        sources.update(Path(inspect.getfile(c)) for c in NativeReplayWorldDescriptors.__mro__ if c is not object)
        counts={'decodedRequests':len(admission),'detachedCandidates':sum(len(v) for v in groups.values()),
            'candidateRoots':len(set(k[0] for k in groups)),'requestedCohorts':len(selected_groups),
            'returningCohorts':sum(c['status']=='decoded-requests-created-and-framed' for c in cases),
            'createdRequests':sum(r['creation']['status']=='decoded-descriptor-created' for c in cases for r in c['requests']),
            'frames':sum(len(r['frames']) for c in cases for r in c['requests']),
            'wholeRequestRestores':sum(bool(r.get('wholeRequestRestoreCompared')) for c in cases for r in c['requests']),
            'preparedCaches':len(caches)}
        result={'schema':1,'kind':'native-decoded-detached-replay-descriptor-observations','build':report['build'],'protocol':report['protocol'],
            'replaySha256':report['replaySha256'],'inputs':fixture.inputs,'sources':{p.name:sha(p.read_bytes()) for p in sorted(sources)},
            'originalBlocks':list(blocks.values()),'camera':frames.CAMERA,'admission':admission,'gaps':dict(gaps),'cases':cases,'counts':counts,
            'scope':{'partialSelection':bool(args.effect or args.limit_requests),'decodedDescriptorFieldsRetained':True,
                'completeAuthoredMapsAndTypedFixups':bool(caches),'originalCompleteFactoryExecuted':bool(counts['createdRequests']),'suppliedClockSeedAndCamera':True,
                'allFourEntityReferenceFieldsRequiredZero':True,
                'nonzeroUnresolvedWorldLookupsRejected':True,'presentationTimeStartsAfterRequest':True,
                'originalObjectSyncAndVisibilityScheduler':True,
                'attachmentEntitiesResolved':False,'removalRetirementApplied':False,'wasmExecuted':False,'browserExecuted':False,'referenceCompared':False}}
        path=fixture.cache/('research/replay-descriptors-native-partial.json' if args.effect or args.limit_requests else 'research/replay-descriptors-native.json')
        encoded=json.dumps(result,indent=2).encode();path.write_bytes(encoded)
        catalog={'schema':1,'kind':'prepared-replay-descriptor-parent-caches','build':report['build'],'protocol':report['protocol'],
            'decoderImageSha256':report['decoderImageSha256'],'observationSha256':sha(encoded),'caches':caches,
            'scope':{'staticBuildDataOnly':True,'containsReplayEvents':False,'containsDecodedDescriptors':False,
                'portableBrowserGraphicsHandles':False,'partialPreparation':bool(args.effect or args.limit_requests)}}
        (cache_directory/('package-partial.json' if args.effect or args.limit_requests else 'package.json')).write_text(json.dumps(catalog,indent=2),encoding='utf-8')
        print(json.dumps({'output':str(path),'counts':counts}))
    finally:device.close()


if __name__=='__main__':main()
