"""Read-only observations of original shared spell-preload requests/results."""
import unicorn
from unicorn import x86_const as r


def observe_preloads(n):
    records,frames = [],{}
    def entry(uc,address,size,user):
        receiver,context,name = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        if receiver != n.q(n.base+0x2472910)+8 or len(records) >= 8192:
            raise ValueError('Original spell preload escaped its owned manager/count bound')
        record = {'receiver':receiver,'context':context,'spell':n.cstring(name).decode('utf-8') if name else None,
                  'hash':None,'createdResource':None,'returnedResource':None,'completed':False,
                  'resourceReadinessVerified':False}
        records.append(record)
        frames[uc.reg_read(r.UC_X86_REG_RSP)] = record
    def observe(uc,address,size,user):
        record = frames.get(uc.reg_read(r.UC_X86_REG_RBP)+8)
        if record is None:raise ValueError('Spell preload observation lost its original frame')
        if address == n.base+0x84ba0a:
            record['hash'] = uc.reg_read(r.UC_X86_REG_R12)&0xffffffff
        elif address == n.base+0x84bce9:
            resource = uc.reg_read(r.UC_X86_REG_RAX)
            if not n.library_pointer(resource,0xb8):raise ValueError('Original preload resource escaped owned memory')
            record['createdResource'] = {'pointer':resource,'allocatedBytes':n.allocations.get(resource),
                                         'vtable':n.q(resource)}
        else:
            resource = uc.reg_read(r.UC_X86_REG_R13)
            if resource and not n.library_pointer(resource,0xb8):
                raise ValueError('Original preload return escaped owned resource memory')
            record['returnedResource'] = resource
            record['completed'] = True
            del frames[uc.reg_read(r.UC_X86_REG_RBP)+8]
    n.u.hook_add(unicorn.UC_HOOK_CODE,entry,begin=n.base+0x84b9d0,end=n.base+0x84b9d0)
    for at in [0x84ba0a,0x84bce9,0x84bf3b]:
        n.u.hook_add(unicorn.UC_HOOK_CODE,observe,begin=n.base+at,end=n.base+at)
    n.u.ctl_remove_cache(n.base+0x84b9d0,n.base+0x84bf80)
    return records
