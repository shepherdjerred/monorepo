"""Original component factory/registration and encoded Hero publication prefix.

The caller supplies a static resource handle. This does not replace original
resource selection or imply that the full appearance callback was accepted.
"""
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


def construct_supplied_hero_component(n, scheduler, unit, resource_handle, record, on_slice=None):
    if not n.library_pointer(unit,0x49a0) or not n.library_pointer(resource_handle,8):
        raise ValueError('Owned Hero and explicit static resource handle required')
    components=[]
    hook=n.u.hook_add(unicorn.UC_HOOK_CODE,
                     lambda *args:components.append(n.u.reg_read(r.UC_X86_REG_RAX)),
                     begin=n.base+0x10675c,end=n.base+0x10675c)
    frame=ADDRESSES['stack']-8
    n.u.mem_write(frame-0x300,bytes(0x300))
    n.put(frame-0x168,'Q',resource_handle)
    n.u.context_restore(n.initial)
    for reg,value in [(r.UC_X86_REG_RBP,frame),(r.UC_X86_REG_RSP,frame-0x1e0),
                      (r.UC_X86_REG_R13,unit+0x10),(r.UC_X86_REG_R15,unit)]:
        n.u.reg_write(reg,value)
    record.update(entryRva=0x10673c,endRva=0x106779,maximumSlices=64,
                  instructionsPerSlice=5000000,completed=False,slices=[])
    start=n.base+0x10673c
    try:
        for index in range(64):
            try: scheduler.run(start,n.base+0x106779,5000000)
            finally:
                start=n.u.reg_read(r.UC_X86_REG_RIP)
                row={'slice':index+1,'stop':start,'nextHeap':n.next_heap,
                     'fileCalls':len(getattr(n,'file_calls',[])),
                     'libraryCalls':len(getattr(n,'library_calls',[]))}
                record['slices'].append(row)
            if on_slice:on_slice(row)
            if start==n.base+0x106779:
                if len(components)!=1 or not components[0]:
                    raise ValueError('Original component prefix did not return one component')
                record.update(completed=True,component=components[0],
                              encodedHeroField39b8=n.q(unit+0x39b8))
                return components[0]
        raise ValueError('Original Hero component producer exceeded bounded CPU slices')
    finally:n.u.hook_del(hook)
