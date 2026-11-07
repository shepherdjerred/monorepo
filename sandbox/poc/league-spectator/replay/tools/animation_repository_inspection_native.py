"""Read loaded original ANM resource classes and their native timing getters."""
import math
import struct
from unicorn import x86_const as r


def inspect_animation_repository(n):
    repository=n.q(n.base+0x24712c0)
    if not repository or not n.library_pointer(repository,0x28):raise ValueError('Owned animation repository required')
    state=n.asset_queue_state()
    if (any(row['outstanding'] or row['queued'] for row in state['buckets']) or
            any(state[key] for key in ['completionJobs','decodedCallbacks','pendingCallbacks'])):
        raise ValueError('Animation resource inspection requires completed owned dispatch')
    count=n.q(repository+0x20)
    if not 0<count<=65536:raise ValueError('Original animation repository count exceeds bounds')
    pending=[(n.q(repository+0x18),repository+0x18)];seen=set();resources=[]
    classes={0x23e3a00:('uncompressed',0x15bfb50,0x15bfaf0),
             0x23e3950:('compressed',0x15bf960,0x15bf940)}
    while pending:
        node,parent=pending.pop()
        if not node:continue
        if node in seen or len(seen)>=count or not n.library_pointer(node,0x38) or n.q(node+0x10)!=parent:
            raise ValueError('Original animation repository tree ownership/count differs')
        seen.add(node);pending.extend([(n.q(node),node),(n.q(node+8),node)])
        resource=n.q(node+0x30);owners=n.u32(node+0x28)
        if not owners or not n.library_pointer(resource,0x70):raise ValueError('Animation repository has no owned referenced resource')
        vtable=n.q(resource)-n.base
        if vtable not in classes:
            raise ValueError('Animation resource remains pending, failed, or has an unadmitted class: '+hex(vtable))
        kind,frame_getter,fps_getter=classes[vtable]
        n.call(frame_getter,{r.UC_X86_REG_RDI:resource});frames=n.u.reg_read(r.UC_X86_REG_EAX)
        n.call(fps_getter,{r.UC_X86_REG_RDI:resource})
        fps=struct.unpack('<f',struct.pack('<I',n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0]
        if not 0<frames<=100000 or not math.isfinite(fps) or not 0<fps<=10000:
            raise ValueError('Loaded original animation timing exceeds explicit bounds')
        resources.append({'key':n.q(node+0x20),'resource':resource,'owners':owners,'kind':kind,
                          'vtableRva':vtable,'frameGetterRva':frame_getter,'fpsGetterRva':fps_getter,
                          'frames':frames,'fps':fps,'headerHex':bytes(n.u.mem_read(resource,0x70)).hex()})
    if len(seen)!=count or len({row['key'] for row in resources})!=count:
        raise ValueError('Original animation repository has missing nodes or duplicate identities')
    return {'repository':repository,'resources':sorted(resources,key=lambda row:row['key']),
            'scope':{'loadedResourceClassesVerified':True,'nativeTimingGettersExecuted':True,
                     'framePosesEvaluated':False,'animationEventsDispatched':False,'mainViewerExpanded':False}}
