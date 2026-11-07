"""Single-context libc++ shared/weak ownership ABI services."""
import struct
from unicorn import x86_const as r


SHARED_IMPORTS={0x1fee4ec:'__ZNSt3__119__shared_weak_count4lockEv',
                0x1fee4e6:'__ZNSt3__119__shared_weak_count14__release_weakEv'}


class NativeLibcppSharedOwnership:
    def __init__(self,*args,**kwargs):
        self.shared_calls=[];self.retired_shared_controls=set()
        super().__init__(*args,**kwargs)
        for at,symbol in SHARED_IMPORTS.items():
            if self.source.imports.get(at)!=symbol:raise ValueError('Exact libc++ ownership imports differ')

    def imported(self,engine,address,size,user):
        at=address-self.base
        if at not in SHARED_IMPORTS:return super().imported(engine,address,size,user)
        control=engine.reg_read(r.UC_X86_REG_RDI);allocation=self.allocations.get(control)
        if (allocation is None or not 24<=allocation<=1048576 or
                control in self.retired_shared_controls or not self.library_pointer(control,24)):
            raise ValueError('Libc++ ownership requires a live owned control block')
        shared,weak=struct.unpack('<qq',engine.mem_read(control+8,16))
        if not -1<=shared<=65536 or not 0<=weak<=65536:
            raise ValueError('Libc++ ownership counter exceeds admitted bounds')
        record={'name':SHARED_IMPORTS[at],'control':control,'sharedBefore':shared,'weakBefore':weak,
                'singleContextAtomicModel':True,'originalDestructorDispatched':False}
        self.shared_calls.append(record)
        if at==0x1fee4ec:
            if shared!=-1:
                if shared==65536:raise ValueError('Libc++ shared lock exceeds counter bound')
                self.put(control+8,'q',shared+1)
            result=control if shared!=-1 else 0
            record.update(result=result,sharedAfter=shared+1 if shared!=-1 else -1,weakAfter=weak)
            engine.reg_write(r.UC_X86_REG_RAX,result);self.ret()
        elif weak>0:
            self.put(control+16,'q',weak-1);record.update(sharedAfter=shared,weakAfter=weak-1)
            self.ret()
        else:
            table=self.q(control)
            if not self.base+0x1fef000<=table<=self.base+len(self.image)-0x28:
                raise ValueError('Libc++ weak-control vtable is outside original static data')
            # Itanium libc++ layout: two destructors, on_zero_shared,
            # get_deleter, on_zero_shared_weak. The +18 entry is not the weak
            # destructor. Keep the caller's stack and tail-call original code.
            callback=self.q(table+0x20)
            if not self.base<=callback<self.base+0x1fef000:
                raise ValueError('Libc++ final weak destructor is outside original code')
            self.retired_shared_controls.add(control)
            record.update(originalDestructorDispatched=True,destructorRva=callback-self.base,
                          sharedAfter=shared,weakAfter=weak,arenaStorageRetained=True)
            engine.reg_write(r.UC_X86_REG_RIP,callback)
