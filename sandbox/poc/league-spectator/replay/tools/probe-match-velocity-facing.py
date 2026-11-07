"""Original vertical-facing factory, evaluator and no-height controller frames.

Clock values and owned initial poses/endpoints are supplied diagnostic inputs.
No live target acceptance, recorded clock schedule or actor bounds is inferred.
"""
import argparse
import inspect
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
    f = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
    bits = lambda value: int.from_bytes(struct.pack('<f', value), 'little')
    read_f = lambda at: struct.unpack('<f', n.u.mem_read(at, 4))[0]
    clock = {'time': 0.0, 'delta': 0.0}
    manager, view = n.allocate(0x20), n.allocate(0x20)
    n.put(manager + 0x10, 'Q', view)
    n.put(n.base + 0x246d000, 'Q', manager)
    def supply_clock(engine, address, size, user):
        if engine.reg_read(r.UC_X86_REG_RDI) != view:
            raise ValueError('Vertical-facing clock escaped owned view')
        engine.reg_write(r.UC_X86_REG_XMM0, bits(clock['time' if address == n.base + 0x15ed8e0 else 'delta']))
        n.ret()
    for entry in [0x15ed8e0, 0x15ed930]:
        n.u.hook_add(unicorn.UC_HOOK_CODE, supply_clock, begin=n.base+entry, end=n.base+entry)
    facing_spec, motion, actor, endpoint, update, displacement = [n.allocate(0x500) for _ in range(6)]
    n.call(0x887af0, {r.UC_X86_REG_RDI: facing_spec})
    if n.q(facing_spec) - n.base != 0x235de60 or n.q(n.base + 0x235de60 + 0x28) - n.base != 0x874930:
        raise ValueError('Original MatchVelocity specification/factory differs')
    n.call(0x874930, {r.UC_X86_REG_RDI: facing_spec, r.UC_X86_REG_RSI: motion})
    if n.q(motion + 0x20) - n.base != 0x890880:
        raise ValueError('Original MatchVelocity evaluator binding differs')
    for address, expected in [(0x872afc, bytes.fromhex('be71d886b8ba30000000')),
                              (0x872b2a, bytes.fromhex('beb867bb95ba18000000'))]:
        if n.image[address:address+len(expected)] != expected:
            raise ValueError('Original source/target bone property registration differs')
    threshold_rva = 0x20ca4d0
    threshold = read_f(n.base + threshold_rva)
    cases = []
    for delta in [0, -1, f(threshold / 2), threshold, f(threshold * 2), f(1 / 60), f(1 / 15), 1]:
        for vector in [[0, 0, 0], [3, 7, -5], [1, -0.125, 1], [99, 0.000001, -33]]:
            clock['delta'] = delta
            n.put(displacement, 'fff', *vector)
            n.call(0x890880, {r.UC_X86_REG_RDX: displacement})
            cases.append({'delta': delta, 'displacement': vector,
                          'resultHex': (n.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff).to_bytes(4, 'little').hex()})
    definition = n.checked_json('missile-motion.json', 'missileMotionSha256')
    frames = []
    spec = n.allocate(0x200)
    for position, target, speed, delta in [
        ([0, 0, 0], [1000, 200, 0], 600, f(1 / 60)),
        ([2, -17, 4], [-400, -300, 130], 1200, f(1 / 15)),
        ([50, 100, -70], [51, 120, -69], 900, f(1 / 60)),
        ([1, 2, 3], [1, 2, 3], 10, f(1 / 60)),
        ([0, 0, 0], [1000, 200, 0], 600, 0),
    ]:
        clock.update(time=0.0, delta=delta)
        n.u.mem_write(actor, bytes(0x500)); n.u.mem_write(motion, bytes(0x500))
        n.put(actor, 'Q', n.base + 0x235ae00)
        n.call(0x8639c2, {r.UC_X86_REG_RBX: actor}, 0x863a3b)
        n.put(actor + 0x15c, 'fff', *position)
        n.call(0x88602a, {r.UC_X86_REG_RDI: spec}, 0x88606b)
        if n.q(spec + 0x20) != 0:
            raise ValueError('Original target-bone string default is not empty')
        n.call(0x88607b, {r.UC_X86_REG_RBX: spec}, 0x88609c)
        settings = {key: value['default'] for key, value in definition['fields'].items()}
        settings.update(mTracksTarget=False, mUseHeightOffsetAtEnd=False, mSpeed=speed)
        for key, meta in definition['fields'].items():
            n.put(spec + meta['offset'], '?' if meta['type'] == 'bool' else 'f', settings[key])
        n.put(endpoint, 'fff', *target)
        n.call(0x874415, {r.UC_X86_REG_RAX: motion, r.UC_X86_REG_R14: motion,
                        r.UC_X86_REG_R12: actor, r.UC_X86_REG_R15: 0,
                        r.UC_X86_REG_R13: endpoint, r.UC_X86_REG_RBX: spec}, 0x874444)
        n.call(0x87f480, {r.UC_X86_REG_RDI: motion})
        n.call(0x874930, {r.UC_X86_REG_RDI: facing_spec, r.UC_X86_REG_RSI: motion})
        samples = []
        for tick in range(6):
            clock['time'] = f(clock['time'] + delta)
            n.call(0x88d350, {r.UC_X86_REG_RDI: update, r.UC_X86_REG_RSI: motion})
            n.call(0x88b760, {r.UC_X86_REG_RDI: motion, r.UC_X86_REG_RSI: update})
            samples.append({'time': clock['time'], 'updateHex': bytes(n.u.mem_read(update, 0x20)).hex(),
                            'historySize': n.q(motion + 0x68)})
            pos = struct.unpack('<fff', n.u.mem_read(actor + 0x15c, 12))
            movement = struct.unpack('<fff', n.u.mem_read(update + 0x10, 12))
            n.put(actor + 0x15c, 'fff', *[f(a+b) for a,b in zip(pos, movement)])
        frames.append({'position': position, 'target': target, 'speed': speed, 'delta': delta,
                       'samples': samples})
    ranges = [(0x887ab0, 0x887b0a), (0x874930, 0x874944), (0x88be50, 0x88be5a),
              (0x890880, 0x8908b8), (0x88bb16, 0x88bb42), (0x88b760, 0x88bb51),
              (0x872af9, 0x872b55), (0x88602a, 0x88606b), (0x88a142, 0x88a155)]
    blocks = []
    for start, end in ranges:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]:
            raise ValueError('Vertical-facing instructions differ from pristine client')
        blocks.append({'rva': start, 'bytes': end-start, 'sha256': sha(raw)})
    sources = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-match-velocity-facing-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'blocks': blocks,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)},
              'threshold': {'rva': threshold_rva, 'value': threshold,
                            'bytesHex': n.image[threshold_rva:threshold_rva+4].hex()},
              'targetBoneContract': {'sourceProperty': 'mStartBoneName', 'sourceOffset': 0x30,
                                     'targetProperty': 'mTargetBoneName', 'targetOffset': 0x18,
                                     'targetLengthOffset': 0x20, 'defaultTargetLength': 0,
                                     'runtimeTargetBoneHashOffset': 0x38},
              'cases': cases, 'frames': frames,
              'scope': {'originalFactoryEvaluatorAndControllerFrame': True,
                        'suppliedFloat32Clock': True, 'actualClockSchedule': False,
                        'actorPositionFedFromNativeDisplacement': True,
                        'actorApplyAndBounds': False, 'targetAcceptance': False}}
    output = args.cache / 'research/match-velocity-facing-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases),
                      'frames': sum(len(c['samples']) for c in frames)}))


if __name__ == '__main__':
    main()
