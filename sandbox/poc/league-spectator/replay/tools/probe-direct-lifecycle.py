"""Owned original lifecycle fragments, independent of runtime integration.

No replay, audio, destructor, provider, or native world acceptance is supplied.
The original full bound graph initializes the typed objects; controls change
only the explicitly named fragment inputs and retain their exact readback.
"""
import argparse
import hashlib
import json
import struct
import inspect
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A
from vfx_spawn_native import name_hash
from vfx_asset_native import NativeVfxAssets, ROOT_TYPE


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    sha = lambda raw: hashlib.sha256(raw).hexdigest()
    inputs = {}
    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    decoder = args.cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    bound = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    system = n.checked_json('vfx-system.json', 'vfxSystemSha256')
    for name, expected in {**bound['compilerSources'], **system['compilerSources']}.items():
        if sha(Path(__file__).with_name(name).read_bytes()) != expected:
            raise ValueError('Changed original graph prerequisite: ' + name)
    previous = read(args.cache / 'research/vfx-retirement-native.json')
    ref = previous['cases'][0]['ref']
    graph_raw = raw(decoder / ref['file'])
    if sha(graph_raw) != ref['sha256']:
        raise ValueError('Exact original full graph required')
    n.reset_parent(json.loads(graph_raw), 1, 0, bound, system)
    initial = n.lifecycle()
    floating = lambda at: struct.unpack('<f', n.u.mem_read(at, 4))[0]
    fp = lambda value: int.from_bytes(struct.pack('<f', value), 'little')
    def run(start, ends, registers):
        n.u.context_restore(n.initial)
        n.put(A['stack'], 'Q', A['stop'])
        n.u.reg_write(r.UC_X86_REG_RSP, A['stack'])
        n.u.reg_write(r.UC_X86_REG_RBP, A['stack'] - 0x100)
        for key, value in registers.items():
            n.u.reg_write(key, value)
        hooks = [n.u.hook_add(unicorn.UC_HOOK_CODE,
                 lambda uc, address, size, user: uc.emu_stop(),
                 begin=n.base + end, end=n.base + end) for end in ends]
        try:
            n.u.emu_start(n.base + start, A['stop'], count=20000)
        finally:
            for hook in hooks:
                n.u.hook_del(hook)
        endpoint = n.u.reg_read(r.UC_X86_REG_RIP) - n.base
        if endpoint not in ends:
            raise ValueError('Owned lifecycle fragment escaped')
        return endpoint
    schedule = []
    for authored in [0, 8, 64, 212]:
        for parent_input in [0, 4]:
            for delta in [0, 1 / 120, 1 / 30, 0.2, 1.0]:
                for maximum in [1, 3, 20]:
                    n.put(A['systemDefinition'] + 0xc2, 'H', authored)
                    n.put(A['system'] + 0xf8, 'B', parent_input)
                    run(0x176330a, [0x1763391], {
                        r.UC_X86_REG_RBX: A['system'], r.UC_X86_REG_ESI: maximum,
                        r.UC_X86_REG_XMM0: fp(1), r.UC_X86_REG_XMM3: fp(delta),
                        r.UC_X86_REG_XMM4: fp(30)})
                    schedule.append({'authoredFlags': authored, 'parentInputFlags': parent_input,
                        'delta': delta, 'frequency': 30, 'maxSubsteps': maximum,
                        'count': n.u.reg_read(r.UC_X86_REG_ECX),
                        'step': struct.unpack('<f', struct.pack('<I', n.u.reg_read(r.UC_X86_REG_XMM6) & 0xffffffff))[0]})
    timers = []
    maximum = struct.unpack('<f', bytes.fromhex('ffff7f7f'))[0]
    for lifetime in [0, .5, 100]:
        for linger in [0, .75, maximum]:
            for cap in [0, 3, maximum]:
                n.put(A['definition'] + 0x100, 'Q', 0)
                for offset, value in [(0xf8, lifetime), (0x108, linger), (0x118, cap), (0x11c, cap)]:
                    n.put(A['definition'] + offset, 'f', value)
                run(0x16e1742, [0x16e17e6], {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_R15: A['link']})
                timers.append({'lifetime': lifetime, 'linger': linger, 'lifetimeCap': cap, 'lingerCap': cap,
                               'timers': [floating(A['link'] + 0x90), floating(A['link'] + 0x94)]})
    stops = []
    for parent in [0, 0x20, 0x8000, 0x8020]:
        for actor in [0, 2, 4, 6]:
            for emitter in [0, 0x10]:
                for emitted in [0, 1]:
                    for time in [.5, 1, 2]:
                        n.put(A['system'] + 0x2a9, 'H', parent)
                        n.put(A['actor'] + 0x18, 'B', actor)
                        n.put(A['actor'] + 0x20, 'f', 1)
                        n.put(A['link'] + 0x94, 'f', .5)
                        n.put(A['link'] + 0x80, 'I', emitted)
                        n.put(A['definition'] + 0x2d2, 'B', emitter)
                        end = run(0x17584c4, [0x175853d, 0x17585e3], {
                            r.UC_X86_REG_RAX: A['link'], r.UC_X86_REG_RBX: A['actor'],
                            r.UC_X86_REG_XMM0: fp(time)})
                        stops.append({'parentFlags': parent, 'actorFlags': actor, 'emitterFlags': emitter,
                            'linkControllerCount': emitted, 'time': time, 'lifetime': 1, 'stopTime': .5,
                            'stopRequested': bool(n.u.reg_read(r.UC_X86_REG_R14) & 255),
                            'finishedCandidate': bool(n.u.reg_read(r.UC_X86_REG_R15) & 255),
                            'singleEmissionBypassed': end == 0x17585e3})
    tails = []
    life = n.allocate(16)
    params = n.allocate(0x30)
    pool = n.q(A['actor'] + 0xa0)
    n.put(pool + 8, 'Q', life)
    for kind in [0, 1, 2, 3]:
        for parent in [0, 0x20]:
            for stop in [False, True]:
                for previous_stop in [-1, .25]:
                    for cutoff in [0, .75, maximum]:
                        n.put(A['definition'] + 0xcb, 'B', kind)
                        n.put(A['system'] + 0x2a9, 'H', parent)
                        n.put(A['actor'] + 0x10, 'f', previous_stop)
                        n.put(A['link'] + 0x90, 'f', cutoff)
                        n.put(life, 'ffff', 0, 1, .5, 5)
                        n.put(pool + 0x10, 'I', 2)
                        n.put(params + 0x18, 'f', 2)
                        run(0x175b1e0, [0x175b352], {r.UC_X86_REG_RDI: A['actor'],
                            r.UC_X86_REG_RSI: int(stop), r.UC_X86_REG_RDX: params})
                        tails.append({'lingerType': kind, 'parentFlags': parent, 'stopRequested': stop,
                            'previousStopTime': previous_stop, 'time': 2, 'cutoff': cutoff,
                            'particles': [[0, 1], [.5, 5]],
                            'stopTime': floating(A['actor'] + 0x10),
                            'after': list(struct.unpack('<ffff', n.u.mem_read(life, 16)))})
    completions = []
    for flags in [0, 1, 4, 5, 0x80, 0xff]:
        for time in [0, 1, 1.5, 1.5000001192092896, 3]:
            n.put(A['actor'] + 0x18, 'B', flags)
            n.put(life, 'ffff', 0, 1, .5, 1)
            n.put(params + 0x18, 'f', time)
            run(0x175b361, [0x175b3b5], {r.UC_X86_REG_R14: A['actor'],
                r.UC_X86_REG_R15: 2, r.UC_X86_REG_RBX: params})
            completions.append({'actorFlags': flags, 'time': time,
                'particles': [[0, 1], [.5, 1]], 'flags': n.u.mem_read(A['actor'] + 0x18, 1)[0]})
    emission = []
    for delay in [-1, 0, .5]:
        for time in [0, .5, 1, 1.25]:
            for window in [.5, maximum]:
                for period in [1, maximum]:
                    for stop in [False, True]:
                        for flags in [0, 2]:
                            n.put(A['actor'] + 0x20, 'f', 2)
                            n.put(A['actor'] + 0xd8, 'H', 0x1234)
                            n.put(A['actor'] + 0xb4, 'f', 7)
                            for at, value in [(0x218, delay), (0x220, window), (0x224, period)]:
                                n.put(A['definition'] + at, 'f', value)
                            end = run(0x175853d, [0x17585b7, 0x17585de, 0x17585e3], {
                                r.UC_X86_REG_RBX: A['actor'], r.UC_X86_REG_RCX: A['definition'],
                                r.UC_X86_REG_EDX: flags, r.UC_X86_REG_R14: int(stop),
                                r.UC_X86_REG_XMM0: fp(time)})
                            reset = struct.unpack('<H', n.u.mem_read(A['actor'] + 0xd8, 2))[0] == 0
                            if reset and floating(A['actor'] + 0xb4) != -maximum:
                                raise ValueError('Original emission loop reset bytes differ')
                            emission.append({'delay': delay, 'time': time, 'activeTime': window,
                                'period': period, 'stopRequested': stop, 'actorFlags': flags,
                                'lifetime': 2, 'emit': end == 0x17585b7, 'resetLoopState': reset})
    parent_completions = []
    for flags in [0, 2, 0x80, 0x82, 0xa0, 0xa2, 0x8000, 0xffff]:
        for actor in [0, 1, 4, 5, 0x80, 0xff]:
            n.put(A['system'] + 0x2a9, 'H', flags)
            n.put(A['actor'] + 0x18, 'B', actor)
            run(0x17638f3, [0x1763a3d], {r.UC_X86_REG_RBX: A['system'], r.UC_X86_REG_EAX: flags})
            parent_completions.append({'parentFlags': flags, 'complexFlags': [actor],
                'simpleComplete': [], 'meshComplete': [],
                'flags': struct.unpack('<H', n.u.mem_read(A['system'] + 0x2a9, 2))[0]})
    asset = NativeVfxAssets(decoder, args.client)
    fields = asset.type_catalog[f'{ROOT_TYPE:08x}']['properties']
    field_contract = []
    for name, offset, kind, mask in [
        ('particleLifetime', 0xf8, 131, 0), ('lifetime', 0x108, 133, 0),
        ('particleLinger', 0x118, 133, 0), ('emitterLinger', 0x11c, 133, 0),
        ('particleLingerType', 0xcb, 3, 0), ('timeBeforeFirstEmission', 0x218, 10, 0),
        ('period', 0x224, 133, 0), ('isSingleParticle', 0x2d2, 135, 16)]:
        matched = [v for v in fields if v['hash'] == name_hash(name)]
        if len(matched) != 1 or any(matched[0][k] != v for k, v in [('offset', offset), ('type', kind), ('mask', mask)]):
            raise ValueError('Original registered emitter lifecycle field changed: ' + name)
        field_contract.append({'name': name, **matched[0]})
    constructor = bytes.fromhex(asset.load([])['objectHex'])
    constructor_defaults = {name: struct.unpack_from('<f', constructor, offset)[0] for name, offset in [
        ('particleLifetime', 0xf8), ('lifetime', 0x108), ('particleLinger', 0x118),
        ('emitterLinger', 0x11c), ('delay', 0x218), ('activeTime', 0x220), ('period', 0x224)]}
    constructor_defaults.update({'lingerType': constructor[0xcb], 'single': bool(constructor[0x2d2] & 16)})
    if constructor_defaults != {'particleLifetime': 3, 'lifetime': maximum, 'particleLinger': 0,
        'emitterLinger': 0, 'delay': 0, 'activeTime': maximum, 'period': maximum, 'lingerType': 0, 'single': False}:
        raise ValueError('Original emitter lifecycle defaults changed')
    for path in [decoder / 'profile.json', decoder / 'image.bin', decoder / 'vfx-bound-quads.json', decoder / 'vfx-system.json']:
        raw(path)
    ranges = [(0x176330a, 0x1763391), (0x16e1742, 0x16e17e6),
              (0x17584c4, 0x1758546), (0x175b1e0, 0x175b352), (0x175b361, 0x175b3b5)]
    ranges.append((0x17638f3, 0x1763a3d))
    ranges.append((0x175853d, 0x17585e3))
    blocks = []
    for a, z in ranges:
        if n.image[a:z] != n.source.image[a:z]:
            raise ValueError('Original lifecycle instructions changed')
        blocks.append({'rva': a, 'size': z - a, 'sha256': sha(n.image[a:z])})
    sources = {str(Path(__file__).resolve()): sha(Path(__file__).read_bytes())}
    for cls in [*type(n).__mro__, *type(asset).__mro__]:
        if cls is object:
            continue
        path = Path(inspect.getfile(cls))
        sources[str(path.resolve())] = sha(path.read_bytes())
    output = {'schema': 1, 'kind': 'native-direct-lifecycle-fragments', 'build': bound['build'],
        'protocol': bound['protocol'], 'inputs': inputs, 'sources': sources, 'originalBlocks': blocks,
        'constructorInitial': initial, 'registeredFields': field_contract, 'constructorDefaults': constructor_defaults,
        'schedule': schedule, 'timers': timers, 'stops': stops, 'tails': tails,
        'completions': completions, 'parentCompletions': parent_completions,
        'emission': emission,
        'scope': {'suppliedFragmentInputs': True, 'authoredFlagsDistinctFromRuntimeParentWord': True,
                  'audioAbsent': True, 'resourceLifetimeProvider': False, 'destructorExecuted': False,
                  'nativeWorldAcceptance': False, 'browserAcceptance': False}}
    destination = args.cache / 'research/direct-lifecycle-native.json'
    destination.write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(destination), 'counts': {k: len(output[k]) for k in ['schedule', 'timers', 'stops', 'tails']}}))


if __name__ == '__main__':
    main()
