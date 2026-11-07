"""Run original inverse-bind matrix preparation over verified native world poses."""
import math
import struct
from unicorn import x86_const as r


def prepare_skin_matrices(n,poses):
    path=poses['skeletonPath'];joints=poses['joints'];count=len(joints)
    if not path.lower().endswith('.skl') or not 0<count<=4096:
        raise ValueError('Bounded original skeleton and native pose samples required')
    handle=n.allocate(8)
    n.call(0x15b3c20,{r.UC_X86_REG_RDI:handle,r.UC_X86_REG_RSI:n.allocate_text(path)})
    rig=n.q(handle)
    if not rig or not n.library_pointer(rig,0x90) or n.u32(rig+0x30)!=count:
        raise ValueError('Original skeleton joint count differs from the native pose evidence')
    rows=n.q(rig+0x28)
    if not n.library_pointer(rows,count*0x70):raise ValueError('Original joint vector exceeds owned bounds')
    inverse=[]
    for i,joint in enumerate(joints):
        at=rows+i*0x70;name=n.q(at+8);length=n.u32(at+0x10)
        if (not 0<length<=1024 or not n.library_pointer(name,length) or
                bytes(n.u.mem_read(name,length)).decode('utf-8')!=joint['name'] or
                bytes(n.u.mem_read(at+0x20,40)).hex()!=joint['bindLocalHex'] or
                int.from_bytes(n.u.mem_read(at,2),'little')!=i):
            raise ValueError('Original skeleton order/name/bind differs from native pose evidence')
        inverse.append(bytes(n.u.mem_read(at+0x48,40)).hex())
    records=[]
    for resource in poses['resources']:
        if not resource['completed']:raise ValueError('Complete original resource samples required')
        record={'key':resource['key'],'kind':resource['kind'],'samples':[]};records.append(record)
        for sample in resource['samples']:
            world=bytes.fromhex(sample['worldPosesHex'])
            if (not sample['worldValid'] or len(world)!=count*40 or
                    not all(math.isfinite(v) for v in struct.unpack('<'+'f'*(count*10),world))):
                raise ValueError('Finite complete original world-pose sample required')
            pose=n.allocate(0x210);n.u.mem_write(pose+0x110,b'\xa5'*0x100)
            n.call(0x15bc970,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:rig})
            output=n.q(pose+8)
            if not n.library_pointer(output,len(world)):raise ValueError('Original pose storage exceeds bounds')
            # The verified original world pass ran in the source observation.
            # Import its exact output without asserting live animation selection.
            n.u.mem_write(output,world)
            n.call(0x1586f00,{r.UC_X86_REG_RDI:pose})
            matrices=n.q(pose+0x28)
            if not matrices or matrices%16 or not n.library_pointer(matrices,count*48):
                raise ValueError('Original aligned skin-matrix storage exceeds bounds')
            n.call(0x1586f40,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:matrices})
            data=bytes(n.u.mem_read(matrices,count*48))
            if (not all(math.isfinite(v) for v in struct.unpack('<'+'f'*(count*12),data)) or
                    bytes(n.u.mem_read(output,len(world)))!=world or
                    bytes(n.u.mem_read(pose+0x110,0x100))!=b'\xa5'*0x100):
                raise ValueError('Original skin-matrix pass changed its source pose or escaped its guard')
            n.call(0x1586f40,{r.UC_X86_REG_RDI:pose,r.UC_X86_REG_RSI:matrices})
            if bytes(n.u.mem_read(matrices,count*48))!=data:
                raise ValueError('Original skin-matrix preparation was not repeatable')
            record['samples'].append({'time':sample['time'],'matrices3x4Hex':data.hex(),
                                      'sourceWorldUnchanged':True,'poseGuardIntact':True,'repeatMatches':True})
    return {'skeletonPath':path,'jointCount':count,'inverseBindPosesHex':inverse,'resources':records,
            'originalPoseConstructorRva':0x15bc970,'originalMatrixAllocationRva':0x1586f00,
            'originalMatrixPreparationRva':0x1586f40,
            'scope':{'importedVerifiedNativeWorldPoses':True,'originalInverseBindPreparation':True,
                     'recordedAnimationSelection':False,'gpuSkinningExecuted':False,
                     'mainViewerExpanded':False}}
