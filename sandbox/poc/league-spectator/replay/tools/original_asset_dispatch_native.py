"""Retain an existing original completion owner for caller-dispatched I/O.

The complete VFX/platform path can have constructed the native singleton before
the older data-only queue control runs. Bind that owned object to the adapter;
do not replace its native memory, worker count, semaphores or queued work.
"""


def initialize_original_asset_dispatch(n):
    queue = n.initialize_asset_work_queue()
    owner = n.q(n.base+0x2477f70)
    if not owner:
        completion = n.initialize_asset_completion_dispatcher(1)
    else:
        workers, pointer, count = n.u32(owner+8), n.q(owner+0x70), n.u32(owner+0x78)
        if (n.asset_completion_dispatcher is not None or n.allocations.get(owner) != 0x80 or
                n.q(owner) != n.base+0x23dd6f0 or not 1 <= workers <= 8 or not 0 <= count <= workers or
                count and not n.library_pointer(pointer, count*8)):
            raise ValueError('Existing original completion owner escaped its class/allocation/worker bounds')
        semaphores = [n.u32(owner+offset) for offset in [0x60, 0x64]]
        if any(token not in n.mach_semaphores or n.mach_semaphores[token]['destroyed'] for token in semaphores):
            raise ValueError('Existing completion owner has no live owned platform semaphores')
        # Host-side identity association only. Original object bytes, including
        # its real constructor-selected worker count and queues, stay intact.
        n.asset_completion_dispatcher = owner
        completion = {'object': owner, 'constructorRva': 0x142c130,
                      'existingOriginalOwnerRetained': True, 'workerCount': workers,
                      'workerObjects': count, 'platformSemaphoreTokens': semaphores,
                      'constructorBlockObserved': any(row['rva'] == 0x142c130 for row in n.blocks.values()),
                      'callerOwnsDispatch': True, 'osWorkerExecutionClaimed': False}
    return {'queue': queue, 'completion': completion}
