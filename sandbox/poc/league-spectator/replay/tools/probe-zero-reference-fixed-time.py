"""Original zero-reference FixedTime factory, first packet and controller frames.

Current replay-adapter roots are supplied, not native match state. The authored
tracking flag stays true. The original empty CastInfo selector supplies zero;
the full factory/target query must retain the authored terrain-derived endpoint.
No active presentation family is admitted by this proof.
"""
import argparse
import json
from pathlib import Path
import struct
import sys

import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--frame-schedule', choices=['creation-ticks', 'replay-uniform', 'replay-event-splits', 'supplied-interior-split'], default='creation-ticks')
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Zero-reference source changed during capture')
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    world = read(cache/'research/missile-caster-world-inputs-v33.json')
    for path, digest in world['inputs'].items():
        if sha(raw(path)) != digest:
            raise ValueError('Current caster/world source changed: '+path)
    report = read(cache/'research/viewer-root-reconstruction.json')['report']
    native_packets = read(cache/'research/projectile-combat-native.json')
    packets = {row['payloadSha256']: row for row in native_packets['observations'].values()
               if row['opcode'] == 28 and row['status'] == 'complete'}
    scene = read(cache/'public/latest-scene/manifest.json')
    motion_definition = read(cache/'public/decoder-16.21-macos/missile-motion.json')
    n = NativeSpawn(cache/'public/decoder-16.21-macos', args.client)
    f = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
    bits = lambda value: int.from_bytes(struct.pack('<f', value), 'little')
    vector_hex = lambda at: bytes(n.u.mem_read(at, 12)).hex()
    clock = {'time': 0., 'delta': f(1/60), 'globalDelta': f(1/60)}
    clock_calls = []
    manager, view = n.allocate(0x20), n.allocate(0x20)
    n.put(manager+0x10, 'Q', view)
    n.put(n.base+0x246d000, 'Q', manager)

    def supply_clock(engine, address, size, user):
        if engine.reg_read(r.UC_X86_REG_RDI) != view:
            raise ValueError('Original controller clock escaped supplied view')
        caller = n.q(engine.reg_read(r.UC_X86_REG_RSP))-n.base
        if address == n.base+0x15ed8e0:
            value = clock['time']
        else:
            if caller not in [0x88b90a, 0x87f9e8, 0x890899]:
                raise ValueError('Unexpected original controller delta callsite: '+hex(caller))
            value = clock['delta' if caller == 0x88b90a else 'globalDelta']
        clock_calls.append({'rva':address-n.base,'callerRva':caller,'suppliedFloat32':value})
        engine.reg_write(r.UC_X86_REG_XMM0, bits(value))
        n.ret()

    for entry in [0x15ed8e0, 0x15ed930]:
        n.u.hook_add(unicorn.UC_HOOK_CODE, supply_clock, begin=n.base+entry, end=n.base+entry)
    heights = raw(cache/'public/latest-scene/heights.bin')
    grid_manager, grid, height_at = n.allocate(0x20), n.allocate(0x200), n.allocate(len(heights))
    n.put(grid_manager+8, 'Q', grid)
    n.put(n.base+0x246c948, 'Q', grid_manager)
    n.put(grid+0xbc, 'fff', *scene['map']['min'])
    n.put(grid+0xc8, 'fff', *scene['map']['max'])
    n.put(grid+0xf8, 'Q', height_at)
    dimensions = scene['map']['heightGrid']
    n.put(grid+0x100, 'IIff', dimensions['x'], dimensions['z'], *dimensions['step'])
    n.u.mem_write(height_at, heights)
    cases = []
    for source in world['cases']:
        record = next(row for row in report['missiles'] if row['sequence'] == source['sequence'])
        hero = next(row for row in report['heroes'] if row['entityId'] == record['cast']['ownerId'])
        asset = scene['champions'][f"{hero['champion'].lower()}/{hero['skinId']}"]
        catalog = read(cache/'public/latest-scene'/asset['spellCatalog'])
        spell = catalog['spells'][str(record['cast']['spellHash'])]['data']
        spec = spell['mMissileSpec']
        component = spec['movementComponent']
        settings = {key: component.get(key, field['default']) for key, field in motion_definition['fields'].items() if key != 'mSpeed'}
        settings['mTravelTime'] = component.get('mTravelTime', 0)
        if (component['__type'] != 'FixedTimeMovement' or not settings['mTracksTarget'] or
                record['cast']['targetCount'] != 0 or record['cast']['requestedTargets'] != [] or
                record['cast']['indexedOverrideCount'] != 0 or record['elapsedSeconds'] != 0 or
                settings['mProjectTargetToCastRange'] or settings['mUseHeightOffsetAtEnd'] or
                settings['mStartDelay'] != 0):
            raise ValueError('Strict actual zero-reference, zero-age authored tracking inputs required')
        actor, native_spec, endpoint, cast, packet, update = [n.allocate(0x500) for _ in range(6)]
        n.put(actor, 'Q', n.base+0x235ae00)
        n.call(0x8639c2, {r.UC_X86_REG_RBX: actor}, 0x863a3b)
        n.put(actor+0x15c, 'fff', *source['result']['position'])
        n.call(0x885e8a, {r.UC_X86_REG_RDI: native_spec, r.UC_X86_REG_RBX: native_spec}, 0x885ecb)
        n.call(0x885edb, {r.UC_X86_REG_RBX: native_spec}, 0x885efc)
        for key, field in motion_definition['fields'].items():
            if key != 'mSpeed':
                n.put(native_spec+field['offset'], '?' if field['type'] == 'bool' else 'f', settings[key])
        n.put(native_spec+0x5c, 'f', settings['mTravelTime'])
        n.put(endpoint, 'fff', *record['cast']['targetPosition'])
        n.put(cast+0xc8, 'fff', *record['cast']['sourcePosition'])
        n.put(cast+0xd4, 'fff', *record['cast']['targetPosition'])
        n.put(cast+0x110, 'I', record['cast']['targetCount'])
        n.call(0x829cd0, {r.UC_X86_REG_RDI: cast})
        selected = n.u.reg_read(r.UC_X86_REG_EAX)
        if selected != 0:
            raise ValueError('Original empty CastInfo selector did not return zero')
        clock['time'] = f(record['time'])
        n.call(0x874290, {r.UC_X86_REG_RDI: native_spec, r.UC_X86_REG_RSI: actor,
                         r.UC_X86_REG_RDX: cast, r.UC_X86_REG_R8: selected, r.UC_X86_REG_R9: endpoint})
        controller = n.u.reg_read(r.UC_X86_REG_RAX)
        n.call(0x87f730, {r.UC_X86_REG_RDI: controller})
        gravity_spec = n.allocate(0x20)
        n.call(0x884e20, {r.UC_X86_REG_RDI: gravity_spec})
        n.put(gravity_spec+8, 'f', spec['heightSolver']['mGravity'])
        n.call(0x8728a0, {r.UC_X86_REG_RDI: gravity_spec, r.UC_X86_REG_RSI: controller})
        facing = n.allocate(8)
        n.call(0x887af0, {r.UC_X86_REG_RDI: facing})
        n.call(0x874930, {r.UC_X86_REG_RDI: facing, r.UC_X86_REG_RSI: controller})

        def snapshot():
            holder = n.q(controller+0x28)
            return {'positionHex': vector_hex(actor+0x15c), 'velocityHex': vector_hex(actor+0x58),
                    'initialPositionHex': vector_hex(controller+0x70), 'targetPositionHex': vector_hex(controller+0x7c),
                    'speedHex': bytes(n.u.mem_read(controller+0xa0, 4)).hex(),
                    'deadlineHex': bytes(n.u.mem_read(controller+0xe0, 4)).hex(),
                    'holderPresent': bool(holder), 'holderInternalId': n.u32(holder) if holder else None}

        before = snapshot()
        n.u.mem_write(packet, bytes.fromhex(packets[record['payloadSha256']]['object']))
        n.call(0x87fa80, {r.UC_X86_REG_RDI: controller, r.UC_X86_REG_RSI: packet})
        after = snapshot()
        samples = []
        if args.frame_schedule == 'creation-ticks':
            schedule = [(tick/60, f(1/60)) for tick in range(27)]
        else:
            events = sorted((event for event in report['missileEvents'] if event['entityId'] == record['entityId'] and
                             (event['time'],event['transportSequence'],event.get('entryOrder',0)) >
                             (record['time'],record['transportSequence'],record.get('entryOrder',0))),
                            key=lambda event:(event['time'],event['transportSequence'],event.get('entryOrder',0)))
            if args.frame_schedule == 'replay-uniform': events = []
            if args.frame_schedule == 'supplied-interior-split':
                events = [{'time':record['time']+0.175}]
            schedule = []
            local,tick,event_at,end = 0.,1,0,26/60
            while local < end:
                next_event = events[event_at]['time']-record['time'] if event_at < len(events) else float('inf')
                next_time = min(tick/60,next_event,end)
                if next_time > local: schedule.append((next_time,f(next_time-local)))
                local = next_time
                while event_at < len(events) and events[event_at]['time'] <= record['time']+local:event_at += 1
                while tick/60 <= local+1e-12:tick += 1
        for offset, delta in schedule:
            clock['time'],clock['delta'] = f(record['time']+offset),delta
            previous = snapshot()
            n.call(0x88d350, {r.UC_X86_REG_RDI: update, r.UC_X86_REG_RSI: controller})
            n.call(0x88b760, {r.UC_X86_REG_RDI: controller, r.UC_X86_REG_RSI: update})
            current = snapshot()
            if current['targetPositionHex'] != before['targetPositionHex']:
                raise ValueError('Zero-reference tracking changed the retained endpoint')
            samples.append({'time': clock['time'], 'delta': clock['delta'], 'globalDelta':clock['globalDelta'], 'before': previous,
                            'updateHex': bytes(n.u.mem_read(update, 0x20)).hex(),
                            'arrived': bool(n.u.mem_read(controller+0xac, 1)[0]), 'after': current})
            position = struct.unpack('<fff', n.u.mem_read(actor+0x15c, 12))
            displacement = struct.unpack('<fff', n.u.mem_read(update+0x10, 12))
            n.put(actor+0x15c, 'fff', *[f(a+b) for a, b in zip(position, displacement)])
            velocity = bytes(n.u.mem_read(update+4, 12))
            if velocity != bytes(12):
                n.u.mem_write(actor+0x58, velocity)
        cases.append({'sequence': record['sequence'], 'sourceEventId': source['sourceEventId'],
                      'ownerCharacter': hero['champion'], 'ownerSkinId': hero['skinId'], 'sourceCatalog': asset['spellCatalog'],
                      'record': record, 'settings': settings, 'gravity': spec['heightSolver']['mGravity'],
                      'start': source['result'], 'selectedInternalId': selected,
                      'beforePacket': before, 'afterPacket': after, 'samples': samples})
    ranges = [(0x829cd0, 0x829cec), (0x874290, 0x87439c), (0x885e8a, 0x885efc),
              (0x88a020, 0x88a18c), (0x88a770, 0x88a88c), (0x87f730, 0x87fd15), (0x88b500, 0x88bb51), (0x890880, 0x8908b8)]
    blocks = []
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original zero-reference controller code differs')
        blocks.append({'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])})
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):
            raw(path)
    raw(args.client)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Zero-reference proof input changed: '+path)
    suffix = '' if args.frame_schedule == 'creation-ticks' else '-'+args.frame_schedule
    output = cache/('research/zero-reference-fixed-time'+suffix+'-native.json')
    output.write_text(json.dumps({'schema': 1, 'kind': 'original-zero-reference-fixed-time-controls',
        'build': report['build'], 'protocol': report['protocol'], 'inputs': inputs, 'originalBlocks': blocks,
        'cases': cases, 'frameSchedule':args.frame_schedule,'clockCalls':clock_calls,
        'scope': {'originalEmptyCastTargetSelector': True, 'fullOriginalFactoryAndController': True,
        'authoredTracksTargetFlagPreserved': True, 'originalFirstPacketApplied': True,
        'worldRootSuppliedFromCurrentReplayAdapter': True, 'originalActorPositionApply': False,
        'explicitLocalDeltaAndGlobalDeltaCallsiteInputs':True,
        'nativeMatchMotionAccepted': False, 'runtimeAdmissionChanged': False}}, indent=2))
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(c['samples']) for c in cases),
                      'holders': [c['beforePacket']['holderPresent'] for c in cases]}))


if __name__ == '__main__':
    main()
