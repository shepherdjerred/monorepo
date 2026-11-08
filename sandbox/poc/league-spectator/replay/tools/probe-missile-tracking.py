"""Execute original target queries on constructed AI units and owned views.

Registry entries, visibility-mode bytes, unit poses and frame skip flags are
explicit controls. This does not accept replay targets or establish match motion.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import unicorn

from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha, ADDRESSES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    type_blocks = [(0x13774f, 0x1377b4, 0x248e550, 0x2092043f),
                   (0xdb497, 0xdb4fc, 0x248d700, 0x5c93a47b)]
    for start, end, descriptor, identity in type_blocks:
        if n.u32(n.base + descriptor + 8):
            raise ValueError('Original controlled runtime type must be cold')
        n.call(start, {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, end)
        if n.u32(n.base + descriptor + 8) != identity:
            raise ValueError('Original target-query type registration differs')
    unit = fixture.construct_ai()
    target_id = 0x10001
    n.put(unit + 0x20, 'I', target_id)
    manager, slots, mode = n.allocate(0x28), n.allocate(0x40), n.allocate(0x10)
    holder, position, velocity, radius = [n.allocate(0x50) for _ in range(4)]
    n.put(manager + 0x20, 'Q', slots)
    n.put(slots + 8, 'Q', unit)
    n.put(n.base + 0x24722c0, 'Q', manager)
    n.put(n.base + 0x24705d0, 'Q', mode)
    n.call(0x54b0a0, {r.UC_X86_REG_RDI: manager, r.UC_X86_REG_RSI: target_id})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError('Owned internal-ID registry control does not resolve original unit')
    n.call(0xd1c20, {r.UC_X86_REG_RDI: unit})
    source_type = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0xe0bd0, {})
    target_type = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0x14b6400, {r.UC_X86_REG_RDI: source_type, r.UC_X86_REG_RSI: unit, r.UC_X86_REG_RDX: target_type})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
        raise ValueError(f'Original target RTTI requires initialized metadata: source={source_type-n.base:x} target={target_type-n.base:x}')
    ranges = [(a, b) for a,b,_,_ in type_blocks] + [(0x88b500, 0x88b751), (0x88a770, 0x88a88c),
              (0x88b760, 0x88bb51), (0x88a020, 0x88a18c),
              (0x54b0a0, 0x54b0ca), (0x213c00, 0x213c39),
              (0xdbb20, 0xdbb53), (0x209e20, 0x209e2a),
              (0x14b62d0, 0x14b640a), (0xe0bd0, 0xe0bdd)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Target-query instructions differ from original client')
    rows = []
    for requested in [0, target_id, 0x20001]:
        n.put(holder, 'I', requested)
        for mode_value in [0, 1]:
            n.put(mode + 8, 'I', mode_value)
            for visibility in [0, 1]:
                n.put(unit + 0x201, 'B', visibility)
                n.put(unit + 0x208, 'B', 0)
                for skip in [0, 1]:
                    for pose in [[100, 20, -70], [130, 40, -45]]:
                        n.put(unit + 0x15c, 'fff', *pose)
                        n.put(unit + 0x20a0, 'fff', 2, 3, 4)
                        for at in [position, velocity, radius]:
                            n.u.mem_write(at, bytes([0xa5]) * 0x50)
                        n.call(0x88b5e0, {r.UC_X86_REG_RDI: holder,
                            r.UC_X86_REG_RSI: skip, r.UC_X86_REG_RDX: 0,
                            r.UC_X86_REG_RCX: position, r.UC_X86_REG_R8: velocity,
                            r.UC_X86_REG_R9: radius,
                            r.UC_X86_REG_XMM0: int.from_bytes(struct.pack('<f', 7.5), 'little')})
                        accepted = bool(n.u.reg_read(r.UC_X86_REG_RAX) & 255)
                        expected = requested == target_id and (visibility or not skip or mode_value)
                        if accepted != bool(expected):
                            raise ValueError(f'Original controlled target acceptance differs: requested={requested:x} mode={mode_value} visible={visibility} skip={skip} actual={accepted}')
                        output = {'accepted': accepted,
                                  'positionHex': bytes(n.u.mem_read(position, 12)).hex(),
                                  'aimOffsetHex': bytes(n.u.mem_read(velocity, 12)).hex(),
                                  'radiusHex': bytes(n.u.mem_read(radius, 4)).hex()}
                        if accepted:
                            if output['positionHex'] != struct.pack('<fff', pose[0], pose[1] + 7.5, pose[2]).hex():
                                raise ValueError('Original accepted target pose/height differs')
                            if output['aimOffsetHex'] != struct.pack('<fff', 2, 3, 4).hex() or output['radiusHex'] != '00000000':
                                raise ValueError('Original AI aim offset/radius differs')
                        elif output['positionHex'] != 'a5' * 12 or output['aimOffsetHex'] != 'a5' * 12 or output['radiusHex'] != 'a5' * 4:
                            raise ValueError('Rejected target changed caller outputs')
                        rows.append({'requestedInternalId': requested, 'modeInput': mode_value,
                            'visibilityByte201': visibility, 'skipInput': skip, 'pose': pose,
                            'heightAugment': 7.5, 'output': output})
    fixture.check_guard(unit)
    # Original FixedSpeed factory tail follows an explicitly supplied endpoint;
    # target projection/start attachment and packet initialization are isolated.
    clock = {'time': 0.0, 'delta': 1 / 60}
    clock_manager, clock_view = n.allocate(0x20), n.allocate(0x20)
    n.put(clock_manager + 0x10, 'Q', clock_view)
    n.put(n.base + 0x246d000, 'Q', clock_manager)
    clock_calls = []
    entity = n.allocate(0x500)
    def clock_service(uc, address, size, user):
        at = address - n.base
        value = clock['time' if at == 0x15ed8e0 else 'delta']
        clock_calls.append({'rva': at, 'value': value})
        uc.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack('<f', value), 'little'))
        n.ret()
    for at in [0x15ed8e0, 0x15ed930]:
        n.u.hook_add(unicorn.UC_HOOK_CODE, clock_service, begin=n.base+at, end=n.base+at)
    frames = []
    motion_definition = fixture.read(fixture.cache / 'public/decoder-16.21-macos/missile-motion.json')
    for tracks in [False, True]:
        for tracks_hidden in [False, True]:
            for mode_value in [0, 1]:
                spec, motion, endpoint, update = [n.allocate(0x200) for _ in range(4)]
                clock['time'] = 0.0
                n.put(slots + 8, 'Q', unit)
                n.put(unit + 0x20, 'I', target_id)
                n.put(mode + 8, 'I', mode_value)
                n.put(unit + 0x201, 'B', 1)
                n.put(unit + 0x15c, 'fff', 1000, 20, 0)
                n.u.mem_write(entity, bytes(0x500))
                n.put(entity, 'Q', n.base + 0x235ae00)
                n.call(0x8639c2, {r.UC_X86_REG_RBX: entity}, 0x863a3b)
                n.put(entity + 0x15c, 'fff', 0, 0, 0)
                n.call(0x88602a, {r.UC_X86_REG_RDI: spec}, 0x88606b)
                n.call(0x88607b, {r.UC_X86_REG_RBX: spec}, 0x88609c)
                settings = {key: value['default'] for key, value in motion_definition['fields'].items()}
                settings.update(mTracksTarget=tracks, mVisualsTrackHiddenTargets=tracks_hidden,
                                mTargetHeightAugment=7.5, mSpeed=600)
                for key, meta in motion_definition['fields'].items():
                    n.put(spec + meta['offset'], '?' if meta['type'] == 'bool' else 'f', settings[key])
                n.put(endpoint, 'fff', 900, 10, 0)
                n.call(0x874415, {r.UC_X86_REG_RAX: motion, r.UC_X86_REG_R14: motion, r.UC_X86_REG_R12: entity,
                    r.UC_X86_REG_R15: target_id, r.UC_X86_REG_R13: endpoint,
                    r.UC_X86_REG_RBX: spec}, 0x874444)
                n.call(0x87f480, {r.UC_X86_REG_RDI: motion})
                if bool(n.q(motion + 0x28)) != tracks:
                    raise ValueError('mTracksTarget does not select original initial target holder')
                initial = {'targetPosition': struct.unpack('<fff', bytes(n.u.mem_read(motion + 0x7c, 12))),
                    'position': struct.unpack('<fff', bytes(n.u.mem_read(entity + 0x15c, 12))),
                    'aimOffset': struct.unpack('<fff', bytes(n.u.mem_read(motion + 0x88, 12))),
                    'radius': struct.unpack('<f', bytes(n.u.mem_read(motion + 0x9c, 4)))[0],
                    'holderCreated': bool(n.q(motion + 0x28))}
                samples = []
                changes = [
                    ('visible', [1000, 20, 0], 1, True, target_id),
                    ('hidden', [1000, 30, 100], 0, True, target_id),
                    ('visible-again', [1000, 40, 200], 1, True, target_id),
                    ('registry-absent', [1000, 50, 300], 1, False, target_id),
                    ('registry-returned', [1000, 60, 400], 1, True, target_id),
                    ('generation-mismatch', [1000, 70, 500], 1, True, 0x20001),
                ]
                previous_target = struct.unpack('<fff', bytes(n.u.mem_read(motion + 0x7c, 12)))
                for label, pose, visible, registered, generation in changes:
                    n.put(unit + 0x15c, 'fff', *pose)
                    n.put(unit + 0x201, 'B', visible)
                    n.put(unit + 0x20, 'I', generation)
                    n.put(slots + 8, 'Q', unit if registered else 0)
                    clock['time'] = struct.unpack('<f', struct.pack('<f', clock['time'] + clock['delta']))[0]
                    before_position = struct.unpack('<fff', bytes(n.u.mem_read(entity + 0x15c, 12)))
                    n.call(0x88d350, {r.UC_X86_REG_RDI: update, r.UC_X86_REG_RSI: motion})
                    n.call(0x88b760, {r.UC_X86_REG_RDI: motion, r.UC_X86_REG_RSI: update})
                    target = struct.unpack('<fff', bytes(n.u.mem_read(motion + 0x7c, 12)))
                    accepted = tracks and registered and generation == target_id and (visible or tracks_hidden or mode_value)
                    expected = (pose[0], pose[1] + 7.5, pose[2]) if accepted else previous_target
                    if target != tuple(expected):
                        raise ValueError(f'Original frame target retention differs: {tracks}/{tracks_hidden}/{mode_value}/{label}')
                    samples.append({'label': label, 'time': clock['time'], 'suppliedTargetPose': pose,
                        'visible': bool(visible), 'registered': registered, 'generation': generation,
                        'targetPosition': target, 'updateHex': bytes(n.u.mem_read(update, 0x20)).hex(),
                        'position': before_position, 'delta': struct.unpack('<f', struct.pack('<f', clock['delta']))[0],
                        'historySize': n.q(motion + 0x68), 'acceptedQueryExpected': bool(accepted)})
                    previous_target = target
                    # Only feed the original native displacement into this owned
                    # position view; applying actor position/bounds is not claimed.
                    pos = struct.unpack('<fff', bytes(n.u.mem_read(entity + 0x15c, 12)))
                    displacement = struct.unpack('<fff', bytes(n.u.mem_read(update + 0x10, 12)))
                    n.put(entity + 0x15c, 'fff', *[a+b for a,b in zip(pos, displacement)])
                frames.append({'settings': settings, 'modeInput': mode_value, 'initial': initial,
                    'suppliedEndpoint': [900, 10, 0], 'initialTargetPose': [1000, 20, 0], 'samples': samples})
    ranges += [(0x874415, 0x874444), (0x87f480, 0x87f4d2),
               (0x88fea0, 0x88ff98), (0x88602a, 0x88606b), (0x88607b, 0x88609c)]
    for a,b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original tracking frame instructions differ')
    fixture.check_guard(unit)
    sources = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
               *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-missile-target-query-controls',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
        'ranges': [{'rva': a, 'bytes': b-a, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'cases': rows, 'frames': frames, 'clockCalls': clock_calls,
        'scope': {'fullOriginalTargetQuery': True,
            'originalAiConstructor': True, 'ownedRegistryAndHolderFieldViews': True,
            'originalWorldNetworkAcceptance': False, 'fullOriginalControllerStep': True,
            'originalFactoryTailWithSuppliedEndpoint': True, 'suppliedFloat32Clock': True,
            'actorPositionApplication': False, 'fullControllerLifecycle': False,
            'targetBones': False, 'matchVisibility': False, 'eligibilityExpanded': False}}
    output = fixture.cache / 'research/missile-tracking-native.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(rows),
                     'accepted': sum(c['output']['accepted'] for c in rows),
                     'frameCases': len(frames), 'frames': sum(len(c['samples']) for c in frames)}))


if __name__ == '__main__':
    main()
