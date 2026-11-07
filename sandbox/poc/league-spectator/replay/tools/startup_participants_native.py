"""Original participant/visibility startup consumer over a recorded packet."""
import struct
from unicorn import x86_const as r
from vfx_spawn_native import sha


def initialize_recorded_participants(fixture,startup):
    n=fixture.native;packet=0x10200000
    if (not startup or not startup['scope']['actualRecordedPacket'] or startup['packetOpcode']!=728 or
            n.q(n.base+0x246c638)):
        raise ValueError('Verified recorded startup and a cold participant manager required')
    samples=fixture.read(fixture.cache/'research/startup-streams-input.json')
    objects=fixture.read(fixture.cache/'research/startup-streams-native.json')
    framing=fixture.read(fixture.cache/'research/startup-streams-framing-comparison.json')
    sample=samples['packets'][startup['packetKey']];observed=objects['observations'][startup['packetKey']]
    if (samples['build']!=n.profile['clientVersion'] or samples['protocol']!=n.profile['protocolDigest'] or
            samples['replaySha256']!=startup['replaySha256'] or framing['replaySha256']!=startup['replaySha256'] or
            framing['mismatches'] or framing['matched']!=2 or observed['status']!='complete' or
            sample['opcode']!=728 or sample['stream']!=3 or sample['time']!=0 or sample['param']!=0 or
            observed['payloadSha256']!=sha(bytes.fromhex(sample['payloadHex'])) or
            objects['decoderImageSha256']!=sha(n.image) or objects['constructorImageSha256']!=n.profile['constructorImageSha256']):
        raise ValueError('Matching original recorded startup framing and decoded object required')
    obj=bytes.fromhex(observed['object']);heap=bytes.fromhex(observed['heap'])
    if (len(obj)!=568 or not len(obj)<=len(heap)<=0x100000 or heap[:len(obj)]!=obj or
            struct.unpack_from('<H',obj,8)[0]!=728):
        raise ValueError('Recorded native startup object size/arena differs')
    rows,count,capacity=struct.unpack_from('<QII',obj,0x40)
    if not 0<count<=56 or not count<=capacity<=65536 or not packet<=rows<=packet+len(heap)-count*0xd0:
        raise ValueError('Recorded participant vector exceeds its decoded arena')
    if any(n.q(n.base+0x2562b10+i*0x120+0x60) for i in range(57)):
        raise ValueError('Original static participant slots must be cold')
    # Independent blocks from the original static module construct all 57
    # slots and initialize the two special IDs. Omit only exit registration;
    # no slot strings, active flags or sentinel IDs are supplied by the host.
    n.call(0x6cba4b,{},0x6cba57)
    n.call(0x6cba71,{},0x6cba7f)
    n.u.mem_write(packet,heap)
    manager=n.allocate(0x1a8);n.u.mem_write(manager+0xa8,b'\xa5'*0x100)
    n.call(0x6cbd30,{r.UC_X86_REG_RDI:manager})
    if n.q(n.base+0x246c638)!=manager:raise ValueError('Original participant manager publication differs')
    # Original handler loads the actual singleton and forwards R14 unchanged.
    # This executes the complete 6cdc90 consumer, stopping before unrelated
    # startup settings systems in the enclosing handler.
    n.call(0x6f6471,{r.UC_X86_REG_R14:packet},0x6f6480)
    if bytes(n.u.mem_read(manager+0xa8,0x100))!=b'\xa5'*0x100:
        raise ValueError('Original participant constructor/consumer escaped its guard')
    counts={hex(offset):n.u32(manager+offset) for offset in [8,0xc,0x10,0x14]}
    if any(value>56 for value in counts.values()):
        raise ValueError('Original participant counters exceed the static slot table')
    slots=[]
    for index in range(57):
        at=n.base+0x2562b10+index*0x120
        active=n.u.mem_read(at+0x20,1)[0]
        if active not in [0,1]:raise ValueError('Original participant table has a non-boolean active flag')
        if not active:continue
        key=n.q(at)
        record={'index':index,'nativeDataHex':bytes(n.u.mem_read(at,0x120)).hex()}
        if index:
            n.call(0x6cbe60,{r.UC_X86_REG_RDI:manager,r.UC_X86_REG_RSI:key})
            resolved=n.u.reg_read(r.UC_X86_REG_EAX)
            if resolved!=index:raise ValueError('Original participant identity lookup differs from its active slot')
            record['originalIdentityLookupMatches']=True
        slots.append(record)
    n.call(0x6bb8f0,{})
    mask=n.u.reg_read(r.UC_X86_REG_RAX);excluded,included=bytes(n.u.mem_read(n.base+0x2566b30,2))
    expected=(1<<64)-1 if counts['0x8']+1>63 else (1<<(counts['0x8']+1))-1
    expected=(expected&~(1<<(excluded&63)))|(1<<(included&63))
    if mask!=expected:raise ValueError('Original participant mask differs from its native counters and sentinels')
    return {'packetKey':startup['packetKey'],'replaySha256':startup['replaySha256'],
            'sourceObjectSha256':sha(obj),'sourceHeapSha256':sha(heap),'sourceVectorOffset':0x40,
            'sourceVectorEntries':count,'sourceVectorStride':0xd0,'manager':manager,
            'originalStaticInitializationBlocks':[[0x6cba4b,0x6cba57],[0x6cba71,0x6cba7f]],
            'originalConstructorRva':0x6cbd30,'originalHandlerBlock':[0x6f6471,0x6f6480],
            'originalConsumerRva':0x6cdc90,'counterFields':counts,'slots':slots,
            'originalMaskGetterRva':0x6bb8f0,'allParticipantMaskHex':f'{mask:016x}',
            'nativeMaskExcludedSlot':excluded,'nativeMaskIncludedSlot':included,
            'managerHeaderHex':bytes(n.u.mem_read(manager,0xa8)).hex(),'guardIntact':True,
            'scope':{'actualRecordedStartupPacket':True,'originalConsumerCompleted':True,
                     'slotCountSupplied':False,'slotIdsSupplied':False,'maskSupplied':False,
                     'fullStaticModuleExecuted':False,
                     'matchTeamMembershipInterpreted':False,'liveVisibilityReconstructed':False,
                     'fullStartupHandlerExecuted':False,'mainViewerExpanded':False}}
