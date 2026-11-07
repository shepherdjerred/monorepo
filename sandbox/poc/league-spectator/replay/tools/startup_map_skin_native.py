"""Recover the recorded MapSkin argument through original startup consumers."""
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import sha


def recover_startup_map_skin(n,cache,root,read,raw):
    samples = read(cache/'research/startup-streams-input.json')
    framing = read(cache/'research/startup-streams-framing-comparison.json')
    objects = read(cache/'research/startup-streams-native.json')
    proof = read(cache/'research/startup-mode-native.json')
    if (samples['build'] != n.profile['clientVersion'] or samples['protocol'] != n.profile['protocolDigest'] or
            framing['mismatches'] or framing['matched'] != 2 or framing['replaySha256'] != samples['replaySha256'] or
            objects['decoderImageSha256'] != sha(n.image) or
            objects['constructorImageSha256'] != n.profile['constructorImageSha256'] or
            not proof['scope']['actualRecordedStartupPacket'] or not proof['scope']['fullNativeModeSetterGetterExecuted']):
        raise ValueError('Matching original startup packet and native configuration proof required')
    for name,digest in samples['sources'].items():
        if sha(raw(root/name)) != digest:raise ValueError('Startup framing producer changed: '+name)
    for name,digest in proof['sources'].items():
        if sha(raw(root/'tools'/name)) != digest:raise ValueError('Startup configuration producer changed: '+name)
    for name,digest in proof['inputs'].items():
        if sha(raw(Path(name))) != digest:raise ValueError('Startup configuration input changed: '+name)
    selected = [(key,value) for key,value in samples['packets'].items() if value['opcode'] == 728]
    if len(selected) != 1:raise ValueError('One recorded startup configuration packet required')
    key,sample = selected[0]
    observation = objects['observations'][key]
    if (sample['stream'] != 3 or sample['time'] != 0 or sample['param'] != 0 or
            observation['status'] != 'complete' or observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex']))):
        raise ValueError('Incomplete or different recorded startup configuration')
    obj,heap = bytes.fromhex(observation['object']),bytes.fromhex(observation['heap'])
    if len(obj) != 568 or obj != heap[:len(obj)] or struct.unpack_from('<H',obj,8)[0] != 728:
        raise ValueError('Original startup packet layout differs')
    pointer,count,capacity = struct.unpack_from('<QII',obj,0x1e8)
    if (not 0 < count <= 128 or capacity <= count or
            not 0x10200000 <= pointer <= 0x10200000+len(heap)-count-1):
        raise ValueError('Recorded map-skin text escaped the decoded arena')
    offset = pointer-0x10200000
    if heap[offset+count] or any(not 32 <= byte <= 126 for byte in heap[offset:offset+count]):
        raise ValueError('Recorded map-skin text is not bounded terminated ASCII')
    expected = heap[offset:offset+count].decode('ascii')
    mode_pointer,mode_length,mode_capacity = struct.unpack_from('<QII',obj,0xb8)
    if (not 0 < mode_length <= 64 or mode_capacity <= mode_length or
            not 0x10200000 <= mode_pointer <= 0x10200000+len(heap)-mode_length-1):
        raise ValueError('Recorded mode escaped the decoded startup arena')
    mode_offset = mode_pointer-0x10200000
    expected_mode = heap[mode_offset:mode_offset+mode_length].decode('ascii')
    if heap[mode_offset+mode_length]:raise ValueError('Recorded mode lacks a terminator')
    if n.q(n.base+0x246d020):raise ValueError('Map-skin recovery requires a cold configuration global')
    n.u.mem_write(0x10200000,heap)
    config = n.allocate(0x208)
    n.call(0x61e8b0,{r.UC_X86_REG_RDI:config})
    if n.q(n.base+0x246d020) != config:raise ValueError('Original configuration publication differs')
    n.call(0x6f6599,{r.UC_X86_REG_R14:0x10200000},0x6f65a7)
    forwarded = n.u.reg_read(r.UC_X86_REG_RSI)
    if forwarded != 0x10200070:raise ValueError('Original startup forwarded a different subobject')
    n.call(0x66eef3,{r.UC_X86_REG_RBX:forwarded},0x66ef00)
    if n.u.reg_read(r.UC_X86_REG_RDI) != config or n.u.reg_read(r.UC_X86_REG_RSI) != forwarded:
        raise ValueError('Original startup configuration forwarding differs')
    n.call(0x61f287,{r.UC_X86_REG_RSI:forwarded,r.UC_X86_REG_RBX:config},0x61f2ef)
    n.call(0x61f329,{r.UC_X86_REG_R13:forwarded,r.UC_X86_REG_RBX:config},0x61f339)
    n.call(0x62023c,{r.UC_X86_REG_R13:forwarded,r.UC_X86_REG_RBX:config},0x620248)
    n.call(0x620940,{r.UC_X86_REG_RDI:config})
    actual_mode = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.u32(config+0x98) != mode_length or n.cstring(actual_mode).decode('ascii') != expected_mode:
        raise ValueError('Original configuration mode differs from the recorded field')
    n.call(0x60c3f9,{r.UC_X86_REG_RBX:config},0x60c40f)
    map_id,variant_at = n.u.reg_read(r.UC_X86_REG_R14),n.u.reg_read(r.UC_X86_REG_R15)
    if variant_at != config+0x58 or n.u32(variant_at+8) != count:
        raise ValueError('Original bootstrap selected a different configuration string')
    actual = bytes(n.u.mem_read(n.q(variant_at),count)).decode('ascii')
    if actual != expected or n.u.mem_read(n.q(variant_at)+count,1)[0]:
        raise ValueError('Original configuration MapSkin differs from the recorded field')
    n.call(0x60c419,{r.UC_X86_REG_R14:map_id,r.UC_X86_REG_R15:variant_at},0x60c41f)
    if n.u.reg_read(r.UC_X86_REG_RDI) != map_id or n.u.reg_read(r.UC_X86_REG_RSI) != variant_at:
        raise ValueError('Original map bootstrap argument forwarding differs')
    return {'packetKey':key,'replaySha256':samples['replaySha256'],'packetOpcode':728,'packetStream':3,
            'packetStringOffset':0x1e8,'packetStringPointer':pointer,'packetStringLength':count,
            'configurationObject':config,'configurationStringOffset':0x58,'getterRva':0x620910,
            'bootstrapCallRva':0x60c41f,'bootstrapCalleeRva':0x60c4b0,
            'variant':actual,'mapId':map_id,'mode':expected_mode,
            'originalFieldConsumerAndBootstrapArgumentsExecuted':True,
            'scope':{'actualRecordedPacket':True,'fullStartupHandlerExecuted':False,
                     'onlySelectedConfigurationFieldsCopied':['mapId','mapSkin','mode'],
                     'fullMapBootstrapExecuted':False,'mapSkinConstructorExecuted':False,
                     'liveWorldRoutingVerified':False,'mainViewerExpanded':False}}
