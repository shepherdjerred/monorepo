"""Owned byte allocation with the original aligned-pointer/header arithmetic.

Only memory services are ported. Native asset readers, types, constructors and
post-load callbacks remain original. Freed blocks stay in the isolated arena,
as with the existing byte allocator, and cannot be freed twice through this ABI.
"""
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import sha


class AlignedAssetMemory:
    def __init__(self,*args):
        self.asset_aligned_allocations={}
        self.asset_aligned_calls=[]
        self.pending_asset_alignment=None
        super().__init__(*args)
        expected={0x149a390:('bounded aligned allocation','e9bbcd170190'),
                  0x149a420:('isolated arena free','c3')}
        patches={p['rva']:p for p in self.profile['modeledServices']}
        for at,(name,encoded) in expected.items():
            patch=patches.get(at)
            if (patch is None or patch['service']!=name or patch['bytesHex']!=encoded or
                    self.image[at:at+len(bytes.fromhex(encoded))]!=bytes.fromhex(encoded)):
                raise ValueError('Aligned-memory service differs from exact decoder profile')
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.asset_aligned_service,begin=self.base+at,end=self.base+at)
        # Observe the original arithmetic's result before its original pops/ret.
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.asset_alignment_return,begin=self.base+0x149a40c,end=self.base+0x149a40c)

    def reject(self,uc,address,size,user):
        if address-self.base not in [0x149a390,0x149a420]:return super().reject(uc,address,size,user)

    def check_block(self,uc,address,size,user):
        if address-self.base not in [0x149a390,0x149a420]:return super().check_block(uc,address,size,user)

    def asset_aligned_service(self,uc,address,size,user):
        at=address-self.base;pointer=uc.reg_read(r.UC_X86_REG_RDI)
        if at==0x149a420:
            if pointer:
                allocation=self.asset_aligned_allocations.get(pointer)
                if allocation is None or allocation['retired'] or self.q(pointer-8)!=allocation['base']:
                    raise ValueError('Aligned free has no live owned base-pointer header')
                allocation['retired']=True
            self.asset_aligned_calls.append({'service':'free','pointer':pointer,'isolatedArenaRetained':True})
            self.ret();return
        alignment=max(8,uc.reg_read(r.UC_X86_REG_RSI));count=pointer
        if (self.pending_asset_alignment is not None or alignment>65536 or alignment&(alignment-1) or
                count>=0x100000 or count+alignment>=0x100000):
            raise ValueError('Aligned byte allocation exceeds owned size/alignment bounds')
        base=self.allocate(count+alignment,0xa5)
        stack=uc.reg_read(r.UC_X86_REG_RSP)
        self.pending_asset_alignment={'base':base,'bytes':count,'alignment':alignment,
            'stack':stack,'returnRva':self.q(stack)-self.base,'retired':False}
        # Supply the underlying byte allocation, then execute the untouched
        # native align/store suffix with its actual original register ABI.
        frame=stack-24
        self.put(frame,'QQQ',*[uc.reg_read(reg) for reg in [r.UC_X86_REG_RBX,r.UC_X86_REG_R14,r.UC_X86_REG_RBP]])
        uc.reg_write(r.UC_X86_REG_RSP,frame);uc.reg_write(r.UC_X86_REG_R14,alignment)
        uc.reg_write(r.UC_X86_REG_RAX,base);uc.reg_write(r.UC_X86_REG_RIP,self.base+0x149a3e7)

    def asset_alignment_return(self,uc,address,size,user):
        request=self.pending_asset_alignment
        if request is None:raise ValueError('Original aligned-memory return has no owned request')
        pointer=uc.reg_read(r.UC_X86_REG_RAX)
        if (not request['base']+8<=pointer<=request['base']+request['alignment'] or
                pointer%request['alignment'] or self.q(pointer-8)!=request['base'] or
                uc.reg_read(r.UC_X86_REG_RSP)!=request['stack']-24 or pointer in self.asset_aligned_allocations):
            raise ValueError('Original alignment arithmetic/header escaped its byte allocation')
        request.update(pointer=pointer,originalArithmeticRvas=[0x149a3e7,0x149a40c],
            originalArithmeticSha256=sha(self.source.image[0x149a3e7:0x149a40c]))
        self.asset_aligned_allocations[pointer]=request
        self.asset_aligned_calls.append({'service':'allocate',**request})
        self.pending_asset_alignment=None
