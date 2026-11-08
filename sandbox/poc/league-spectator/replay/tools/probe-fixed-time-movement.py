"""Original FixedTime factory/controller frames and default Gravity solver.

Owned endpoint, clock and optional indexed travel-time override are supplied.
This is not evidence that actual match override/bone/target producers are known.
"""
import argparse
import inspect
import itertools
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    n = NativeSpawn(args.cache / 'public/decoder-16.21-macos', args.client)
    def invalid(engine, access, address, size, value, user):
        raise ValueError(f'FixedTime owned-control missing memory: RIP={engine.reg_read(r.UC_X86_REG_RIP)-n.base:x} address={address:x} size={size}')
    n.u.hook_add(unicorn.UC_HOOK_MEM_INVALID, invalid)
    f = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
    bits = lambda value: int.from_bytes(struct.pack('<f', value), 'little')
    read_f = lambda at: struct.unpack('<f', n.u.mem_read(at, 4))[0]
    clock = {'time': 0.0, 'delta': 0.0}
    manager, view = n.allocate(0x20), n.allocate(0x20)
    n.put(manager + 0x10, 'Q', view); n.put(n.base + 0x246d000, 'Q', manager)
    manifest_path = args.cache / 'public/latest-scene/manifest.json'
    heights_path = args.cache / 'public/latest-scene/heights.bin'
    manifest, heights = json.loads(manifest_path.read_bytes()), heights_path.read_bytes()
    if manifest['build'] != n.profile['clientVersion'] or manifest['protocol'] != n.profile['protocolDigest']:
        raise ValueError('FixedTime original terrain build differs')
    grid_manager, grid, height_at = n.allocate(0x20), n.allocate(0x200), n.allocate(len(heights))
    n.put(grid_manager + 8, 'Q', grid); n.put(n.base + 0x246c948, 'Q', grid_manager)
    n.put(grid + 0xbc, 'fff', *manifest['map']['min']); n.put(grid + 0xc8, 'fff', *manifest['map']['max'])
    height_grid = manifest['map']['heightGrid']
    n.put(grid + 0xf8, 'Q', height_at)
    n.put(grid + 0x100, 'IIff', height_grid['x'], height_grid['z'], *height_grid['step'])
    n.u.mem_write(height_at, heights)
    def supply_clock(engine, address, size, user):
        if engine.reg_read(r.UC_X86_REG_RDI) != view:
            raise ValueError('FixedTime clock escaped owned view')
        engine.reg_write(r.UC_X86_REG_XMM0, bits(clock['time' if address == n.base + 0x15ed8e0 else 'delta']))
        n.ret()
    for entry in [0x15ed8e0, 0x15ed930]:
        n.u.hook_add(unicorn.UC_HOOK_CODE, supply_clock, begin=n.base+entry, end=n.base+entry)
    actor, spec, endpoint, modifiers, modifier_rows, gravity_spec, update = [n.allocate(0x500) for _ in range(7)]
    cases = []
    for (position, target), duration, gravity, override, (initial_clock, moving) in itertools.product(
            [([0, 5, 0], [1000, 105, 300]), ([17, -33, 9], [17, 67, 9]), ([17, -33, 9], [18, -31, 11])],
            [0, f(0.4), f(1.25)], [None, 3000], [None, f(0.7)],
            [(0, False), (f(12.3), False), (1024, False), (f(12.3), True)]):
            clock.update(time=initial_clock, delta=f(1 / 60))
            n.u.mem_write(actor, bytes(0x500)); n.u.mem_write(spec, bytes(0x500)); n.u.mem_write(modifiers, bytes(0x500))
            n.put(actor, 'Q', n.base + 0x235ae00)
            n.call(0x8639c2, {r.UC_X86_REG_RBX: actor}, 0x863a3b)
            n.put(actor + 0x15c, 'fff', *position)
            n.call(0x885e8a, {r.UC_X86_REG_RDI: spec, r.UC_X86_REG_RBX: spec}, 0x885ecb)
            n.call(0x885edb, {r.UC_X86_REG_RBX: spec}, 0x885efc)
            if n.q(spec) - n.base != 0x235db98 or bytes(n.u.mem_read(spec + 0x5c, 4)) != bytes(4):
                raise ValueError('Original FixedTime specification/default differs')
            n.put(spec + 0xa, '?', False); n.put(spec + 0x5b, '?', False)
            n.put(spec + 0x5c, 'f', duration)
            n.put(endpoint, 'fff', *target)
            if override is not None:
                n.put(modifiers + 0xb0, 'Q', modifier_rows); n.put(modifiers + 0xb8, 'I', 1)
                n.put(modifier_rows, 'B3xf', 0, override)
            try:
                n.call(0x874290, {r.UC_X86_REG_RDI: spec, r.UC_X86_REG_RSI: actor,
                                 r.UC_X86_REG_RDX: modifiers, r.UC_X86_REG_R8: 0,
                                 r.UC_X86_REG_R9: endpoint})
            except Exception as error:
                raise ValueError(f'Original FixedTime factory stopped at {n.u.reg_read(r.UC_X86_REG_RIP)-n.base:x}') from error
            motion = n.u.reg_read(r.UC_X86_REG_RAX)
            if n.q(motion) - n.base != 0x235d280:
                raise ValueError('Original FixedTime runtime binding differs')
            n.call(0x87f730, {r.UC_X86_REG_RDI: motion})
            gravity_defaults = None
            if gravity is not None:
                n.call(0x884e20, {r.UC_X86_REG_RDI: gravity_spec})
                gravity_defaults = bytes(n.u.mem_read(gravity_spec + 8, 9)).hex()
                n.put(gravity_spec + 8, 'f', gravity)
                n.call(0x8728a0, {r.UC_X86_REG_RDI: gravity_spec, r.UC_X86_REG_RSI: motion})
                if n.q(n.q(motion + 0x30)) - n.base != 0x235d628:
                    raise ValueError('Original Gravity runtime binding differs')
            facing_spec = n.allocate(8)
            n.call(0x887af0, {r.UC_X86_REG_RDI: facing_spec})
            n.call(0x874930, {r.UC_X86_REG_RDI: facing_spec, r.UC_X86_REG_RSI: motion})
            created = clock['time']
            snapshot = lambda: {'duration': read_f(motion + 0xd8), 'delay': read_f(motion + 0xdc),
                               'deadline': read_f(motion + 0xe0), 'speed': read_f(motion + 0xa0),
                               'actorVelocityHex': bytes(n.u.mem_read(actor + 0x58, 12)).hex(),
                               'targetPositionHex': bytes(n.u.mem_read(motion + 0x7c, 12)).hex()}
            case = {'position': position, 'target': target, 'duration': duration, 'override': override,
                    'createdAt': created, 'gravity': gravity, 'gravitySpecDefaultBytesHex': gravity_defaults,
                    'movingSuppliedEndpoint': moving, 'initial': snapshot(), 'samples': []}
            actual_duration = duration if override is None else override
            for tick, offset in enumerate([0, f(1 / 60), f(actual_duration / 2), actual_duration,
                           f(actual_duration + 1 / 60), f(actual_duration + 2 / 60)]):
                clock['time'] = f(created + offset)
                if moving and tick:
                    previous = struct.unpack('<fff', n.u.mem_read(motion + 0x7c, 12))
                    n.put(motion + 0x7c, 'fff', f(previous[0] + tick * 7), f(previous[1] - tick * 3), f(previous[2] + tick * 11))
                n.call(0x88d350, {r.UC_X86_REG_RDI: update, r.UC_X86_REG_RSI: motion})
                n.call(0x88b760, {r.UC_X86_REG_RDI: motion, r.UC_X86_REG_RSI: update})
                case['samples'].append({'time': clock['time'], 'delta': clock['delta'],
                                        'positionBeforeHex': bytes(n.u.mem_read(actor + 0x15c, 12)).hex(),
                                        'actorVelocityBeforeHex': bytes(n.u.mem_read(actor + 0x58, 12)).hex(),
                                        'suppliedTargetPositionHex': bytes(n.u.mem_read(motion + 0x7c, 12)).hex(),
                                        'updateHex': bytes(n.u.mem_read(update, 0x20)).hex(),
                                        'arrived': bool(bytes(n.u.mem_read(motion + 0xac, 1))[0]),
                                        'historySize': n.q(motion + 0x68)})
                old = struct.unpack('<fff', n.u.mem_read(actor + 0x15c, 12))
                delta = struct.unpack('<fff', n.u.mem_read(update + 0x10, 12))
                n.put(actor + 0x15c, 'fff', *[f(a+b) for a,b in zip(old, delta)])
                velocity = bytes(n.u.mem_read(update + 4, 12))
                if velocity != bytes(12): n.u.mem_write(actor + 0x58, velocity)
            cases.append(case)
    # First-replication packet fields use the exact original FixedTime override,
    # not a type-name waiver around the fixed-speed initializer. The endpoint
    # here is an explicit owned input; tracked-world acceptance is independent.
    analysis_path = args.cache / 'research/latest-missile-evidence.json'
    objects_path = args.cache / 'research/projectile-combat-native.json'
    analysis, objects = json.loads(analysis_path.read_bytes()), json.loads(objects_path.read_bytes())
    native_packets = {row['payloadSha256']: row for row in objects['observations'].values() if row['opcode'] == 28 and row['status'] == 'complete'}
    packet_at, descriptor = n.allocate(0x300), n.allocate(0x40)
    packet_controls, packet_omissions, catalog_paths = [], [], set()
    for record in analysis['records']:
        if record.get('movementType') != 'FixedTimeMovement': continue
        if record['elapsedSeconds'] != 0 or record['startInitialization']['status'] != 'initialized':
            packet_omissions.append({'sequence': record['sequence'], 'reason': record['startInitialization']['status'] if record['elapsedSeconds'] == 0 else 'nonzero-replication-age'})
            continue
        asset = next(value for value in manifest['champions'].values() if value['champion'] == record['ownerCharacter'])
        catalog_path = args.cache / 'public/latest-scene' / asset['spellCatalog']; catalog_paths.add(catalog_path)
        catalog = json.loads(catalog_path.read_bytes())
        settings = catalog['spells'][str(record['cast']['spellHash'])]['data']['mMissileSpec']['movementComponent']
        current = record['startInitialization']['position']; target = record['cast']['targetPosition']
        clock['time'] = f(record['time'])
        n.put(actor + 0x15c, 'fff', *current); n.put(actor + 0x358, 'Q', descriptor)
        n.put(motion + 0x18, 'Q', actor); n.put(motion + 0x7c, 'fff', *target)
        n.put(motion + 0x98, 'f', settings.get('mTargetHeightAugment', 0))
        n.put(motion + 0xc0, '??', settings.get('mUseHeightOffsetAtEnd', False), False)
        n.put(motion + 0xd8, 'ff', settings.get('mTravelTime', 0), settings.get('mStartDelay', 0))
        deadline = f(f(clock['time'] + f(settings.get('mTravelTime', 0))) + f(settings.get('mStartDelay', 0)))
        n.put(motion + 0xe0, 'f', deadline)
        packet = bytes.fromhex(native_packets[record['payloadSha256']]['object'])
        n.u.mem_write(packet_at, packet)
        velocity_before = bytes(n.u.mem_read(actor + 0x58, 12))
        position_before = bytes(n.u.mem_read(actor + 0x15c, 12))
        n.call(0x87fa80, {r.UC_X86_REG_RDI: motion, r.UC_X86_REG_RSI: packet_at})
        if read_f(motion + 0xe0) != deadline: raise ValueError('First zero-age FixedTime replication changed its deadline')
        if bytes(n.u.mem_read(actor + 0x58, 12)) != velocity_before: raise ValueError('First FixedTime packet changed its initial actor velocity')
        if bytes(n.u.mem_read(actor + 0x15c, 12)) != position_before: raise ValueError('First FixedTime packet changed its constructor origin')
        packet_controls.append({'sequence': record['sequence'], 'entityId': record['entityId'], 'payloadSha256': record['payloadSha256'],
                                'settings': settings, 'suppliedCurrentPosition': current, 'suppliedTargetPosition': target,
                                'decodedCast': record['cast'], 'deadline': deadline, 'deadlineAfter': read_f(motion + 0xe0),
                                'initialPositionHex': bytes(n.u.mem_read(motion + 0x70, 12)).hex(),
                                'targetPositionHex': bytes(n.u.mem_read(motion + 0x7c, 12)).hex(),
                                'heightAugmentHex': bytes(n.u.mem_read(motion + 0x98, 4)).hex(),
                                'speedHex': bytes(n.u.mem_read(motion + 0xa0, 4)).hex(),
                                'expectedPacketSpeed': record['movementSpeed'],
                                'expectedControllerScalarB0': record['controllerScalarB0'],
                                'expectedControllerScalarB4': record['controllerScalarB4'],
                                'actorVelocityBeforeHex': velocity_before.hex(),
                                'actorVelocityAfterHex': bytes(n.u.mem_read(actor + 0x58, 12)).hex(),
                                'actorPositionBeforeHex': position_before.hex(),
                                'actorPositionAfterHex': bytes(n.u.mem_read(actor + 0x15c, 12)).hex(),
                                'correctionB0Hex': bytes(n.u.mem_read(motion + 0xb0, 4)).hex(),
                                'correctionB4Hex': bytes(n.u.mem_read(motion + 0xb4, 4)).hex()})
    ranges = [(0x873030, 0x87310f), (0x885e8a, 0x885efc), (0x874290, 0x87439c),
              (0x8298d0, 0x829936), (0x87f730, 0x87fa3f), (0x87fa40, 0x87fa72),
              (0x884690, 0x88469e), (0x884e20, 0x884e41), (0x8728a0, 0x8728e7),
              (0x882590, 0x88276c), (0x890880, 0x8908b8), (0x87fa80, 0x87fd15)]
    blocks = []
    for start, end in ranges:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]: raise ValueError('FixedTime/Gravity instruction mismatch')
        blocks.append({'rva': start, 'bytes': end-start, 'sha256': sha(raw)})
    sources = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-fixed-time-gravity-controller-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'inputs': {str(p.resolve()): sha(p.read_bytes()) for p in [manifest_path, heights_path, analysis_path, objects_path, *catalog_paths]},
              'blocks': blocks, 'cases': cases, 'packetControls': packet_controls, 'packetOmissions': packet_omissions,
              'scope': {'originalFactoryAndOverrideQuery': True, 'originalControllerFrame': True,
                        'originalGravityAndFacing': True, 'suppliedClockAndEndpoint': True,
                        'actualModifierProducerRecovered': False, 'originalActorApplyAndBounds': False,
                        'targetAcceptance': False, 'actualMatchAdmitted': False}}
    output = args.cache / 'research/fixed-time-movement-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(c['samples']) for c in cases)}))


if __name__ == '__main__': main()
