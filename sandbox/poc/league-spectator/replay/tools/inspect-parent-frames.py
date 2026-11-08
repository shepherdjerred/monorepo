"""Inspect complete-parent native frame/cache evidence against retained inputs."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct
import capstone


def sha(raw):return hashlib.sha256(raw).hexdigest()
def fnv(name):
    value=0x811c9dc5
    for byte in name.lower().encode():value=((value^byte)*0x1000193)&0xffffffff
    return value


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=Path);args=p.parse_args()
    cache=args.cache.resolve();assets=cache/'public';source=cache/'research/parent-frames-native.json'
    raw=source.read_bytes();data=json.loads(raw);checks=Counter()
    if (data['kind']!='complete-native-parent-frame-observations' or data['build']!='16.21.829.8620' or
            data['protocol']!='20e09df23c66b85e' or not data['scope']['partialCorpus'] or data['scope']['wasmCompared'] or
            data['scope']['browserRun'] or data['scope']['mainViewerIntegrated'] or data['scope']['referenceCompared']):
        raise ValueError('Unadmitted parent observation or overstated execution scope')
    for path,digest in data['inputs'].items():
        if sha(Path(path).read_bytes())!=digest:raise ValueError('Parent input changed: '+path)
    for name,digest in data['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=digest:raise ValueError('Parent source changed: '+name)
    profile=json.loads((assets/'decoder-16.21-macos/profile.json').read_bytes())
    image=(assets/'decoder-16.21-macos/image.bin').read_bytes()
    if sha(image)!=data['decoderImageSha256'] or sha(image)!=profile['decoderImageSha256']:raise ValueError('Parent executable image changed')
    for block in data['originalBlocks']:
        at,size=block['rva'],block['size']
        if not 0<=at<at+size<=len(image) or sha(image[at:at+size])!=block['sha256']:
            raise ValueError('Parent original code observation differs')
        checks['originalCodeBlocks']+=1
    types_raw=(assets/'decoder-16.21-macos/vfx-assets.json').read_bytes();types=json.loads(types_raw)['types']
    if sha(types_raw)!=profile['vfxAssetsSha256']:raise ValueError('Original reflection registration package changed')
    complex_field=next(f for f in types['45cd899f']['properties'] if f['hash']==fnv('complexEmitterDefinitionData'))
    disabled_field=next(f for f in types['09cde442']['properties'] if f['hash']==fnv('disabled'))
    dis=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
    predicate=[(i.mnemonic,i.op_str) for i in dis.disasm(image[0x16e918d:0x16e9198],0x16e918d)]
    if predicate!=[('mov','r15, qword ptr [r13]'),('cmp','byte ptr [r15 + 0x10], 0'),('jne','0x16e9180')]:
        raise ValueError('Original disabled-emitter resource filter differs')
    if disabled_field['offset']!=0x10 or disabled_field['type']!=1 or disabled_field['mask']:
        raise ValueError('Original disabled field schema differs')
    fx=json.loads((assets/'latest-effects/manifest.json').read_bytes());systems=json.loads((assets/'latest-vfx-system-assets/package.json').read_bytes())
    quad=json.loads((assets/'latest-complete-quad-gpu/package.json').read_bytes());trail=json.loads((assets/'latest-trail-particles/gpu.json').read_bytes())
    bindings={(e['effectId'],e['emitterIndex']):e for package in [quad,trail] for e in package['emitters']}
    candidates={};definitions={}
    for effect_id,ref in fx['definitions'].items():
        b=(assets/'latest-effects'/ref['file']).read_bytes()
        if sha(b)!=ref['sha256']:raise ValueError('Parent cohort definition differs')
        definition=json.loads(b)['definition'];definitions[effect_id]=definition
        emitters=definition.get('complexEmitterDefinitionData',[])
        if len(emitters)<2 or definition.get('simpleEmitterDefinitionData') or any((effect_id,i) not in bindings for i in range(len(emitters))):continue
        candidates.setdefault(effect_id.split('/')[1],[]).append((len(emitters),effect_id))
    expected=[sorted(v,key=lambda x:(-x[0],x[1]))[0][1] for _,v in sorted(candidates.items())]
    if (len(expected)!=10 or [c['effectId'] for c in data['cases']]!=expected or
            [c['effectId'] for c in data['selection']['cohort']]!=expected or
            data['selection']['candidateRoots']!=sum(map(len,candidates.values()))):
        raise ValueError('Parent observation omits/duplicates/changes the declared selection cohort')
    directory=assets/'latest-parent-frame-caches';package_raw=(directory/'package.json').read_bytes();package=json.loads(package_raw)
    if package['observationSha256']!=sha(raw) or package['sources']!=data['sources'] or len(package['caches'])!=10:
        raise ValueError('Parent resource cache package differs from observation')
    baseline_raw=(cache/'research/vfx-cubemaps-native.json').read_bytes();baseline=json.loads(baseline_raw)
    baseline_proof=json.loads((cache/'research/vfx-cubemaps-inspection.json').read_bytes())
    if baseline_proof['observationSha256']!=sha(baseline_raw) or baseline_proof['mismatchCount']:
        raise ValueError('Parent authored asset baseline lacks matching inspection')
    baseline_cases={c['effectId']:c for c in baseline['cases']}
    vectors={'life':(8,8),'initial':(0x18,0x70),'matrices':(0x28,0x40),'particle':(0x38,0xac),'motion':(0x48,0x24),
        'uv':(0x58,0x20),'multUv':(0x68,0x18),'unknown78':(0x78,0x18),'unknown88':(0x88,0x18),
        'attributes':(0x98,0x2c),'tiling':(0xa8,8),'odometer':(0xb8,4),'ordinal':(0xc8,4)}
    kinds=Counter();disabled_total=0
    for case,ref in zip(data['cases'],package['caches']):
        if case['status']!='frames-returned' or len(case['frames'])!=60:raise ValueError('Parent cohort contains a boundary/incomplete interval')
        effect_id=case['effectId'];definition=definitions[effect_id];authored=definition['complexEmitterDefinitionData']
        disabled=[i for i,e in enumerate(authored) if e.get('disabled',False)];enabled=[i for i in range(len(authored)) if i not in disabled]
        owned=case['ownership'];actors=owned['actors']
        if (owned['nativeDefinitionFieldOffset']!=complex_field['offset'] or owned['nativeDisabledField']!=disabled_field or
                owned['disabledEmitters']!=disabled or [a['emitterIndex'] for a in actors]!=enabled or
                any(a['kind']!='complex' for a in actors)):
            raise ValueError('Parent actor selection differs from original registered disabled field')
        disabled_total+=len(disabled)
        if case['resourceCountsBefore']!=case['resourceCountsAfter'] or case['randomSeed']['input']!=9876 or case['clockInput']['ticks']!=[2000000000]*3:
            raise ValueError('Fresh native parent did not reuse the prepared resources/declared inputs')
        cache_bytes=(directory/ref['file']).read_bytes();prepared=json.loads(cache_bytes)
        if (sha(cache_bytes)!=ref['sha256'] or case['cache']!=ref or prepared['effectId']!=effect_id or
                prepared['decoderImageSha256']!=sha(image) or prepared['warmSeed']['input']!=12345 or
                not prepared['scope']['warmParentSuspended'] or prepared['scope']['portableBrowserGraphicsHandles']):
            raise ValueError('Static native parent resource cache identity differs')
        io=bytearray(0x400000);heap=None;seen=set();patched=bytearray(image)
        for segment in prepared['segments']:
            name=segment['file'];b=(directory/name).read_bytes();at=segment['address']
            if Path(name).name!=name or sha(b)!=segment['sha256'] or len(b)!=segment['bytes'] or at in seen:
                raise ValueError('Parent cache segment bytes/identity differ')
            seen.add(at)
            if at==0x10400000:
                if len(b)!=prepared['nextHeap']-at or not 0<len(b)<=0x1c00000:raise ValueError('Parent cache heap bound differs')
                heap=b
            elif 0x10000000<=at<=0x103ff000 and at%4096==0 and len(b)==4096 and any(b):io[at-0x10000000:at-0x10000000+4096]=b
            else:raise ValueError('Parent cache segment exceeds the declared IO/heap regions')
            checks['staticCacheSegments']+=1
        if heap is None:raise ValueError('Parent cache omits the owned heap')
        patches=set()
        for patch in prepared['imagePatches']:
            b=(directory/patch['file']).read_bytes();at=patch['rva']
            if (Path(patch['file']).name!=patch['file'] or sha(b)!=patch['sha256'] or len(b)!=patch['bytes'] or
                    at%4096 or not 0x1fef000<=at<at+len(b)<=len(image) or at in patches or b==image[at:at+len(b)]):
                raise ValueError('Parent cache patches executable/out-of-range/duplicate/unchanged bytes')
            patches.add(at);patched[at:at+len(b)]=b;checks['staticDataPages']+=1
        graph_ref=systems['systems'][effect_id];graph_raw=(assets/'latest-vfx-system-assets'/graph_ref['file']).read_bytes();graph=json.loads(graph_raw)
        if sha(graph_raw)!=prepared['graphSha256'] or sha(graph_raw)!=graph_ref['sha256']:raise ValueError('Parent full graph differs')
        if bytes(io[0x20000:0x20150])!=bytes.fromhex(graph['objectHex'])[:0x150]:raise ValueError('Parent cache altered authored root fields')
        expected_heap=bytearray.fromhex(graph['heapHex']);before=baseline_cases[effect_id]
        for write in before['assetHeapWrites']:
            off,size=write['offset'],write['size']
            if expected_heap[off:off+size].hex()!=write['beforeHex']:raise ValueError('Authored heap baseline write sequence differs')
            expected_heap[off:off+size]=write['value'].to_bytes(size,'little')
        off=graph['heapStart']-0x10400000
        if heap[off:off+len(expected_heap)]!=expected_heap:raise ValueError('Parent cache has unaccounted authored asset mutations')
        def cache_read(at,size):
            if 0x10000000<=at<at+size<=0x10400000:return bytes(io[at-0x10000000:at-0x10000000+size])
            if 0x10400000<=at<at+size<=prepared['nextHeap']:return heap[at-0x10400000:at-0x10400000+size]
            if profile['imageBase']<=at<at+size<=profile['imageBase']+len(image):return bytes(patched[at-profile['imageBase']:at-profile['imageBase']+size])
            raise ValueError('Parent cache pointer outside owned static regions')
        array,count,capacity=struct.unpack('<QII',cache_read(0x10020000+complex_field['offset'],16))
        if count!=len(authored) or count>capacity&0x7fffffff:raise ValueError('Parent cache authored emitter array differs')
        defs=struct.unpack('<'+'Q'*count,cache_read(array,count*8))
        if [i for i,d in enumerate(defs) if cache_read(d+disabled_field['offset'],1)[0]]!=disabled:
            raise ValueError('Parent cache native disabled bytes differ from authored fields')
        if struct.unpack('<Q',cache_read(prepared['warmObject']+0x28,8))[0]!=prepared['warmParent']:
            raise ValueError('Parent cache warm object/parent ownership differs')
        for a in case['warmedOwnership']['actors']:
            if not cache_read(a['pointer']+0x18,1)[0]&2:raise ValueError('Warm parent emitter was not suspended before export')
        checks['freshCachedParents']+=1;checks['authoredRootsPreserved']+=1
        parent=owned['parent'];initial=owned['initialTime']
        for frame in case['frames']:
            state=frame['state'];parent_bytes=bytes.fromhex(state['parentHex'])
            if len(parent_bytes)!=0x2c0 or len(state['actors'])!=len(actors) or len(frame['geometry'])!=len(actors):raise ValueError('Parent frame omits native actors')
            clock=struct.unpack('<f',struct.pack('<f',initial+frame['tick']/60))[0]
            if frame['time']!=clock or not 0x10400000<state['nextHeap']<=0x12000000:raise ValueError('Parent frame clock/heap bound differs')
            pointer,count,capacity=struct.unpack_from('<QII',parent_bytes,0x40)
            if count!=len(actors) or count>capacity&0x7fffffff or not 0x10400000<=pointer<pointer+count*8<=state['nextHeap']:
                raise ValueError('Parent frame native actor-vector metadata differs')
            if [s['actor'] for s in frame['substeps']]!=[a['pointer'] for a in actors]:raise ValueError('Parent did not schedule each selected emitter once at canonical cadence')
            for actual,actor,geometry in zip(state['actors'],actors,frame['geometry']):
                b=bytes.fromhex(actual['bytesHex']);pool=bytes.fromhex(actual['poolHex'])
                if (actual['pointer']!=actor['pointer'] or struct.unpack_from('<QQ',b)!=(parent,actor['link']) or
                        struct.unpack_from('<Q',b,0xa0)[0]!=actual['pool'] or len(pool)!=0xf0):raise ValueError('Parent frame actor/pool owner differs')
                for name,(off,stride) in vectors.items():
                    v=actual['vectors'][name];address,count,capacity=struct.unpack_from('<QII',pool,off);payload=bytes.fromhex(v['bytesHex'])
                    if (address!=v['address'] or count!=v['count'] or capacity&0x7fffffff!=v['capacity'] or count>v['capacity'] or
                            len(payload)!=count*stride or (count and not 0x10400000<=address<address+len(payload)<=state['nextHeap'])):
                        raise ValueError('Parent frame pool vector bytes/bounds differ')
                    checks['poolVectors']+=1
                count=actual['vectors']['life']['count'];vertices=bytes.fromhex(geometry['verticesHex']);indices=bytes.fromhex(geometry['indicesHex'])
                if geometry['emitterIndex']!=actor['emitterIndex'] or geometry['actor']!=actor['pointer'] or geometry['particleCount']!=count:
                    raise ValueError('Parent geometry describes another native emitter/pool')
                if geometry['kind']=='camera-trail':
                    if len(vertices)>count*56 or len(indices)>max(0,count-1)*12:raise ValueError('Parent trail exceeded native output budget')
                elif geometry['kind'] in ['camera-quad','arbitrary-quad']:
                    if len(vertices)!=count*112 or len(indices)!=count*12:raise ValueError('Parent quad omitted live native particles')
                else:raise ValueError('Parent geometry contains an unadmitted primitive kind')
                if len(vertices)%28 or len(indices)%2 or any(i>=len(vertices)//28 for i in struct.unpack('<'+'H'*(len(indices)//2),indices)):
                    raise ValueError('Parent geometry index/stride differs')
                if any(not math.isfinite(v) for off in range(0,len(vertices),28) for v in struct.unpack_from('<3f',vertices,off)):
                    raise ValueError('Parent geometry has nonfinite positions')
                kinds[geometry['kind']]+=1;checks['geometryRecords']+=1
            digest=sha(json.dumps({k:frame[k] for k in ['time','substeps','state','geometry']},sort_keys=True,separators=(',',':')).encode())
            if digest!=frame['stateAndGeometrySha256']:raise ValueError('Parent frame state/geometry digest differs')
            checks['frames']+=1
        for transition in case['suspension']:
            if transition['after']!=[(v&~2)|(int(transition['suspended'])<<1) for v in transition['before']] or len(transition['before'])!=len(actors):
                raise ValueError('Native object suspension omitted/changed an actor flag')
            checks['suspensionTransitions']+=1
        checkpoint=case['checkpoint']
        if (checkpoint['tick']!=12 or checkpoint['finalCpuWorldSha256']!=checkpoint['restoredFinalCpuWorldSha256'] or
                checkpoint['rejectedInvalidHandles']!=2 or [v['tick'] for v in case['seekChecks']]!=list(range(13,61))):
            raise ValueError('Parent checkpoint lacks complete continuation/ownership evidence')
        for check in case['seekChecks']:
            expected=case['frames'][check['tick']-1]['stateAndGeometrySha256']
            if check['expectedSha256']!=expected or check['actualSha256']!=expected:raise ValueError('Parent seeking changes state/geometry/substeps')
            checks['checkpointContinuationFrames']+=1
        checks['checkpointCpuWorldComparisons']+=1;checks['invalidCheckpointRejections']+=2;checks['roots']+=1
    if checks['geometryRecords']!=data['counts']['geometryRecords'] or checks['frames']!=data['counts']['frames']:
        raise ValueError('Parent reported totals differ from retained evidence')
    result={'schema':1,'kind':'complete-native-parent-frame-inspection','observationSha256':sha(raw),
        'cachePackageSha256':sha(package_raw),'baselineObservationSha256':sha(baseline_raw),
        'inspectorSha256':sha(Path(__file__).read_bytes()),'checks':dict(checks),'primitiveKinds':dict(kinds),
        'authoredDisabledEmitters':disabled_total,'disabledPredicate':predicate,'mismatchCount':0,'scope':data['scope']}
    output=cache/'research/parent-frames-inspection.json';output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
