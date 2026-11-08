"""Original visibility-component set/reset/query controls, separate from acceptance.

AI-base owner callbacks are original no-ops. Concrete AI-client owner callbacks
are recorded as required dependencies, never replaced during these controls.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path

from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import ADDRESSES, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    unit = fixture.construct_ai()
    component = unit + 0x1e0
    configuration = n.allocate(0x1c0)
    n.call(0x624060, {r.UC_X86_REG_RDI: configuration})
    if n.q(n.base + 0x24705d0) != configuration or n.u32(configuration + 8):
        raise ValueError('Original visibility configuration default differs')
    n.call(0x66a140, {}, 0x66a16d)
    identity = 0x4000003d
    n.put(unit + 0x78, 'I', identity)
    n.call(0x21b103, {r.UC_X86_REG_RBX: component, r.UC_X86_REG_RSI: unit + 0x78,
                     r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, 0x21b19c)
    payload, vector = n.allocate(32), n.allocate(16)
    n.put(vector, 'Q', payload)
    # Feed an owned launch string to the original parser prefix. Stop after
    # launch-kind selection, before the remaining command-line settings pass.
    launch = n.allocate(24)
    launch_reference = n.allocate(8)
    launch_text = n.allocate(256)
    supplied_path = b'controlled-fixture.rofl'
    n.u.mem_write(launch_text, supplied_path + b'\0')
    n.call(0x11fe0, {r.UC_X86_REG_RDI: launch, r.UC_X86_REG_RSI: launch_text,
                     r.UC_X86_REG_RDX: len(supplied_path)})
    n.put(launch_reference, 'Q', launch)
    fixture.run_to(0x624540, 0x6248c6,
                   {r.UC_X86_REG_RDI: configuration, r.UC_X86_REG_RDX: launch_reference})
    launch_mode = n.u32(configuration + 8)
    if launch_mode != 3:
        raise ValueError('Original supplied .rofl launch-kind mode differs')
    launch_control = {'suppliedLaunchAscii': supplied_path.decode('ascii'),
                      'parserPrefix': [0x624540, 0x6248c6], 'modeValue': launch_mode,
                      'remainingCommandLinePassExecuted': False,
                      'actualSpectatorConfigurationRecovered': False}
    rows = []
    for mode in [0, 1, 3, 0xffffffff]:
        for override in [False, True]:
            n.put(configuration + 8, 'I', mode)
            n.put(unit + 0x201, 'B', 0)
            n.put(unit + 0x208, 'B', 0)
            if override:
                n.call(0x21b670, {r.UC_X86_REG_RDI: component})
            for action in ['constructor-state', 'primary', 'reset', 'primary-again', 'unknown-id']:
                if action in ['primary', 'primary-again', 'unknown-id']:
                    n.call(0x21b710, {r.UC_X86_REG_RDI: vector,
                                     r.UC_X86_REG_RSI: identity if action != 'unknown-id' else identity + 1})
                elif action == 'reset':
                    n.call(0x21b570, {r.UC_X86_REG_RDI: component})
                initialized = bytes(n.u.mem_read(unit + 0x201, 1))[0]
                retained_override = bytes(n.u.mem_read(unit + 0x208, 1))[0]
                n.call(0x213c00, {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: 0})
                visible = n.u.reg_read(r.UC_X86_REG_RAX) & 255
                expected_flag = 0 if action == 'constructor-state' or (action == 'reset' and mode == 0) else 1
                expected = bool(expected_flag or (override and mode == 0))
                if initialized != expected_flag or retained_override != int(override) or visible != int(expected):
                    raise ValueError('Original controlled visibility lifecycle differs')
                rows.append({'suppliedModeValue': mode, 'originalOverrideSetterExecuted': override,
                             'action': action, 'byte201': initialized, 'byte208': retained_override,
                             'queryArgumentSil': 0, 'queryResult': visible})
    mask_rows = []
    for encoded in range(256):
        added = (encoded + 0xea) & 255
        rotated = ((added << 6) | (added >> 2)) & 255
        slot = ((rotated >> 1) & 0x55) | ((rotated << 1) & 0xaa)
        n.put(payload + 0x10, 'B', encoded)
        for callback, initial in [(0x21b5a0, 0), (0x21b5a0, 0xa5a5a5a5),
                                  (0x21b5d0, 0xffffffff), (0x21b5d0, 0xa5a5a5a5)]:
            n.put(component + 0x24, 'I', initial)
            n.call(callback, {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: payload})
            actual = n.u32(component + 0x24)
            bit = 1 << (slot & 31)
            expected = initial | bit if callback == 0x21b5a0 else initial & (~bit & 0xffffffff)
            if actual != expected:
                raise ValueError('Original encoded per-view mask mutation differs')
            mask_rows.append({'encodedByte10': encoded, 'decodedSlotByte': slot,
                              'effectiveShiftCount': slot & 31, 'callbackRva': callback,
                              'initialMask': initial, 'resultMask': actual})
    query_rows = []
    sentinel = bytes(n.u.mem_read(n.base + 0x2566b40, 1))[0]
    n.put(configuration + 8, 'I', 3)
    n.put(component + 0x21, 'B', 1)
    for enabled in [0, 1]:
        n.put(n.base + 0x255cc88, 'B', enabled)
        for selected in sorted(set([0, 1, 7, 31, 32, 255, sentinel])):
            n.put(n.base + 0x255cc89, 'B', selected)
            for mask in [0, 1, 0x80000000, 0xa5a5a5a5, 0xffffffff]:
                n.put(component + 0x24, 'I', mask)
                n.call(0x213c00, {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: 1})
                actual = n.u.reg_read(r.UC_X86_REG_RAX) & 255
                expected = (not enabled or (mask != 0 if selected == sentinel else
                                            bool(mask & (1 << (selected & 31)))))
                if actual != int(expected):
                    raise ValueError('Original supplied selected-view visibility query differs')
                query_rows.append({'suppliedModeValue': 3, 'suppliedFilterEnabled': enabled,
                                   'suppliedSelectedSlot': selected, 'originalSentinelByte': sentinel,
                                   'suppliedMask': mask, 'queryArgumentSil': 1, 'queryResult': actual})
    # Original toggle branches publish the view inputs; presentation refresh
    # calls after these boundaries require the concrete UI owner and are omitted.
    view_owner = n.allocate(0x320)
    producer_rows = []
    for selected in [0, 1, 31, 255]:
        n.put(view_owner + 0x1dc, 'B', selected)
        for enabled, start, end in [(True, 0xf03dc7, 0xf03de2),
                                    (False, 0xf03dfa, 0xf03e17)]:
            fixture.run_to(start, end, {r.UC_X86_REG_R14: view_owner})
            actual = bytes(n.u.mem_read(n.base + 0x255cc88, 2))
            if actual != bytes([int(enabled), selected if enabled else sentinel]):
                raise ValueError('Original supplied view toggle producer differs')
            producer_rows.append({'suppliedOwnerSlotByte1dc': selected, 'selectedOriginalBranch': enabled,
                                  'originalPrefix': [start, end], 'publishedEnabled': actual[0],
                                  'publishedSelectedSlot': actual[1], 'presentationRefreshExecuted': False})
    fixture.check_guard(unit)
    ranges = [
        ('component-constructor-defaults-and-registration', 0x21b0b0, 0x21b21a),
        ('component-reset-and-mask-callbacks', 0x21b570, 0x21b5f9),
        ('component-override-setter', 0x21b670, 0x21b67a),
        ('primary-and-secondary-dispatch', 0x21b710, 0x21b7e0),
        ('component-query', 0x213c00, 0x213c39),
        ('selected-view-query', 0x21b7e0, 0x21b823),
        ('mask-bit-query', 0x6cf1c0, 0x6cf1ce),
        ('mask-bit-set-and-clear', 0x6cf430, 0x6cf461),
        ('client-owner-vtable-construction', 0xea4ae, 0xea4bc),
        ('client-primary-thunk', 0x1039a0, 0x1039c2),
        ('client-primary-deserializer', 0x103860, 0x103997),
        ('client-secondary-deserializer', 0x1092a0, 0x10931f),
        ('client-reset-callback', 0x103780, 0x103833),
        ('packet822-dispatch', 0x6e27da, 0x6e2806),
        ('generic-packet-dispatch', 0x6daed4, 0x6daf03),
        ('launch-kind-parser', 0x624540, 0x624617),
        ('selected-view-input-producer', 0xf03da0, 0xf03e1c),
    ]
    md, blocks = Cs(CS_ARCH_X86, CS_MODE_64), []
    for label, start, end in ranges:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]:
            raise ValueError('Visibility instructions differ from pristine client')
        instructions = list(md.disasm(raw, start))
        if sum(i.size for i in instructions) != len(raw):
            raise ValueError('Visibility instruction boundary differs: ' + label)
        blocks.append({'label': label, 'rva': start, 'bytes': len(raw), 'sha256': sha(raw),
                       'instructions': [{'rva': i.address, 'mnemonic': i.mnemonic, 'operands': i.op_str}
                                        for i in instructions]})
    owners = []
    for table in [0x22ed3c8, 0x22f06a0]:
        raw = n.image[table:table + 0x60]
        if raw != n.source.image[table:table + len(raw)]:
            raise ValueError('Visibility owner table differs from pristine client')
        owners.append({'vtableRva': table, 'sha256': sha(raw),
                       'callbacks': {hex(slot): struct.unpack_from('<Q', raw, slot)[0] - n.base
                                     for slot in [0x48, 0x50, 0x58]}})
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-visibility-component-lifecycle-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'blocks': blocks, 'ownerInterfaces': owners, 'controls': rows,
              'suppliedReplayLaunchControl': launch_control,
              'encodedMaskControls': mask_rows, 'selectedViewQueryControls': query_rows,
              'selectedViewProducerControls': producer_rows,
              'observedBindings': [{'packetOpcode': 918, 'callbackRva': 0x21b570},
                                   {'packetOpcode': 48, 'callbackRva': 0x21b5a0},
                                   {'packetOpcode': 582, 'callbackRva': 0x21b5d0}],
              'scope': {'originalAiBaseConstructor': True, 'originalSetResetQueryFunctions': True,
                        'ownerCallbacks': 'original-ai-base-no-ops', 'suppliedConfigurationModes': True,
                        'overrideSetterTypeProducerRecovered': False,
                        'concreteClientOwnerCallbacksExecuted': False, 'recordedVisibilityRecovered': False,
                        'actualTargetAcceptanceRecovered': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/target-visibility-lifecycle-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(rows), 'blocks': len(blocks),
                      'encodedMaskControls': len(mask_rows), 'selectedViewQueryControls': len(query_rows),
                      'selectedViewProducerControls': len(producer_rows),
                      'suppliedReplayLaunchControl': launch_control,
                      'ownerInterfaces': owners, 'scope': report['scope']}))


if __name__ == '__main__':
    main()
