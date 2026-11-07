"""Original opcode-129 getters and bounded model/resource selection prefixes.

The supplied form table is a control, not recovered live character state.
Renderer/animation work between the native removal and push is not executed.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from unit_resource_native import NativeUnitResources
from vfx_spawn_native import sha

PACKET, FRAME = 0x100f1000, 0x100f5000


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    n = NativeUnitResources(cache/'public/decoder-16.21-macos', args.client)
    inputs = {}

    def read(path):
        raw = path.read_bytes()
        inputs[str(path.resolve())] = sha(raw)
        return json.loads(raw)

    corpus = read(cache/'research/structural-corpus.json')
    oracle = read(cache/'research/structural-corpus-native.json')
    if (oracle['decoderImageSha256'] != sha(n.image) or
            oracle['constructorImageSha256'] != n.profile['constructorImageSha256']):
        raise ValueError('Matching native packet observations required')
    # Original listener registration: callback pointer, opcode, then registration.
    expected = {0xf0ac7: bytes.fromhex('488d0d32d20000'),
                0xf0b1b: bytes.fromhex('ba81000000'),
                0xf0b23: bytes.fromhex('e8e8675c00')}
    for at, code in expected.items():
        if n.image[at:at+len(code)] != code:
            raise ValueError(f'Opcode-129 original listener changed: {at:x}')

    def getter(data):
        n.u.mem_write(PACKET, data)
        n.call(0xfdd9c, {r.UC_X86_REG_R14: PACKET}, 0xfddf3)
        return {'index': (n.u.reg_read(r.UC_X86_REG_RSI) & 255),
                'nativeFlag': bool(n.u.reg_read(r.UC_X86_REG_RCX) & 255)}

    columns = {'index': [], 'nativeFlag': []}
    for byte in range(256):
        data = bytearray(20)
        data[0x10] = data[0x11] = byte
        values = getter(bytes(data))
        for key in columns:
            columns[key].append(values[key])
    if len(set(columns['index'])) != 256 or set(columns['nativeFlag']) != {False, True}:
        raise ValueError('Unexpected native model-index/boolean codec')
    probes = []
    for index in range(512):
        data = bytearray(20)
        a, b = (index*73+19) & 255, (index*61+(index >> 8)*29) & 255
        data[0x10], data[0x11] = a, b
        observed = getter(bytes(data))
        if observed != {'index': columns['index'][a], 'nativeFlag': columns['nativeFlag'][b]}:
            raise ValueError('Native form getters depend on another field')
        probes.append({'bytesHex': bytes(data).hex(), **observed})
    records = []
    for key, sample in corpus['packets'].items():
        if sample['opcode'] != 129:
            continue
        obj = oracle['observations'][key]
        if (obj['status'] != 'complete' or obj['param'] != sample['param'] or
                obj['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex']))):
            raise ValueError('Incomplete original form packet')
        data = bytes.fromhex(obj['object'])
        if len(data) != 20 or struct.unpack_from('<I', data, 8)[0] != 129:
            raise ValueError('Original form packet layout differs')
        values = getter(data)
        records.append({'key': key, 'time': sample['time'], 'entityId': sample['param'],
                        **values, 'signedIndex': (values['index']+128) % 256-128})

    # Execute original validation, previous-overlay removal, and the later push
    # separately. This deliberately excludes the intervening world/render calls.
    unit = n.create_unit()
    component, group = n.allocate(0x100), unit['group']
    forms = [n.allocate(0x200), 0, n.allocate(0x200)]
    resolvers = [n.allocate(24), n.allocate(24)]
    for form, resolver in zip([forms[0], forms[2]], resolvers):
        n.put(form+0x158, 'Q', resolver)
    vector = n.allocate(24)
    n.put(vector, 'QQQ', *forms)
    n.put(component+0x10, 'QQ', vector, vector+24)
    overlay_vector = n.allocate(64)
    # Duplicate pointers establish first-removal semantics independently of push.
    initial = [resolvers[0], 0, resolvers[0], resolvers[1]]
    controls = []
    for previous in [255, 0, 1, 2, 3]:
        for index in [128, 255, 0, 1, 2, 3, 127]:
            n.put(overlay_vector, 'QQQQ', *initial)
            n.put(group+0x18, 'QQQ', overlay_vector, overlay_vector+32, overlay_vector+64)
            n.put(component+0x28, 'B', previous)
            valid = index in [0, 2]
            args_in = {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: index,
                       r.UC_X86_REG_RDX: unit['object'], r.UC_X86_REG_RCX: 1}
            n.call(0x30ed00, args_in, 0x30ee07 if valid else None)
            after_remove = [n.q(at) for at in range(n.q(group+0x18), n.q(group+0x20), 8)]
            expected_remove = initial.copy()
            previous_resolver = resolvers[previous//2] if previous in [0, 2] else None
            if valid and previous_resolver in expected_remove:
                expected_remove.remove(previous_resolver)
            if after_remove != expected_remove or n.u.mem_read(component+0x28, 1)[0] != previous:
                raise ValueError('Original model selection/removal prefix differs')
            after_push = None
            if valid:
                frame = n.u.reg_read(r.UC_X86_REG_RBP)
                if n.q(frame-0x190) != group or n.u.reg_read(r.UC_X86_REG_R13) != forms[index]:
                    raise ValueError('Original model prefix selected a different table entry')
                n.put(FRAME-0x150, 'Q', forms[index])
                n.put(FRAME-0x190, 'Q', group)
                n.call(0x30f100, {r.UC_X86_REG_RBP: FRAME}, 0x30f11a)
                after_push = [n.q(at) for at in range(n.q(group+0x18), n.q(group+0x20), 8)]
                target = resolvers[index//2]
                expected_push = expected_remove.copy()
                if target in expected_push:
                    expected_push.remove(target)
                expected_push.append(target)
                if after_push != expected_push:
                    raise ValueError('Original selected model overlay push differs')
            elif n.u.reg_read(r.UC_X86_REG_RAX) & 255:
                raise ValueError('Invalid native model index was accepted')
            controls.append({'previous': previous, 'index': index, 'acceptedPrefix': valid,
                             'before': initial, 'afterRemoval': after_remove, 'afterPush': after_push})

    ranges = [(0xf0ac7, 0xf0b28), (0xfdd9c, 0xfddf6), (0x30ed00, 0x30ee07),
              (0x30f037, 0x30f041), (0x30f100, 0x30f11a), (0x3774f0, 0x37754c)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original form code differs from matching executable')
    meta = {'schema': 1, 'kind': 'prepared-original-unit-form-inputs',
            'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
            'decoderImageSha256': sha(n.image), 'constructorImageSha256': n.profile['constructorImageSha256'],
            'opcode': 129, 'decoderRva': n.profile['packets']['129']['entryRva'], 'objectSize': 20,
            'getterBlock': [0xfdd9c, 0xfddf3], 'indexOffset': 0x10, 'flagOffset': 0x11,
            'decode': columns, 'indexInterpretation': 'signed-int8',
            'resourceTransition': 'remove-first-previous-resolver-then-push-selected-resolver',
            'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a, b in ranges],
            'scope': {'staticBuildDataOnly': True, 'containsReplayEvents': False,
                      'nativeGetterExecuted': True, 'suppliedFormSelectionPrefixesExecuted': True,
                      'fullModelTransitionExecuted': False, 'liveFormTablesRecovered': False,
                      'nativeFlagMeaningRecovered': False, 'effectFactoryExecuted': False}}
    encoded = json.dumps(meta, indent=2).encode()
    dest = cache/'public/latest-unit-form-inputs/package.json'
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(encoded)
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in NativeUnitResources.__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'native-unit-form-input-observations',
              'build': meta['build'], 'protocol': meta['protocol'], 'packageSha256': sha(encoded),
              'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()), 'probes': probes, 'records': records,
              'controls': controls, 'counts': {'getterByteCases': 512, 'mixedGetterCases': len(probes),
                                             'nativePacketSamples': len(records), 'selectionControls': len(controls)},
              'scope': meta['scope']}
    (cache/'research/unit-form-inputs-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(encoded), 'counts': result['counts']}))


if __name__ == '__main__':
    main()
