"""Compile complete attached emitter pool states without changing frozen profiles."""
import argparse,inspect,json
from pathlib import Path
from collections import Counter
from attached_particle_native import NativeAttachedParticles,AttachedParticleAdmissionError
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();decoder=cache/'public/decoder-16.21-macos';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    attached=json.loads(raw(cache/'public/latest-attached-mesh/package.json'));profile=json.loads(raw(decoder/'profile.json'))
    if inputs[str((cache/'public/latest-attached-mesh/package.json').resolve())]!='cb8d9ae2eb157b497231812abc24f54deba55483c725bf8aa6a04d0524b3697d':raise ValueError('Unmatched attached selection package')
    n=NativeAttachedParticles(decoder,a.client);base=n.checked_json('vfx-bound-quads.json','vfxBoundQuadsSha256')
    raw(decoder/'vfx-bound-quads.json');raw(decoder/'image.bin')
    output=cache/'public/latest-attached-particles';(output/'graphs').mkdir(parents=True,exist_ok=True)
    templates=[];rejected=[]
    for key,ref in attached['entries'].items():
        b=raw(decoder/ref['postloadGraphFile'])
        if sha(b)!=ref['postloadGraphSha256']:raise ValueError('Attached pool post-load state differs')
        state=json.loads(b)
        try:g=n.prepare_attached_particles(state)
        except AttachedParticleAdmissionError as error:rejected.append({'key':key,'reason':str(error)});continue
        if g['assetObjectHex']!=state['objectHex']or g['segments'][1]['bytesHex']!=state['heapHex']:raise ValueError('Attached pool asset changed')
        g.update({'build':profile['clientVersion'],'protocol':profile['protocolDigest'],'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],
            'sourceDefinitionSha256':ref['sourceDefinitionSha256'],'postloadGraphSha256':ref['postloadGraphSha256'],'primitiveKind':'attached'})
        b=json.dumps(g,separators=(',',':')).encode();digest=sha(b);(output/'graphs'/f'{digest}.json').write_bytes(b)
        templates.append({**ref,'sha256':digest,'file':f'graphs/{digest}.json','bytes':len(b),'uvFlags':g['uvFlags'],'primitiveKind':'attached'})
    dependencies={Path(inspect.getfile(cls))for cls in NativeAttachedParticles.__mro__ if cls is not object};dependencies.update([Path(__file__),Path(__file__).with_name('macho.py')])
    meta={'schema':1,'kind':'native-attached-particle-pools','build':profile['clientVersion'],'protocol':profile['protocolDigest'],
        'sliceSha256':profile['sliceSha256'],'decoderImageSha256':profile['decoderImageSha256'],'runtimeSha256':base['runtimeSha256'],
        'attachedMeshPackageSha256':inputs[str((cache/'public/latest-attached-mesh/package.json').resolve())],
        'vfxBoundQuadsSha256':profile['vfxBoundQuadsSha256'],'vfxPostloadSha256':profile['vfxPostloadSha256'],'vfxSpawnSha256':profile['vfxSpawnSha256'],'vfxEmitterSha256':profile['vfxEmitterSha256'],
        'frameRva':0x1757f10,'constructorPrefix':[0x1756780,0x1756a26],'primitiveVtableRva':0x23f6d30,'primitiveType':11,
        'maximumParticles':1024,'initializedGlobals':base['initializedGlobals'],'templates':templates,'rejected':rejected,
        'drawAttributeStride':0x2c,'colorInputOffset':4,'erosionInputOffset':0x28,'rootColorOffset':0xe0,'rootBlendOffset':0x14,
        'sourceBlocks':[{'startRva':x,'endRva':y,'sha256':sha(n.image[x:y])}for x,y in [(0x1756780,0x1756a26),(0x1757f10,0x1758a70),(0x175b420,0x175b5f0),(0x23f6d30,0x23f6e78),
            (0x173e143,0x173e161),(0x173efd0,0x173f031),(0x17b5ac0,0x17b5ad3)]],
        'compilerSources':{p.name:sha(p.read_bytes())for p in sorted(dependencies)},'inputs':inputs,
        'counts':{'sourceEmitters':len(attached['entries']),'preparedEmitters':len(templates),'rejectedEmitters':len(rejected)},
        'rejectionCounts':dict(Counter(r['reason']for r in rejected)),
        'scope':{'completePostloadedAsset':True,'assetBytesUnchanged':True,'nativeEmitterPoolUpdates':True,'absentOwnerNativeIdentityFallback':True,
            'sceneScaleColorClockBasisQualitySeedSupplied':True,'multTexturePresenceSuppliedFalse':True,'ownerPoseBindingExecuted':False,
            'meshGeometrySubmitted':False,'fullEffectLifecycleReconstructed':False,'browserRun':False,'mainViewerIntegrated':False,'referencePixelsCompared':False}}
    b=json.dumps(meta,indent=2).encode();(output/'package.json').write_bytes(b);print(json.dumps({'packageSha256':sha(b),'counts':meta['counts'],'rejections':meta['rejectionCounts']}))


if __name__=='__main__':main()
