"""Trace the actual replay startup mode into the original client configuration.

Only the mode-specific forwarding fragments, full mode setter/getter and
mode-registry selection execute. The full startup/game loop does not run.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from unit_base_context_native import NativeUnitBaseContexts
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha

FRAME = 0x100f5000


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}

    def raw(path):
        b = path.read_bytes()
        inputs[str(path.resolve())] = sha(b)
        return b

    def read(path):
        return json.loads(raw(path))

    samples = read(cache/'research/startup-streams-input.json')
    framing = read(cache/'research/startup-streams-framing-comparison.json')
    objects = read(cache/'research/startup-streams-native.json')
    n = NativeUnitBaseContexts(cache/'public/decoder-16.21-macos', args.client)
    if (framing['mismatches'] or framing['matched'] != 2 or
            framing['replaySha256'] != samples['replaySha256'] or
            objects['decoderImageSha256'] != sha(n.image) or
            objects['constructorImageSha256'] != n.profile['constructorImageSha256']):
        raise ValueError('Matching framed native startup packet required')
    selected = [(key, sample) for key, sample in samples['packets'].items() if sample['opcode'] == 728]
    if len(selected) != 1:
        raise ValueError('Exactly one original startup configuration packet required')
    key, sample = selected[0]
    observation = objects['observations'][key]
    if (sample['stream'] != 3 or sample['time'] != 0 or sample['param'] != 0 or
            observation['status'] != 'complete' or
            observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex']))):
        raise ValueError('Incomplete native startup configuration')
    obj, heap = bytes.fromhex(observation['object']), bytes.fromhex(observation['heap'])
    if len(obj) != 568 or struct.unpack_from('<H', obj, 8)[0] != 728 or obj != heap[:len(obj)]:
        raise ValueError('Original startup object layout differs')
    n.u.mem_write(0x10200000, heap)
    config = n.allocate(0x208)
    n.call(0x61e8b0, {r.UC_X86_REG_RDI: config})
    if n.q(n.base+0x246d020) != config:
        raise ValueError('Original client configuration constructor global differs')
    # The original configuration consumer reads the encoded map value at its
    # subobject +18 (packet +88). Recover each independent native byte codec.
    scratch = 0x100e8000
    columns = [[] for _ in range(4)]
    for value in range(256):
        n.u.mem_write(scratch, bytes(0x20))
        n.u.mem_write(scratch+0x18, bytes([value])*4)
        n.call(0x61f287, {r.UC_X86_REG_RSI: scratch, r.UC_X86_REG_RBX: config}, 0x61f2ef)
        result = n.u32(config+0x50).to_bytes(4, 'little')
        for lane, byte in enumerate(result):
            columns[lane].append(byte)
    if any(len(set(column)) != 256 for column in columns):
        raise ValueError('Configured map field is not a byte bijection')
    probes = []
    for index in range(512):
        encoded = bytes((index*73+lane*61+(index >> 8)*29) & 255 for lane in range(4))
        n.u.mem_write(scratch+0x18, encoded)
        n.call(0x61f287, {r.UC_X86_REG_RSI: scratch, r.UC_X86_REG_RBX: config}, 0x61f2ef)
        actual = n.u32(config+0x50)
        translated = int.from_bytes(bytes(columns[lane][byte] for lane, byte in enumerate(encoded)), 'little')
        if actual != translated:
            raise ValueError('Mixed original configured map field differs')
        probes.append({'encodedHex': encoded.hex(), 'value': actual})
    n.call(0x6f6599, {r.UC_X86_REG_R14: 0x10200000}, 0x6f65a7)
    forwarded = n.u.reg_read(r.UC_X86_REG_RSI)
    if forwarded != 0x10200070:
        raise ValueError('Original startup handler forwarded another subobject')
    n.call(0x66eef3, {r.UC_X86_REG_RBX: forwarded}, 0x66ef00)
    if n.u.reg_read(r.UC_X86_REG_RSI) != forwarded or n.u.reg_read(r.UC_X86_REG_RDI) != config:
        raise ValueError('Original startup configuration forwarding differs')
    n.call(0x61f287, {r.UC_X86_REG_RSI: forwarded, r.UC_X86_REG_RBX: config}, 0x61f2ef)
    n.call(0x620900, {r.UC_X86_REG_RDI: config})
    map_id = n.u.reg_read(r.UC_X86_REG_RAX) & 0xffffffff
    n.call(0x62023c, {r.UC_X86_REG_R13: forwarded, r.UC_X86_REG_RBX: config}, 0x620248)
    n.call(0x620940, {r.UC_X86_REG_RDI: config})
    text = n.u.reg_read(r.UC_X86_REG_RAX)
    length = n.u32(config+0x98)
    if not 1 <= length <= 64 or n.u.mem_read(text+length, 1) != b'\0':
        raise ValueError('Original startup mode text exceeds bounds')
    mode = bytes(n.u.mem_read(text, length)).decode('ascii')
    packet_pointer, packet_length, packet_capacity = struct.unpack_from('<QII', obj, 0xb8)
    if (bytes(n.u.mem_read(packet_pointer, packet_length)).decode('ascii') != mode or
            packet_length != length or packet_capacity <= packet_length):
        raise ValueError('Original mode consumer selected another packet string')
    # Register TFT with the original callbacks, then query the mode stored by
    # the actual replay's original configuration setter, rather than a control.
    n.u.mem_write(FRAME-0x500, bytes(0x500))
    n.call(0x9239ba, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: FRAME-0xf0,
                    r.UC_X86_REG_R14: FRAME-0x50}, 0x923a15)
    if mode.upper() == 'TFT':
        n.call(0x40be50, {}, 0x40bfc5)
        selected_tft = True
    else:
        n.call(0x40be50, {})
        selected_tft = False
    ranges = [(0x6f52f5, 0x6f5325), (0x6f6599, 0x6f65ac), (0x66eeeb, 0x66ef05),
              (0x61f281, 0x61f287), (0x62023c, 0x620248), (0x620620, 0x6207d0),
              (0x620940, 0x620950), (0x61f287, 0x61f2ef), (0x620900, 0x620910),
              (0x9239ba, 0x923a15), (0x40be50, 0x40c080)]
    for a, b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original startup mode code differs from executable')
    paths = {Path(__file__), Path(inspect.getfile(NativeEffectContexts)),
             *[Path(inspect.getfile(c)) for c in NativeUnitBaseContexts.__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-replay-startup-mode-observation',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'replaySha256': samples['replaySha256'],
        'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'originalBlocks': list(n.blocks.values()), 'packetKey': key,
        'packetLayout': {'opcode': 728, 'objectSize': 568, 'modePointerOffset': 0xb8,
                         'modeLengthOffset': 0xc0, 'modeCapacityOffset': 0xc4, 'mapIdOffset': 0x88},
        'mapIdCodec': columns, 'mapIdProbes': probes, 'configuredMapId': map_id,
        'mode': mode, 'modeHash': n.u32(config+0x88), 'tftFactorySelected': selected_tft,
        'configuredMode': {'object': config, 'stringAddress': text, 'length': length},
        'scope': {'actualRecordedStartupPacket': True, 'nativeFramingCompared': True,
            'nativeModeForwardingFragmentsExecuted': True, 'fullNativeModeSetterGetterExecuted': True,
            'originalModeRegistrySelectionExecuted': True, 'fullStartupHandlerExecuted': False,
            'tftSubsystemCreated': False, 'allOverlayProducersExcluded': False,
            'liveUnitResourceStackReconstructed': False, 'effectFactoryExecuted': False,
            'mainViewerExpanded': False, 'browserExecuted': False}}
    (cache/'research/startup-mode-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'mode': mode, 'modeHash': result['modeHash'], 'mapId': map_id,
                      'mixedMapIdComparisons': len(probes), 'tftFactorySelected': selected_tft}))


if __name__ == '__main__':
    main()
