"""Compile original initial attached-mesh resource decisions from static assets."""
import argparse, inspect, json
from collections import Counter
from pathlib import Path
from attached_resource_native import NativeAttachedResource,BLOCKS
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client']:p.add_argument(name,type=Path)
    a=p.parse_args();cache=a.cache.resolve();decoder=cache/'public/decoder-16.21-macos';inputs={}
    def raw(path):
        b=path.read_bytes();inputs[str(path.resolve())]=sha(b);return b
    def read(path):return json.loads(raw(path))
    attached=read(cache/'public/latest-attached-mesh/package.json');effects=read(cache/'public/latest-effects/manifest.json')
    materials=read(cache/'research/attached-materials-native.json');profile=read(decoder/'profile.json');image=raw(decoder/'image.bin')
    if inputs[str((cache/'public/latest-attached-mesh/package.json').resolve())]!='cb8d9ae2eb157b497231812abc24f54deba55483c725bf8aa6a04d0524b3697d' or sha(image)!=profile['decoderImageSha256'] or attached['decoderImageSha256']!=sha(image) or materials['scope']['partialCorpus']:raise ValueError('Unmatched initial mesh inputs')
    env={'pass':0,'featuresEnabled':True,'resourceMask':0,'systemFogMode':0,'graphics34b':False,'graphics29c':0}
    baseline={f"{e['effectId']}:{e['emitterIndex']}":next(p['selection']for p in e['probes']if p['input']==dict(env,resolvedResourceFlag95=None))for e in materials['emitters']}
    entries={};observations=[];counts=Counter();blocks={};n=None;definitions={}
    for index,(key,ref) in enumerate(attached['entries'].items()):
        if index%60==0:n=NativeAttachedResource(decoder,a.client)
        b=raw(decoder/ref['postloadGraphFile'])
        if sha(b)!=ref['postloadGraphSha256']:raise ValueError('Initial mesh post-load graph differs')
        state=json.loads(b)
        if ref['effectId']not in definitions:
            definition=effects['definitions'][ref['effectId']];b=raw(cache/'public/latest-effects'/definition['file'])
            if sha(b)!=definition['sha256']:raise ValueError('Initial mesh authored definition differs')
            definitions[ref['effectId']]=json.loads(b)
        authored=definitions[ref['effectId']]['definition']['complexEmitterDefinitionData'][ref['emitterIndex']]['primitive'].get('mMesh',{})
        result=n.resolve_mesh(state);again=n.resolve_mesh(state)
        if result!=again:raise ValueError('Repeated native initial mesh load differs')
        expected_path=authored.get('mSimpleMeshName')
        if expected_path!=result['externalMeshPath']:raise ValueError('Native initial mesh path differs from authored value')
        if result['status']=='no-authored-mesh-resource':
            selection=n.initial_material(env)
            if selection!=baseline[key]:raise ValueError('Native-produced initial resource changed prior material selection')
            counts['resolvedInitialSelections']+=1;counts['noAuthoredMesh']+=1
        else:selection=None;counts['externalFactoryBoundaries']+=1
        counts['emitters']+=1;counts['initializers']+=2;counts['prefixes']+=2;counts['repeatedLoads']+=1;counts['assetPreservationChecks']+=2
        entries[key]={'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],'actor':ref['actor'],
            'postloadGraphSha256':ref['postloadGraphSha256'],'sourceDefinitionSha256':ref['sourceDefinitionSha256'],
            'status':result['status'],'externalMeshPath':result['externalMeshPath']}
        observations.append({'key':key,'result':result,'baselineEnvironment':env,'nativeSelection':selection})
        for block in n.blocks.values():
            identity=(block['rva'],block['size'])
            if identity in blocks and blocks[identity]!=block:raise ValueError('Native initial mesh instructions changed')
            blocks[identity]=block
    scope={'initialResourcePrefixOnly':True,'nativeInitializerExecuted':True,'nativePathRoutingExecuted':True,
        'completePostloadedAssetRead':True,'assetBytesUnchanged':True,'resourceAbsenceDerivedFromAsset':True,
        'externalFactoryExecuted':False,'nativeOwnerLookupExecuted':False,'meshResourceByte95ProducerTraced':False,
        'laterResourceMutationVerified':False,'meshPoseBindingExecuted':False,'effectLifecycleReconstructed':False,
        'browserRun':False,'mainViewerIntegrated':False,'referencePixelsCompared':False}
    package={'schema':1,'kind':'native-initial-attached-mesh-resources','build':attached['build'],'protocol':attached['protocol'],
        'sliceSha256':attached['sliceSha256'],'decoderImageSha256':attached['decoderImageSha256'],
        'attachedMeshPackageSha256':inputs[str((cache/'public/latest-attached-mesh/package.json').resolve())],
        'effectsManifestSha256':inputs[str((cache/'public/latest-effects/manifest.json').resolve())],
        'entries':entries,'sourceBlocks':[{'startRva':x,'endRva':y,'sha256':sha(image[x:y])}for x,y in BLOCKS],'scope':scope}
    target=cache/'public/latest-attached-resources';target.mkdir(exist_ok=True);b=json.dumps(package,indent=2).encode();(target/'package.json').write_bytes(b)
    dependencies={Path(inspect.getfile(cls))for cls in NativeAttachedResource.__mro__ if cls is not object};dependencies.update([Path(__file__),Path(__file__).with_name('macho.py')])
    proof={'schema':1,'kind':'initial-attached-resource-native-observations','packageSha256':sha(b),'inputs':inputs,
        'sources':{p.name:sha(p.read_bytes())for p in sorted(dependencies)},'originalBlocks':[blocks[k]for k in sorted(blocks)],
        'observations':observations,'counts':dict(counts),'scope':scope}
    (cache/'research/attached-resources-native.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps({'packageSha256':sha(b),'counts':dict(counts)}))


if __name__=='__main__':main()
