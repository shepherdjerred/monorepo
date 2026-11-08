"""Run the original library post-load stage over explicit static material roots."""
import unicorn
from unicorn import x86_const as r
from asset_wait_dispatch_native import NativeAssetWaitDispatch
from vfx_spawn_native import ADDRESSES


def postload_supplied_static_materials(n, graph, scheduler, type_hash=0xff9d3409):
    if not isinstance(scheduler, NativeAssetWaitDispatch) or scheduler.n is not n:
        raise ValueError('One shared owned asset dispatch context required')
    if type_hash not in [0xff9d3409, 0x205255d6]:
        raise ValueError('Only explicit StaticMaterialDef/CustomShaderDef roots admitted')
    roots = sorted((row for row in graph['cases'] if row['typeHash'] == type_hash), key=lambda row: row['identity'])
    if not 0 < len(roots) <= 256:
        raise ValueError('Bounded supplied StaticMaterialDef roots required')
    fixed = graph['fixups']
    if n.q(fixed['contextAddress']) != fixed['libraryAddress']:
        raise ValueError('Original fixed static library context differs')
    for address in [0x24882c8, 0x24882e0]:
        if n.base+address not in n.slots or n.q(n.slots[n.base+address]):
            raise ValueError('Original library postload requires idle owned TLS cells')
    table = n.allocate(len(roots)*24)
    for index, root in enumerate(roots):
        n.put(table+index*24,'QQII',root['loaded']['object'],n.types[root['typeHash']],root['identity'],0)
    entered, completed = [], []
    def identity():
        entry = n.q(n.slots[n.base+0x24882e0])
        if not table <= entry < table + len(roots)*24 or (entry-table)%24:
            raise ValueError('Original static material postload left its owned root table')
        return n.u32(entry+0x10)
    hooks = [n.u.hook_add(unicorn.UC_HOOK_CODE, callback, begin=n.base+address, end=n.base+address)
             for address, callback in [(0x14bb5cc, lambda *args: entered.append(identity())),
                                        (0x14bb5d8, lambda *args: completed.append(identity()))]]
    frame = ADDRESSES['stack'] - 8
    n.u.mem_write(frame-0x300,bytes(0x300));n.put(frame-0x178,'Q',fixed['contextAddress'])
    n.put(frame-0x160,'Q',len(roots))
    n.u.context_restore(n.initial)
    for reg,value in [(r.UC_X86_REG_RBP,frame),(r.UC_X86_REG_RSP,frame-0x1e0),(r.UC_X86_REG_R15,table)]:
        n.u.reg_write(reg,value)
    prior = (n.postloading, n.loading)
    n.postloading = n.loading = True
    start = n.base+0x14bb540
    slices=[]
    try:
        for index in range(32):
            scheduler.run(start,n.base+0x14bb5f6,5000000)
            start=n.u.reg_read(r.UC_X86_REG_RIP)
            slices.append({'index':index,'stop':start,'completedRoots':len(completed)})
            if start == n.base+0x14bb5f6: break
        else: raise ValueError('Original static material postload exceeded bounded slices')
    finally:
        n.postloading,n.loading = prior
        for hook in hooks:n.u.hook_del(hook)
    if entered != [row['identity'] for row in roots] or completed != entered or any(n.q(n.slots[n.base+a]) for a in [0x24882c8,0x24882e0]):
        raise ValueError('Original static material root/TLS completion differs')
    return {'originalStage':[0x14bb540,0x14bb5f6],'typeHash':type_hash,'roots':entered,'slices':slices,
            'callerSuppliedRootOrder':True,'completedSuppliedStage':True,
            'assetReadinessEstablished':False,'resourceCacheAccepted':False}
