"""Original CPU audio-emitter service; device activation remains separate."""
from unicorn import x86_const as r


def initialize_audio_emitter_service(n):
    facade=n.q(n.base+0x246d500)
    if not facade or n.allocations.get(facade)!=0x98 or n.q(facade+0x38):
        raise ValueError('Original owned audio facade with an unbound emitter service required')
    service=n.allocate(0x300);n.u.mem_write(service+0x200,b'\xa5'*0x100)
    n.call(0x253120,{r.UC_X86_REG_RDI:service})
    if (n.q(service+0xf0) or n.q(service+0xf8) or n.q(service+0x100) or n.q(service+0x108) or
            bytes(n.u.mem_read(service+0x200,0x100))!=b'\xa5'*0x100):
        raise ValueError('Original audio service constructor changed its empty registry or guard')
    # Preserve the actual service publication instruction from the facade's
    # normal binding callback. The provider-owner bootstrap and subsequent
    # device activation are not executed by this isolated CPU composition.
    n.call(0x24c008,{r.UC_X86_REG_RBX:facade,r.UC_X86_REG_RAX:service},0x24c00c)
    if n.q(facade+0x38)!=service:raise ValueError('Original audio facade did not retain its CPU emitter service')
    return {'facade':facade,'service':service,'originalConstructorRva':0x253120,
            'originalProviderAllocationRva':0x253088,'originalPublicationBlock':[0x24c008,0x24c00c],
            'serviceHeaderHex':bytes(n.u.mem_read(service,0x200)).hex(),'guardIntact':True,
            'scope':{'originalCpuConstructorCompleted':True,'originalFacadePublicationExecuted':True,
                     'providerOwnerBootstrapExecuted':False,'deviceActivated':False,
                     'soundPlaybackImplemented':False,'recordedAudioStateReconstructed':False,'mainViewerExpanded':False}}


def inspect_audio_emitter_registry(n,service):
    if not n.library_pointer(service,0x200):raise ValueError('Owned original audio emitter service required')
    count=n.q(service+0x108);node=n.q(service+0x100);seen=set();entries=[]
    if count>65536:raise ValueError('Audio emitter registry exceeds explicit entry bound')
    while node:
        if node in seen or len(seen)>=count or not n.library_pointer(node,0x20):
            raise ValueError('Original audio emitter registry ownership/count differs')
        seen.add(node);interface=n.q(node+0x18)
        if n.allocations.get(interface-8)!=0x70:
            raise ValueError('Original emitter registry did not retain the allocated interface')
        key=n.u32(node+0x10)
        callback=n.q(n.q(interface))-n.base
        if not 0<=callback<0x1fef000:raise ValueError('Original emitter ID getter escaped matching code')
        n.call(callback,{r.UC_X86_REG_RDI:interface})
        if n.u.reg_read(r.UC_X86_REG_EAX)!=key:raise ValueError('Original emitter identity differs from its registry key')
        entries.append({'key':key,'interface':interface,'object':interface-8,'originalIdGetterRva':callback})
        node=n.q(node)
    if len(seen)!=count or len({e['key'] for e in entries})!=count:
        raise ValueError('Original audio registry count or unique IDs differ')
    return {'service':service,'entries':entries,'count':count,
            'scope':{'cpuRegistryInspected':True,'soundPlaybackVerified':False,'mainViewerExpanded':False}}
