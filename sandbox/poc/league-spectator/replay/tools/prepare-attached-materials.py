"""Observe exact native attached-mesh material rules with supplied environments."""
import argparse, inspect, json, struct, subprocess, sys
from collections import Counter
from pathlib import Path
from attached_material_native import NativeAttachedMaterial
from vfx_spawn_native import sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['cache','client','output']:p.add_argument(name,type=Path)
    p.add_argument('--start',type=int,default=0);p.add_argument('--limit',type=int)
    a=p.parse_args();cache=a.cache.resolve();decoder=cache/'public/decoder-16.21-macos'
    source=cache/'public/latest-attached-mesh/package.json';source_raw=source.read_bytes();meta=json.loads(source_raw)
    if sha(source_raw)!='cb8d9ae2eb157b497231812abc24f54deba55483c725bf8aa6a04d0524b3697d':raise ValueError('Unmatched attached-mesh package')
    entries=list(meta['entries'].items())
    if a.limit is None:
        if a.start:raise ValueError('Worker start requires limit')
        parts=a.output.with_name(a.output.stem+'-parts');parts.mkdir(parents=True,exist_ok=True)
        merged=None;counts=Counter();emitters=[];blocks={};inputs={};children=[]
        for start in range(0,len(entries),60):
            out=parts/f'{start:04d}.json';limit=min(60,len(entries)-start)
            subprocess.run([sys.executable,str(Path(__file__).resolve()),str(cache),str(a.client),str(out),'--start',str(start),'--limit',str(limit)],check=True)
            b=out.read_bytes();child=json.loads(b)
            if child['counts']['emitters']!=limit:raise ValueError('Incomplete material worker')
            if merged is None:merged=child
            elif any(child[k]!=merged[k] for k in ['sources','attachedMeshPackageSha256','scope','build','protocol','decoderImageSha256','sliceSha256']):raise ValueError('Material worker boundary changed')
            counts.update(child['counts']);emitters.extend(child['emitters'])
            for name,h in child['inputs'].items():
                if name in inputs and inputs[name]!=h:raise ValueError('Material input changed between workers')
                inputs[name]=h
            for block in child['originalBlocks']:
                key=(block['rva'],block['size'])
                if key in blocks and blocks[key]!=block:raise ValueError('Native material block changed')
                blocks[key]=block
            children.append({'file':str(out.resolve()),'sha256':sha(b),'start':start,'emitters':limit})
        merged.update(counts=dict(counts),emitters=emitters,inputs=inputs,originalBlocks=[blocks[k]for k in sorted(blocks)],childProcesses=children)
        merged['scope']['partialCorpus']=False
        a.output.write_text(json.dumps(merged,indent=2,allow_nan=False),encoding='utf-8')
        print(json.dumps({'counts':dict(counts),'blocks':len(blocks),'sha256':sha(a.output.read_bytes())}),flush=True);return
    if not 0<a.limit<=60 or not 0<=a.start<len(entries):raise ValueError('Material engine lifetime bound exceeded')
    n=NativeAttachedMaterial(decoder,a.client);counts=Counter();observations=[]
    inputs={str(source):sha(source_raw)}
    for path in [decoder/'profile.json',decoder/'image.bin',a.client.resolve()]:inputs[str(path)]=sha(path.read_bytes())
    for key,ref in entries[a.start:a.start+a.limit]:
        path=decoder/ref['postloadGraphFile'];b=path.read_bytes()
        if sha(b)!=ref['postloadGraphSha256']:raise ValueError('Attached material graph changed')
        inputs[str(path)]=sha(b);state=json.loads(b);n.prepare_attached(state)
        parameters=n.parameters();samplers=n.samplers();erosion=n.erosion_parameters(.5)
        obj=bytes.fromhex(state['objectHex'])
        defined=sum(1<<bit for bit,offset in enumerate([0x230,0x48,0x40])if struct.unpack_from('<Q',obj,offset)[0])
        base={'pass':0,'featuresEnabled':True,'resourceMask':0,'systemFogMode':0,'graphics34b':False,'graphics29c':0}
        cases=[dict(base,resourceMask=mask)for mask in range(8)]
        cases += [dict(base,resourceMask=defined,**extra)for extra in
            [{'pass':value}for value in range(1,7)]+[{'featuresEnabled':False},{'systemFogMode':1},{'graphics34b':True,'graphics29c':2}]]
        probes=[]
        for flag in [None,False,True]:
            for env in cases:
                selection=n.select_attached(env,flag);render=n.render_state(env['pass'])
                probes.append({'input':dict(env,resolvedResourceFlag95=flag),'selection':selection,'renderState':render})
                counts['shaderSelections']+=1;counts['renderStates']+=1
        n.finish();counts['assetPreservationChecks']+=1;counts['emitters']+=1
        counts['parameters']+=len(parameters);counts['samplers']+=len(samplers);counts['erosionEmitters']+=bool(erosion)
        observations.append({'key':key,'effectId':ref['effectId'],'emitterIndex':ref['emitterIndex'],
            'graphFile':ref['postloadGraphFile'],'graphSha256':ref['postloadGraphSha256'],
            'sourceDefinitionSha256':ref['sourceDefinitionSha256'],'definedObjectMask':defined,
            'parameters':parameters,'samplers':samplers,'erosionAtSuppliedDrive':.5 if erosion else None,
            'erosionParameters':erosion,'probes':probes})
    dependencies={Path(inspect.getfile(cls))for cls in NativeAttachedMaterial.__mro__ if cls is not object}
    dependencies.update([Path(__file__),Path(__file__).with_name('macho.py')])
    sources={path.name:sha(path.read_bytes())for path in sorted(dependencies)}
    out={'schema':1,'kind':'native-attached-material-observations','build':meta['build'],'protocol':meta['protocol'],
        'decoderImageSha256':meta['decoderImageSha256'],'sliceSha256':meta['sliceSha256'],
        'attachedMeshPackageSha256':sha(source_raw),'sources':sources,'inputs':inputs,
        'originalBlocks':sorted(n.material_blocks.values(),key=lambda b:b['rva']),
        'counts':dict(counts),'emitters':observations,
        'scope':{'partialCorpus':True,'maximumEmittersPerNativeEngine':60,'completePostloadedAssetRead':True,
            'assetBytesUnchanged':True,'originalPrimitiveTypeRetained':True,'nativeShaderSelectionExecuted':True,
            'nativeParameterFragmentsExecuted':True,'nativeRenderStateFragmentsExecuted':True,
            'resolvedResourceByte95Supplied':True,'resourceCacheLookupExecuted':False,'meshResourceProducerTraced':False,
            'externalMathCalls':0,'resourceAcquisition':False,'materialFactory':False,'meshPoseBindingExecuted':False,
            'gpuSubmitted':False,'browserRun':False,'mainViewerIntegrated':False,'referencePixelsCompared':False,
            'environment':'Pass, resource predicates, raw resource byte +0x95, scene/graphics fields and erosion drive are controlled inputs. No claim of recorded runtime values.'}}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(out,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'start':a.start,'counts':dict(counts)}),flush=True)


if __name__=='__main__':main()
