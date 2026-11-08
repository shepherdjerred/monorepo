"""Original appearance execution with owned resource-wait dispatch boundaries."""
from unicorn import x86_const as r
from appearance_projection_native import observe_mesh_progress
from asset_wait_dispatch_native import NativeAssetWaitDispatch
from serialized_asset_progress_native import observe_serialized_asset_progress
from vfx_spawn_native import ADDRESSES


def project_appearance_with_asset_dispatch(n,projection,measure):
    n.projection_execution={'entryRva':0x668c0,'sliceInstructionBound':5000000,
                            'sliceCountBound':16,'completed':False,'progress':[]}
    scheduler=NativeAssetWaitDispatch(n)
    n.asset_wait_dispatch_observations={'waits':scheduler.waits,'cpuRuns':scheduler.runs,
        'scope':{'cooperativeSingleContext':True,'osWorkerThreadsCreated':False,
                 'concurrentExecutionModeled':False,'readinessFieldsSupplied':False,'mainViewerExpanded':False}}
    hooks=[]
    try:
        n.u.context_restore(n.initial);n.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        n.u.reg_write(r.UC_X86_REG_RDI,projection);n.u.reg_write(r.UC_X86_REG_RSI,0)
        start=n.base+0x668c0
        mesh,hooks=observe_mesh_progress(n);n.projection_execution['meshProgress']=mesh
        serialized,serialized_hooks=observe_serialized_asset_progress(n)
        hooks.extend(serialized_hooks);n.projection_execution['serializedAssetProgress']=serialized
        def sample():
            values=dict(measure())
            extra={'meshTriangles':sum(x['trianglesVisited'] for x in mesh),
                   'completedAssetReads':sum(x['completedReadWorker'] for x in n.asset_queue_jobs),
                   'serializedSourceBytes':serialized['totals']['coveredBytes'],
                   'completedNonemptyDecodeBatches':sum(x['completed'] and x['queuedBefore']>0 for x in n.asset_completion_runs)}
            if values.keys()&extra.keys():raise ValueError('Reserved cooperative appearance progress counter')
            values.update(extra)
            if (not values or len(values)>32 or any(type(v) is not int or v<0 for v in values.values())):
                raise ValueError('Cooperative appearance progress counters exceed bounds')
            return values
        for _ in range(16):
            before=sample();start=scheduler.run(start,ADDRESSES['stop']);after=sample()
            if after.keys()!=before.keys() or any(after[k]<v for k,v in before.items()):
                raise ValueError('Cooperative appearance progress identity changed or moved backward')
            n.projection_execution['progress'].append({k:after[k]-v for k,v in before.items()})
            if start==ADDRESSES['stop']:
                n.projection_execution['completed']=True;return n.projection_execution
            if after==before:
                raise ValueError('Appearance exhausted a bounded CPU slice without observed resource or mesh progress')
        raise ValueError('Original cooperative appearance exceeds sixteen bounded CPU slices')
    finally:
        for hook in hooks:n.u.hook_del(hook)
        scheduler.close()
