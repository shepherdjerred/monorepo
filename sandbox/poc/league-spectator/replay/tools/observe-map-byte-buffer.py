"""Compare the map compiler's memory service to original byte-buffer code.

Only allocator/free endpoints are supplied to the original function. Initialization
is explicitly supplied as complete with an owned pool descriptor; no mmap arena
or game-world state is claimed. Count, capacity, payload and allocations are
compared, including the native external-buffer capacity flag. Original free calls
are compared to the model's release obligation; both owned arenas retain storage
until reset, without modeling allocator reuse.
"""
import argparse
import json
from pathlib import Path
import capstone
import unicorn
from unicorn import x86_const as r
from map_vfx_asset_native import NativeMapVfxSystemAssets, RESERVE_RVA, RESERVE_END_RVA
from vfx_system_asset_native import NativeVfxSystemAssets
from vfx_spawn_native import sha


class OriginalBuffer(NativeVfxSystemAssets):
    def __init__(self,*args):
        self.comparing_buffer=False
        super().__init__(*args)
        self.allocator_calls=[]
        self.releases=[]
        for at,name in [(0x1499f00,'bounded pool allocation in RSI'),(0x1feea32,'_malloc'),(0x1fee88e,'_free')]:
            service=next(s for s in self.profile['modeledServices'] if s['rva']==at)
            if service['service']!=name:
                raise ValueError('Prepared byte-buffer allocator ABI differs')
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.pool_allocate,
            begin=self.base+0x1499f00,end=self.base+0x1499f00)
        decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
        decoder.detail=True
        refs={}
        for ins in decoder.disasm(self.image[RESERVE_RVA:RESERVE_END_RVA],RESERVE_RVA):
            for operand in ins.operands:
                if operand.type==capstone.CS_OP_MEM and operand.mem.base==capstone.x86.X86_REG_RIP:
                    refs[ins.address]=ins.address+ins.size+operand.mem.disp
        if set([0x14a9420,0x14a9437,0x14a9540])-refs.keys():
            raise ValueError('Original byte-buffer allocator globals changed')
        if refs[0x14a9437]!=refs[0x14a9540]:
            raise ValueError('Original buffer allocation/release use different pools')
        self.pool=self.allocate(0x145b0)
        self.put(self.base+refs[0x14a9420],'B',1)
        self.put(self.base+refs[0x14a9437],'Q',self.pool)
        self.supplied_pool_globals=refs
        if self.source.imports[0x1feea32]!='_malloc' or self.source.imports[0x1fee88e]!='_free':
            raise ValueError('Original byte-buffer CRT endpoints differ')

    def reject(self,uc,address,size,user):
        if not (self.comparing_buffer and address-self.base in [0x1499f00,0x1feea32,0x1fee88e]):
            super().reject(uc,address,size,user)

    def check_block(self,uc,address,size,user):
        if not (self.comparing_buffer and address-self.base==0x1499f00):
            super().check_block(uc,address,size,user)

    def pool_allocate(self,uc,address,size,user):
        if not self.comparing_buffer or uc.reg_read(r.UC_X86_REG_RDI)!=self.pool+8:
            raise ValueError('Buffer pool endpoint outside the supplied comparison')
        size=uc.reg_read(r.UC_X86_REG_RSI)
        result=self.allocate(size,0xa5)
        self.allocator_calls.append(size)
        uc.reg_write(r.UC_X86_REG_RAX,result)
        self.ret()

    def imported(self,uc,address,size,user):
        name=self.source.imports[address-self.base]
        if self.comparing_buffer and name in ['_malloc','_free']:
            argument=uc.reg_read(r.UC_X86_REG_RDI)
            if name=='_malloc':
                self.allocator_calls.append(argument)
                uc.reg_write(r.UC_X86_REG_RAX,self.allocate(argument,0xa5))
            else:
                if argument not in self.allocations:
                    raise ValueError('Original buffer released an unowned allocation')
                self.releases.append(argument)
            self.ret()
        else:
            super().imported(uc,address,size,user)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    args=p.parse_args()
    package=args.cache/'public/decoder-16.21-macos'
    original=OriginalBuffer(package,args.client)
    model=NativeMapVfxSystemAssets(package,args.client)
    rows=[]
    cases=[(0,0,1,False),(0,16,32,False),(1,16,32,False),(8,16,32,False),
        (31,32,128,False),(128,128,256,False),(257,300,512,False),
        (0,16,32,True),(7,16,32,True),(129,160,256,True)]
    for count,capacity,requested,external in cases:
        observations=[]
        payload=bytes((i*37+11)&255 for i in range(count))
        for native,is_original in [(original,True),(model,False)]:
            header=native.allocate(16)
            pointer=native.allocate(capacity,0x51) if capacity else 0
            if count:native.u.mem_write(pointer,payload)
            native.put(header,'QII',pointer,count,capacity|(0x80000000 if external else 0))
            if is_original:
                native.allocator_calls.clear();native.releases.clear()
                native.comparing_buffer=True
            else:native.loading=True
            try:
                native.call(RESERVE_RVA,{r.UC_X86_REG_RDI:header,r.UC_X86_REG_RSI:requested})
            finally:
                if is_original:native.comparing_buffer=False
                else:native.loading=False
            out=native.q(header)
            value={'count':native.u32(header+8),'capacity':native.u32(header+12),
                'payloadHex':bytes(native.u.mem_read(out,requested)).hex(),
                'allocationBytes':native.allocator_calls[:] if is_original else [native.map_buffer_reserves[-1]['requested']],
                'oldOwnedReleaseRequired':bool(native.releases) if is_original else bool(
                    native.map_buffer_reserves[-1]['oldPointer'] and not native.map_buffer_reserves[-1]['oldCapacity']&0x80000000)}
            if (value['count']!=count or value['capacity']!=requested or
                    bytes.fromhex(value['payloadHex'])[:count]!=payload):
                raise ValueError('Byte-buffer operation violated count/capacity/payload contract')
            observations.append(value)
        if observations[0]!=observations[1]:
            raise ValueError('Map byte-buffer service differs from original code')
        rows.append({'input':{'count':count,'capacity':capacity,'requested':requested,'external':external},
            'original':observations[0],'modeled':observations[1]})
    result={'schema':1,'kind':'native-map-byte-buffer-comparison','build':model.profile['clientVersion'],
        'protocol':model.profile['protocolDigest'],'decoderImageSha256':sha(model.image),
        'modeledService':model.map_memory_service,'suppliedPoolGlobals':original.supplied_pool_globals,
        'sources':{p.name:sha(p.read_bytes()) for p in [Path(__file__),Path(__file__).with_name('map_vfx_asset_native.py')]},
        'rows':rows,'counts':{'cases':len(rows),'mismatches':0},
        'scope':{'originalBufferFunctionExecuted':True,'originalAllocatorExecuted':False,
            'boundedOwnedAllocatorEndpoints':True,'allocatorReuseModeled':False,
            'originalFreeComparedToModeledReleaseObligation':True,'replayExecuted':False,'browserExecuted':False}}
    output=args.cache/'research/map-byte-buffer-comparison.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts']}))


if __name__=='__main__':main()
