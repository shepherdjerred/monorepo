"""Original cast-on-completion local lifecycle, with emitted cast requests.

Only the downstream original cast dispatcher and stop-presentation notification
are captured as named omitted side effects. Factories, phase/frame callbacks,
action state and direction normalization execute original instructions.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    n = NativeSpawn(cache / 'public/decoder-16.21-macos', args.client)
    actor = n.allocate(0x8100)
    motion = n.allocate(0x200)
    spec = n.allocate(0x80)
    presentation = n.allocate(0x100)
    n.u.mem_write(actor + 0x8000, b'\xa5' * 0x100)
    calls, stop_calls = [], []
    def capture(engine, address, size, user):
        if address == n.base + 0x8b5740:
            pointer = engine.reg_read(r.UC_X86_REG_RDI)
            direction = engine.reg_read(r.UC_X86_REG_RSI)
            if pointer != actor + 0x1a8 or not ADDRESSES['stack'] - 0x1000 <= direction <= ADDRESSES['stack'] - 12:
                raise ValueError('Original completion cast request escaped owned input context')
            raw = bytes(engine.mem_read(direction, 12))
            calls.append({'castInfoActorOffset': pointer - actor,
                          'directionHex': raw.hex(), 'direction': list(struct.unpack('<fff', raw)),
                          'phase': bytes(engine.mem_read(actor + 0x368, 1))[0]})
        else:
            if engine.reg_read(r.UC_X86_REG_RDI) != presentation:
                raise ValueError('Original completion stop notification escaped owned presentation')
            stop_calls.append({'entryRva': address - n.base})
        n.ret()
    for entry in [0x8b5740, 0x8950e0]:
        n.u.hook_add(unicorn.UC_HOOK_CODE, capture, begin=n.base + entry, end=n.base + entry)
    mask64 = (1 << 64) - 1
    encoded = motion ^ 0x453b8f8b
    encoded = ((((encoded << 53) | (encoded >> 11)) + 0x453b8f8b) & mask64) ^ 0x496e69c7
    def snapshot():
        components = []
        for at in range(n.q(actor + 0x3b0), n.q(actor + 0x3b8), 8):
            component = n.q(at)
            actions = n.q(component + 0x10)
            if n.q(component + 0x18) - actions != 8:
                raise ValueError('Original completion component action count differs')
            action = n.q(actions)
            action_vtable = n.q(action) - n.base
            components.append({'actionVtableRva': action_vtable,
                               'remainingDelay': struct.unpack('<i', n.u.mem_read(component + 0x28, 4))[0],
                               'fired': bool(bytes(n.u.mem_read(component + 0x2c, 1))[0]),
                               'actionExecuted': bool(bytes(n.u.mem_read(action + 8, 1))[0])})
        return {'phase': bytes(n.u.mem_read(actor + 0x368, 1))[0],
                'phaseLatch': bool(bytes(n.u.mem_read(actor + 0x36d, 1))[0]),
                'stopped': bool(bytes(n.u.mem_read(actor + 0x3c8, 1))[0]),
                'positionHex': bytes(n.u.mem_read(actor + 0x4c, 12)).hex(),
                'velocityHex': bytes(n.u.mem_read(actor + 0x58, 12)).hex(),
                'components': components, 'castRequests': [dict(row) for row in calls],
                'stopPresentationCalls': len(stop_calls)}
    cases = []
    for velocity in [[0, 0, 0], [1.25, -3.5, 7.75], [0.000001, 0, 0], [0.1, 0.2, 0.3], [1000, 30, -50]]:
      for order in [['cast'], ['cast', 'destroy'], ['destroy', 'cast']]:
       for flag in [0, 1]:
        n.u.mem_write(actor, bytes(0x8000))
        n.put(actor, 'Q', n.base + 0x235ae00)
        n.call(0x8639bb, {r.UC_X86_REG_RBX: actor}, 0x863a3b)
        n.put(actor + 0x340, 'Q', encoded)
        n.put(actor + 0x348, 'Q', presentation)
        n.put(actor + 0x4c, 'fff', 17, 19, 23)
        n.put(actor + 0x58, 'fff', *velocity)
        n.put(motion, 'Q', n.base + 0x235d018)
        for kind in order:
            n.u.mem_write(spec, bytes(0x80))
            if kind == 'cast':
                n.call(0x870660, {r.UC_X86_REG_RDI: spec})
                n.put(spec + 8, 'B', flag)
                n.call(0x869d30, {r.UC_X86_REG_RDI: spec, r.UC_X86_REG_RSI: actor})
            else:
                n.put(spec, 'Q', n.base + 0x235bb70)
                n.put(spec + 8, 'iB', 0, 1)
                n.call(0x869860, {r.UC_X86_REG_RDI: spec, r.UC_X86_REG_RSI: actor})
        first, end = n.q(actor + 0x3d0), n.q(actor + 0x3d8)
        n.call(0x86cc70, {r.UC_X86_REG_RDI: actor + 0x3b0, r.UC_X86_REG_RSI: n.q(actor + 0x3b8),
                         r.UC_X86_REG_RDX: first, r.UC_X86_REG_RCX: end, r.UC_X86_REG_R8: (end - first) // 8})
        n.put(actor + 0x3d8, 'Q', first)
        calls.clear(); stop_calls.clear()
        case = {'suppliedVelocity': velocity, 'componentOrder': order, 'suppliedSpecByte8': flag,
                'initial': snapshot(), 'operations': []}
        for operation in ['phase', 'phase', 'frame-arrived', 'frame-not-arrived', 'phase']:
            if operation == 'phase':
                n.call(0x864a60, {r.UC_X86_REG_RDI: actor})
            else:
                n.put(motion + 0xac, 'B', int(operation == 'frame-arrived'))
                for at in range(n.q(actor + 0x3b0), n.q(actor + 0x3b8), 8):
                    n.call(0x875940, {r.UC_X86_REG_RDI: n.q(at)})
            case['operations'].append({'operation': operation, 'state': snapshot()})
        if bytes(n.u.mem_read(actor + 0x8000, 0x100)) != b'\xa5' * 0x100:
            raise ValueError('Original completion behavior escaped its owned actor')
        cases.append(case)
    ranges = [(0x870660, 0x870673), (0x869d30, 0x869d86), (0x875870, 0x87589a),
              (0x8758a0, 0x875930), (0x875940, 0x8759b0), (0x876290, 0x8762a4),
              (0x8762b0, 0x87642d), (0x864a60, 0x864ac0), (0x148a750, 0x148a7c0),
              (0x86a530, 0x86a536)]
    blocks = []
    for start, end in ranges:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]:
            raise ValueError('Original completion behavior code differs from pristine client')
        blocks.append({'rva': start, 'bytes': len(raw), 'sha256': sha(raw)})
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-cast-on-movement-complete-local-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'blocks': blocks, 'cases': cases,
              'scope': {'originalFactoriesAndPhaseFrameExecuted': True, 'originalNormalizationExecuted': True,
                        'originalCastDispatcherExecuted': False, 'castRequestsCapturedAsOmittedSideEffects': True,
                        'actualClockScheduleRecovered': False, 'actualChildSpellPresentationRendered': False}}
    output = cache / 'research/cast-on-movement-complete-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases),
                      'operations': sum(len(case['operations']) for case in cases), 'scope': report['scope']}))


if __name__ == '__main__':
    main()
