"""Read-only observations of original named VFX definition preload calls."""
import unicorn
from unicorn import x86_const as r
from vfx_object_native import MANAGER


def observe_effect_preloads(n):
    records,frames = [],{}
    def enter(uc,address,size,user):
        if uc.reg_read(r.UC_X86_REG_RDI) != MANAGER or len(records) >= 16384:
            raise ValueError('Original effect preload escaped the owned manager/count bound')
        name = uc.reg_read(r.UC_X86_REG_RSI)
        pointer,count = n.q(name),n.u32(name+8)
        if count > 4096 or not n.library_pointer(pointer,count):
            raise ValueError('Original effect preload path escaped owned string bounds')
        record = {'name':bytes(uc.mem_read(pointer,count)).decode('utf-8'),
                  'flags':uc.reg_read(r.UC_X86_REG_RDX)&0xffffffff,
                  'returnedResource':None,'definitionPointer':None,'definitionLoadReturn':None,
                  'definitionPrefixHex':None,'completed':False,
                  'resourceReadinessVerified':False}
        records.append(record)
        frames[uc.reg_read(r.UC_X86_REG_RSP)] = record
    def loaded(uc,address,size,user):
        record = frames.get(uc.reg_read(r.UC_X86_REG_RBP)+8)
        result = uc.reg_read(r.UC_X86_REG_RAX)&255
        if record is None or result not in [0,1]:
            raise ValueError('Original definition load result escaped its observed frame/boolean')
        record['definitionLoadReturn'] = bool(result)
    def finish(uc,address,size,user):
        record = frames.pop(uc.reg_read(r.UC_X86_REG_RBP)+8,None)
        if record is None:raise ValueError('Original effect preload return lost its observed frame')
        resource = uc.reg_read(r.UC_X86_REG_RBX)
        if resource and not n.library_pointer(resource,0xa0):
            raise ValueError('Original effect preload returned an unowned resource')
        definition = n.q(resource+0x38) if resource else None
        if definition and not n.library_pointer(definition,0x160):
            raise ValueError('Original effect runtime definition escaped owned memory')
        record.update(returnedResource=resource,definitionPointer=definition,
                      definitionPrefixHex=bytes(uc.mem_read(definition,0x50)).hex() if definition else None,completed=True)
    n.u.hook_add(unicorn.UC_HOOK_CODE,enter,begin=n.base+0x174b190,end=n.base+0x174b190)
    n.u.hook_add(unicorn.UC_HOOK_CODE,finish,begin=n.base+0x174b1c5,end=n.base+0x174b1c5)
    n.u.hook_add(unicorn.UC_HOOK_CODE,loaded,begin=n.base+0x174b2bb,end=n.base+0x174b2bb)
    n.u.ctl_remove_cache(n.base+0x174b190,n.base+0x174b3f0)
    return records
