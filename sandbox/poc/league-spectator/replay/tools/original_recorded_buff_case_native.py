"""Execute one recorded descriptor on an original, explicitly cold control owner.

This is a component control, not recorded entity routing or a live frame clock.
The original callback constructs its own descriptor on its own retained stack.
"""
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from original_call_slices_native import call_original_sliced
from recorded_mode_constants_native import reject_unresolved_mode_reads
from vfx_spawn_native import sha, name_hash


def inspect_original_manager_slots(n, manager):
    start, end = n.q(manager+0x18), n.q(manager+0x20)
    if (end < start or (end-start) % 16 or end-start > 4096*16 or
            end > start and not n.library_pointer(start, end-start)):
        raise ValueError('Original buff-manager slot vector escaped bounded storage')
    slots = []
    for index, at in enumerate(range(start, end, 16)):
        obj, owner = n.q(at), n.q(at+8)
        if not n.library_pointer(obj, 0x90) or not owner or not n.library_pointer(owner, 0x18):
            raise ValueError('Original manager slot has no owned instance/shared owner')
        before = bytes(n.u.mem_read(obj, 0x90))
        n.call(0x831780, {r.UC_X86_REG_RDI: obj})
        active = n.u.reg_read(r.UC_X86_REG_RAX) & 255
        n.call(0x8319a0, {r.UC_X86_REG_RDI: obj})
        resource = n.u.reg_read(r.UC_X86_REG_RAX)
        if active not in [0, 1] or bytes(n.u.mem_read(obj, 0x90)) != before:
            raise ValueError('Original buff slot queries mutated state or returned a non-boolean')
        row = {'index': index, 'object': obj, 'owner': owner,
               'nativeActive': bool(active), 'nativeResource': resource,
               'queriedInstancePrefixSha256': sha(before)}
        if resource:
            if not n.library_pointer(resource, 16):
                raise ValueError('Original slot resource escaped native storage')
            pointer = n.q(resource+8)
            name = n.cstring(pointer)
            if not 0 < len(name) <= 256:
                raise ValueError('Original slot resource name exceeds its bound')
            n.call(0x144b3a0, {r.UC_X86_REG_RDI: pointer})
            row.update(resourceName=name.decode('ascii'), nativeNameHash=n.u.reg_read(r.UC_X86_REG_RAX) & 0xffffffff)
        slots.append(row)
    return {'slotCount': len(slots), 'activeSlotCount': sum(row['nativeActive'] for row in slots),
        'slots': slots, 'queryOnlyNoInstanceMutation': True,
        'activityGetterRva': 0x831780, 'resourceGetterRva': 0x8319a0,
        'scope': 'original-manager-slots-not-a-count-of-created-or-active-buffs'}


def homeguard_value(n, hero):
    unit, manager = hero['object'], hero['buffManager']
    n.call(0x845c50, {r.UC_X86_REG_RDI: manager, r.UC_X86_REG_RSI: 2})
    direct = n.u.reg_read(r.UC_X86_REG_RAX) & 0xff
    descriptor = n.types.get(name_hash('IsHomeguardParametricUpdater'))
    if descriptor is None:
        raise ValueError('Original authored Homeguard provider metadata is missing')
    size, constructor = n.q(descriptor+0x40), n.q(descriptor+0x20)
    if not 8 <= size <= 128 or not n.base <= constructor < n.base+len(n.image):
        raise ValueError('Original Homeguard provider constructor/extent differs')
    data, output = n.allocate(size+16), n.allocate(16)
    n.u.mem_write(data+size, b'\xa5'*16)
    n.call(constructor-n.base, {r.UC_X86_REG_RDI: data})
    if n.q(n.q(data)+0x28) != n.base+0x1188e0:
        raise ValueError('Original Homeguard provider virtual ABI differs')
    n.put(output+8, 'I', 0x7fc00000)
    n.call(0x1188e0, {r.UC_X86_REG_RDI: data, r.UC_X86_REG_RSI: unit+8,
                     r.UC_X86_REG_RDX: output})
    bits = n.u32(output+8)
    if (direct not in [0, 1] or bits != struct.unpack('<I', struct.pack('<f', float(direct)))[0] or
            bytes(n.u.mem_read(data+size, 16)) != b'\xa5'*16):
        raise ValueError('Original Homeguard provider disagrees with original active-buff getter')
    return {'directNativeBoolean': direct, 'providerFloat32Bits': bits,
            'nativeGetterRva': 0x845c50, 'nativeProviderRva': 0x1188e0}


def observe_recorded_buff_case(fixture, context, hero, capture_path, proof_path, result):
    n = fixture.native
    captured, proved = fixture.raw(Path(capture_path)), fixture.raw(Path(proof_path))
    capture, proof = json.loads(captured), json.loads(proved)
    if (capture['kind'] != 'original-packet-window-capture' or
            proof['kind'] != 'original-buff-rpc-argument-prefix-controls' or proof['boundary'] is not None or
            capture['build'] != n.profile['clientVersion'] or capture['protocol'] != n.profile['protocolDigest'] or
            capture['decoderImageSha256'] != sha(n.image) or proof['decoderImageSha256'] != sha(n.image) or
            proof['captureSha256'] != sha(captured)):
        raise ValueError('Exact original captured RPC and independent prefix proof required')
    for file, digest in capture['inputs'].items():
        if sha(fixture.raw(Path(file))) != digest:
            raise ValueError('Original recorded buff packet input changed: '+file)
    # A known original Shared-context resource is the deliberate component
    # control. Nothing assigns the packet's network identity to this cold unit.
    candidates = []
    by_sequence = {row['transportSequence']: row for row in capture['records']}
    if len(by_sequence) != len(capture['records']):
        raise ValueError('Original captured transport identities are ambiguous')
    for row in proof['records']:
        descriptor = bytes.fromhex(row.get('originalBuffDescriptorHex', ''))
        if (row['opcode'] == 1160 and len(descriptor) == 40 and
                struct.unpack_from('<II', descriptor, 4) == (10571956, 3579051965) and row['stream'] == 1):
            candidates.append((row, by_sequence[row['transportSequence']]))
    if not candidates:
        raise ValueError('Actual recorded Shared S4SpawnLock component case is absent')
    expected, item = candidates[0]
    if any(expected[key] != item[key] for key in
           ['opcode', 'time', 'param', 'transportSequence', 'stream', 'chunkId', 'blockOffset']):
        raise ValueError('Independent prefix proof does not identify the exact original packet')
    heap, obj = bytes.fromhex(item['heapHex']), bytes.fromhex(item['objectHex'])
    if (not 16 <= len(obj) <= len(heap) <= 0x10000 or not heap.startswith(obj) or
            struct.unpack_from('<II', obj, 8) != (1160, item['param'])):
        raise ValueError('Original captured buff object/arena identity differs')
    arena = 0x10200000
    if any(at < arena+len(heap) and at+size > arena for at, size in n.allocations.items()):
        raise ValueError('Captured packet arena overlaps a live native allocation')
    result.update(captureSha256=sha(captured), prefixProofSha256=sha(proved),
                  recorded={key: item[key] for key in ['opcode', 'time', 'param', 'transportSequence', 'stream']},
                  owner={key: hero[key] for key in ['object', 'buffManager']},
                  scope={'recordedEntityRoutingAdmitted': False, 'recordedClockAdmitted': False,
                         'coldControlledOwner': True, 'liveProviderAdmitted': False})
    with reject_unresolved_mode_reads(n, context['modeConstants']):
        result['before'] = homeguard_value(n, hero)
        result['managerSlotsBefore'] = inspect_original_manager_slots(n, hero['buffManager'])
        n.u.mem_write(arena, heap)
        observed = []
        def descriptor_observer(engine, address, size, user):
            at = n.u.reg_read(r.UC_X86_REG_RSI)
            if not 0x10000000 <= at <= 0x10010008-40:
                raise ValueError('Original callback descriptor escaped its retained scratch stack')
            data = bytes(n.u.mem_read(at, 40))
            if data.hex() != expected['originalBuffDescriptorHex']:
                raise ValueError('Original callback descriptor differs from independent prefix proof')
            observed.append(data.hex())
        hook = n.u.hook_add(unicorn.UC_HOOK_CODE, descriptor_observer,
                            begin=n.base+0x841368, end=n.base+0x841368)
        result['execution'] = {}
        try:
            call_original_sliced(n, 0x840ab0, {r.UC_X86_REG_RDI: hero['buffManager'],
                                             r.UC_X86_REG_RSI: arena}, result['execution'])
        finally:
            n.u.hook_del(hook)
            result['observedDescriptors'] = observed
        if len(observed) != 1:
            raise ValueError('Original recorded buff callback semantic boundary count differs')
        result['after'] = homeguard_value(n, hero)
        result['managerSlotsAfter'] = inspect_original_manager_slots(n, hero['buffManager'])
        resource_hash = struct.unpack_from('<I', bytes.fromhex(expected['originalBuffDescriptorHex']), 4)[0]
        matching = [row for row in result['managerSlotsAfter']['slots']
                    if row['nativeActive'] and row.get('nativeNameHash') == resource_hash]
        if (result['before']['directNativeBoolean'] != 0 or result['after']['directNativeBoolean'] != 1 or
                not matching):
            raise ValueError('Recorded cold-owner component did not establish its native Homeguard membership')
        result['matchingActiveSlots'] = [row['index'] for row in matching]
        result['componentBuffMembershipEstablished'] = True
