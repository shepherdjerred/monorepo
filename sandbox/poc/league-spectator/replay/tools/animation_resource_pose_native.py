"""Sample loaded animations with original rig binding, cache and evaluation."""
import math
import struct
from unicorn import x86_const as r


def sample_animation_resources(n,inspection,skeleton_path):
    if not skeleton_path.lower().endswith('.skl'):raise ValueError('Explicit installed skeleton path required')
    handle=n.allocate(8)
    n.call(0x15b3c20,{r.UC_X86_REG_RDI:handle,r.UC_X86_REG_RSI:n.allocate_text(skeleton_path)})
    rig=n.q(handle)
    if not rig or not n.library_pointer(rig,0x90):raise ValueError('Original skeleton read returned no owned rig')
    rows,count=n.q(rig+0x28),n.u32(rig+0x30)
    if not 0<count<=4096 or not n.library_pointer(rows,count*0x70):raise ValueError('Original rig joint vector exceeds bounds')
    joints=[]
    for i in range(count):
        at=rows+i*0x70;name=n.q(at+8);length=n.u32(at+0x10)
        if not 0<length<=1024 or not n.library_pointer(name,length):raise ValueError('Original rig name exceeds bounds')
        joints.append({'name':bytes(n.u.mem_read(name,length)).decode('utf-8'),
                       'poseIndex':int.from_bytes(n.u.mem_read(at,2),'little'),
                       'parent':int.from_bytes(n.u.mem_read(at+0x1c,2),'little',signed=True),
                       'bindLocalHex':bytes(n.u.mem_read(at+0x20,40)).hex()})
    if [j['poseIndex'] for j in joints]!=list(range(count)):
        raise ValueError('Pose control requires dense original rig pose indices')
    result={'skeletonPath':skeleton_path,'rig':rig,'joints':joints,'resources':[],'deferredResources':[],
            'scope':{'controlledSampleTimes':True,'originalUncompressedPoseEvaluation':True,
                     'compressedPoseEvaluation':True,'poseParityVerified':False,
                     'originalWorldPosePassExecuted':True,'recordedWorldPlacement':False,
                     'animationGraphBlendingExecuted':False,'mainViewerExpanded':False}}
    root=n.allocate(40);root_bytes=struct.pack('<10f',0,0,0,1,1,1,0,0,0,1)
    n.u.mem_write(root,root_bytes)
    result['worldPoseControl']={'rootHex':root_bytes.hex(),'inheritScale':True,'originalWorldPassRva':0x15852a0}
    if not 0<len(inspection['resources'])<=256:raise ValueError('Bounded loaded animation sample set required')
    for resource in inspection['resources']:
        compressed=resource['kind']=='compressed'
        if resource['kind'] not in ['uncompressed','compressed']:raise ValueError('Unknown loaded animation class')
        pointer=resource['resource']
        if n.q(pointer)!=n.base+(0x23e3950 if compressed else 0x23e3a00):
            raise ValueError('Original loaded animation resource class changed')
        mapping=n.allocate(16);indices=n.allocate(count*4)
        n.put(mapping,'QII',indices,count,count)
        binding=0x15b3120 if compressed else 0x15b61a0
        evaluator=0x15b0b30 if compressed else 0x15b53e0
        n.call(binding,{r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:rig,r.UC_X86_REG_RDX:mapping})
        bound=list(struct.unpack('<'+'i'*count,n.u.mem_read(indices,count*4)))
        tracks=n.u32(pointer+(0x1c if compressed else 0x18))
        if any(index<-1 or index>=tracks for index in bound):raise ValueError('Original ANM rig binding exceeds its track count')
        duration=(resource['frames']-1)/resource['fps']
        times=sorted(set([0.0,min(1/resource['fps'],duration),duration*.5]))
        cache=0;cache_owner=0
        record={'key':resource['key'],'kind':resource['kind'],'frames':resource['frames'],'fps':resource['fps'],
                'originalRigBindingRva':binding,'originalEvaluationRva':evaluator,
                'trackIndices':bound,'samples':[],'completed':False}
        result['resources'].append(record)
        if compressed:
            # This inline subobject constructor also zeros adjacent clip fields.
            # Execute its complete original block in owned clip storage; the
            # resource evaluator allocates and fills the per-track cache itself.
            cache_owner=n.allocate(0x170);n.u.mem_write(cache_owner+0x70,b'\xa5'*0x100)
            n.call(0x15889f8,{r.UC_X86_REG_RDI:cache_owner},0x1588a19)
            cache=cache_owner+0x58
            expected=struct.pack('<fI QII',-1.0,0,0,0,0)
            if bytes(n.u.mem_read(cache,24))!=expected:
                raise ValueError('Original compressed cache initialization changed')
            record['cacheInitialization']={'originalBlock':[0x15889f8,0x1588a19],
                'headerHex':expected.hex(),'fullClipConstructorExecuted':False}
            # Revisit an earlier time after the jump to exercise native cache
            # rewind, then advance fractionally with the same original cache.
            rewind_index=len(times)
            times.extend([0.0,min(.5/resource['fps'],duration)])
        for time in times:
            # The world pass transforms the local array in place. Construct a
            # fresh original pose, including its native validity flags, rather
            # than manually invalidating a previously composed pose.
            pose=n.allocate(0x210);n.u.mem_write(pose+0x110,b'\xa5'*0x100)
            n.call(0x15bc970,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:rig})
            encoded=struct.pack('<f',time)
            n.call(evaluator,{r.UC_X86_REG_RDI:pointer,r.UC_X86_REG_RSI:pose,r.UC_X86_REG_RDX:mapping,
                              r.UC_X86_REG_RCX:cache,r.UC_X86_REG_XMM0:int.from_bytes(encoded,'little')})
            if not n.u.reg_read(r.UC_X86_REG_AL):raise ValueError('Original ANM evaluation did not return success')
            output=n.q(pose+8)
            if not n.library_pointer(output,count*40):raise ValueError('Original evaluated pose escaped owned bounds')
            data=bytes(n.u.mem_read(output,count*40))
            if not all(math.isfinite(value) for value in struct.unpack('<'+'f'*(count*10),data)):
                raise ValueError('Original evaluated pose contains non-finite values')
            if bytes(n.u.mem_read(pose+0x110,0x100))!=b'\xa5'*0x100:
                raise ValueError('Original pose constructor/evaluator escaped its guard')
            sample={'time':struct.unpack('<f',encoded)[0],'localPosesHex':data.hex(),'guardIntact':True}
            if compressed:
                cache_time,cursor,states,state_count,capacity=struct.unpack('<fI QII',n.u.mem_read(cache,24))
                if (cache_time!=sample['time'] or cursor>n.u32(pointer+0x20) or state_count!=tracks or
                        not state_count<=capacity<=4096 or not n.library_pointer(states,state_count*0xb8) or
                        bytes(n.u.mem_read(cache_owner+0x70,0x100))!=b'\xa5'*0x100):
                    raise ValueError('Original compressed cache state/count/guard differs')
                sample['cache']={'lastTime':cache_time,'cursor':cursor,'stateCount':state_count,'capacity':capacity}
            n.call(0x15852a0,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:root,r.UC_X86_REG_RDX:1})
            world=bytes(n.u.mem_read(output,count*40))
            if (not n.u.reg_read(r.UC_X86_REG_AL) or not n.u.mem_read(pose+4,1)[0] or n.u32(pose)!=1 or
                    not all(math.isfinite(v) for v in struct.unpack('<'+'f'*(count*10),world)) or
                    bytes(n.u.mem_read(pose+0x110,0x100))!=b'\xa5'*0x100):
                raise ValueError('Original world-pose pass validity/revision/guard differs')
            n.call(0x15852a0,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:root,r.UC_X86_REG_RDX:1})
            if n.u.reg_read(r.UC_X86_REG_AL) or bytes(n.u.mem_read(output,count*40))!=world:
                raise ValueError('Original valid world-pose guard recomposed its result')
            sample.update(worldPosesHex=world.hex(),worldValid=True,worldRevision=1,worldCachedCallUnchanged=True)
            record['samples'].append(sample)
        if compressed and record['samples'][0]['localPosesHex']!=record['samples'][rewind_index]['localPosesHex']:
            raise ValueError('Original compressed rewind did not reproduce its initial pose')
        record['completed']=True
    return result
