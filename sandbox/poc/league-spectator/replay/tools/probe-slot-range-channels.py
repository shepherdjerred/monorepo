"""Original slot channel field/dispatch controls, with no actual range admission."""
import argparse
import json
from pathlib import Path
import struct
import sys
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Changed slot input '+str(path))
        inputs[str(path)] = digest
        return data
    observed = json.loads(raw(cache/'research/slot-range-channel-observations-v35.json'))
    for path, digest in observed['inputs'].items():
        if sha(raw(path)) != digest:
            raise ValueError('Stale decoded slot input '+path)
    n = NativeSpawn(cache/'public/decoder-16.21-macos', args.client)
    if observed['build'] != n.profile['clientVersion'] or observed['protocol'] != n.profile['protocolDigest']:
        raise ValueError('Slot channel exact build mismatch')
    channels = [
        (678,0x113460,0x11347c,0x11349c,0x113660,0x113e00,0xede6a,0xededb),
        (674,0x113690,0x1136ac,0x1136cc,0x113890,0x113e00,0xedf44,0xedfb5),
        (1196,0x1138c0,0x1138dc,0x1138fc,0x113ac0,0x113e00,0xee01e,0xee08f),
    ]
    # Only original field conversion executes for this exhaustive codec control.
    packet = n.allocate(56)
    columns, dispatch, registration_controls = {}, [], []
    for opcode, entry, start, end, table, handler, _, _ in channels:
        column = []
        for value in range(256):
            n.put(packet+0x28,'B',value)
            n.call(start,{r.UC_X86_REG_RSI:packet},end)
            column.append(n.u.reg_read(r.UC_X86_REG_ESI))
        if sorted(column) != list(range(256)):
            raise ValueError('Original slot codec not bijective')
        columns[opcode] = column
        for kind in range(1,10):
            target = table+struct.unpack_from('<i',n.image,table+4*(kind-1))[0]
            dispatch.append({'opcode':opcode,'kind':kind,'targetRva':target})
    for opcode, entry, _, _, _, _, start, end in channels:
        # Original wrapper construction and registration argument preparation.
        frame=0x10008000
        n.call(start,{r.UC_X86_REG_RBP:frame,r.UC_X86_REG_R13:frame-0x60,
                      r.UC_X86_REG_R15:0,r.UC_X86_REG_RBX:0},end)
        wrapper=n.u.reg_read(r.UC_X86_REG_RCX)
        trampoline=n.q(wrapper+0x10)-n.base
        code=n.image[trampoline:trampoline+10]
        jump=code.index(b'\xe9')
        target=trampoline+jump+5+struct.unpack_from('<i',code,jump+1)[0]
        if n.u.reg_read(r.UC_X86_REG_EDX)!=opcode or target!=entry:
            raise ValueError('Original packet registration does not reach consumer')
        registration_controls.append({'opcode':opcode,'originalRegistrationPrefix':[start,end],
                                      'handlerRva':trampoline,'trampolineTargetRva':target})
    if not all(columns[678] == column for column in columns.values()):
        raise ValueError('Original channel slot codecs differ')
    records, assignment_prefix_controls = [], []
    for row in observed['records']:
        data = bytes.fromhex(row['objectHex'])
        kind = struct.unpack_from('<I',data,0x2c)[0]
        length = struct.unpack_from('<I',data,0x18)[0]
        slot = columns[row['opcode']][data[0x28]]
        heap = bytes.fromhex(row['heapHex'])
        offset = row['pointerOffset']
        if offset is None or length == 0 or offset+length > len(heap):
            raise ValueError('Original update payload bounds')
        payload = heap[offset:offset+length]
        if kind == 2:
            if payload[-1] != 0 or b'\0' in payload[:-1]:
                raise ValueError('Original spell assignment name is not one terminated string')
            name = payload[:-1].decode('ascii')
        else:
            name = None
        records.append({key:row[key] for key in ['transportSequence','time','opcode','param','stream','chunkId','blockOffset','payloadSha256']} |
                       {'kind':kind,'slot':slot,'spellbookLookupSlot':slot if slot<64 else 0,
                        'valueHex':payload.hex(),'spellName':name})
        if kind==2:
            # Original consumer runs through all assignment flags and stops at
            # the real handler entry. No simulated resource lookup is supplied.
            relocated=n.allocate(max(len(payload),16))
            n.u.mem_write(relocated,payload)
            n.u.mem_write(packet,data)
            n.put(packet+0x10,'Q',relocated)
            entry=next(channel[1] for channel in channels if channel[0]==row['opcode'])
            n.call(entry,{r.UC_X86_REG_RDI:0x10020000,r.UC_X86_REG_RSI:packet},0x113e00)
            actual_slot=n.u.reg_read(r.UC_X86_REG_ESI)
            actual_name=n.u.reg_read(r.UC_X86_REG_R9)
            if actual_slot!=slot or actual_name!=relocated:
                raise ValueError('Original assignment arguments differ')
            assignment_prefix_controls.append({'transportSequence':row['transportSequence'],'slot':slot,
                'spellName':name,'flagEDX':n.u.reg_read(r.UC_X86_REG_EDX),
                'flagECX':n.u.reg_read(r.UC_X86_REG_ECX),'flagR8D':n.u.reg_read(r.UC_X86_REG_R8D),
                'boundaryRva':0x113e00})
    # Execute the whole kind3 consumer, original lookup and original setter.
    # The receiver owns only a declared table of constructed slots, not a live actor/model.
    actor = n.allocate(0x4000)
    slots = []
    for index in range(64):
        at = n.allocate(0x150)
        n.call(0x84b390,{r.UC_X86_REG_RDI:at,r.UC_X86_REG_RSI:index,r.UC_X86_REG_RDX:0})
        n.put(actor+0x2850+0xae0+index*8,'Q',at)
        slots.append(at)
    inverse = {value:index for index,value in enumerate(columns[678])}
    controls = []
    value = n.allocate(16)
    for opcode,entry,*_ in channels:
        for slot in [0,51,63,64,255]:
            for bits in [0,0x80000000,0xc37a0000,0x44610000,0x7fc00123]:
                for at in slots:
                    n.put(at+0x8c,'I',0x42f60000)
                n.put(value,'I',bits)
                n.put(packet+0x10,'Q',value)
                n.put(packet+0x28,'B',inverse[slot])
                n.put(packet+0x2c,'I',3)
                n.call(entry,{r.UC_X86_REG_RDI:actor,r.UC_X86_REG_RSI:packet})
                selected = slot if slot < 64 else 0
                outputs = [struct.unpack('<I',n.u.mem_read(at+0x8c,4))[0] for at in slots]
                expected = [bits if index == selected else 0x42f60000 for index in range(64)]
                if outputs != expected or n.u.reg_read(r.UC_X86_REG_RAX)&255 != 1:
                    raise ValueError('Original consumer/lookup/setter changed slot or float bits')
                controls.append({'opcode':opcode,'slot':slot,'lookupSlot':selected,'inputHex':struct.pack('<I',bits).hex(),
                                 'outputHex':struct.pack('<I',outputs[selected]).hex(),'fullConsumerReturned':True})
    list_controls=[]
    for row in [row for row in records if row['kind']==7]:
        for at in slots:
            n.put(at+0x8c,'f',900.)
        source=next(source for source in observed['records'] if source['transportSequence']==row['transportSequence'])
        payload=bytes.fromhex(row['valueHex'])
        value_at=n.allocate(len(payload));n.u.mem_write(value_at,payload)
        n.u.mem_write(packet,bytes.fromhex(source['objectHex']));n.put(packet+0x10,'Q',value_at)
        entry=next(channel[1] for channel in channels if channel[0]==row['opcode'])
        n.call(entry,{r.UC_X86_REG_RDI:actor,r.UC_X86_REG_RSI:packet})
        if any(bytes(n.u.mem_read(at+0x8c,4))!=struct.pack('<f',900.) for at in slots):
            raise ValueError('Original kind7 control altered a range override')
        list_controls.append({'transportSequence':row['transportSequence'],'ownerId':row['param'],
                              'slot':row['slot'],'fullConsumerReturned':True,'all64OverridesPreserved':True,
                              'suppliedConstructedSlotsHaveNoPreparedController':True})
    rank_records=[]
    for row in observed['rankRecords']:
        data=bytes.fromhex(row['objectHex'])
        if len(data)!=24:raise ValueError('Original rank packet layout mismatch')
        n.u.mem_write(packet,data)
        n.call(0x8b2b10,{r.UC_X86_REG_RDI:actor+0x2850,r.UC_X86_REG_RSI:packet},0x8b2bcf)
        selected=n.u.reg_read(r.UC_X86_REG_RDX)
        if not 0<=selected<64:raise ValueError('Rank lookup escaped slot table')
        for at in slots:n.put(at+0x28,'I',0x12345678)
        n.call(0x8b2b10,{r.UC_X86_REG_RDI:actor+0x2850,r.UC_X86_REG_RSI:packet})
        rank=struct.unpack('<i',n.u.mem_read(slots[selected]+0x28,4))[0]
        if any(struct.unpack('<I',n.u.mem_read(at+0x28,4))[0]!=0x12345678
               for index,at in enumerate(slots) if index!=selected):
            raise ValueError('Rank packet changed an unrelated slot rank')
        rank_records.append({key:row[key] for key in ['transportSequence','time','opcode','param','stream','chunkId','blockOffset','payloadSha256']} |
                            {'lookupSlot':selected,'rank':rank,'fullOriginalConsumerReturned':True})
    rank_setter_controls=[]
    for supplied in [-2,-1,0,1,6,7,100]:
        n.call(0x8481f0,{r.UC_X86_REG_RDI:slots[51],r.UC_X86_REG_ESI:supplied&0xffffffff})
        actual=struct.unpack('<i',n.u.mem_read(slots[51]+0x28,4))[0]
        if actual!=min(supplied,6):raise ValueError('Original rank upper-bound behavior differs')
        rank_setter_controls.append({'supplied':supplied,'actual':actual})
    actor_id = 1073741890
    candidates = json.loads(raw(cache/'research/projected-missile-endpoint-native-v35.json'))['cases']
    binding_prefix = []
    for candidate in candidates:
        relevant = [row for row in records if row['param']==actor_id and row['slot']==candidate['normalizedSlot154']
                    and row['transportSequence']<int(candidate['sourceEventId'].split(':')[1])]
        assignments = [row for row in relevant if row['kind']==2]
        overrides = [row for row in relevant if row['kind']==3]
        binding_prefix.append({'sequence':candidate['sequence'],'sourceEventId':candidate['sourceEventId'],
                               'lastResourceAssignment':assignments[-1] if assignments else None,
                               'recordedRangeOverrides':overrides,
                               'actualConsumedRangeEstablished':False})
    for name in ['profile.json','image.bin']:
        raw(cache/'public/decoder-16.21-macos'/name)
    raw(args.client)
    for module in tuple(sys.modules.values()):
        path = getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):
            raw(path)
    for path,digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Slot probe input drift '+path)
    result = {'schema':1,'status':'PASS','kind':'original-slot-range-channel-codec-dispatch-control','artifactVersion':35,
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'inputs':inputs,
              'slotDecode':columns[678],'dispatch':dispatch,'controls':controls,'records':records,
              'registrationControls':registration_controls,'assignmentPrefixControls':assignment_prefix_controls,
              'kindSevenControls':list_controls,
              'rankRecords':rank_records,'rankSetterControls':rank_setter_controls,
              'candidatePrefixes':binding_prefix,'blocks':list(n.blocks.values()),
              'scope':{'originalFullKindThreeConsumers':True,'originalConstructedSlotsAndLookup':True,
                       'slotTableSuppliedControl':True,'originalAssignmentCompleted':False,
                       'initialLiveOverrideEstablished':False,'allAliasedWritersExcluded':False,
                       'activeDecoderIntegration':False,'actualLiveRangeAdmitted':False}}
    output = cache/'research/slot-range-channel-native-v35.json'
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'records':len(records),'controls':len(controls),
                      'candidateAssignments':[{'sequence':row['sequence'],'last':row['lastResourceAssignment']} for row in binding_prefix]}))


if __name__=='__main__':
    main()
