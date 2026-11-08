"""Original constructor/conversion/query for decoded indexed CastInfo overrides.

Runtime world IDs/target acceptance are not involved. Actual packet observations
remain offline comparison fixtures, never per-match browser state packages.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path); parser.add_argument('client', type=Path)
    args = parser.parse_args(); n = NativeSpawn(args.cache / 'public/decoder-16.21-macos', args.client)
    output, packet, frame, value = n.allocate(0x200), n.allocate(0x300), n.allocate(0x200), n.allocate(16)
    frame += 0x100
    inputs, records = {}, []
    def convert(raw):
        n.u.mem_write(packet, raw)
        n.call(0x82cb2a, {r.UC_X86_REG_RDI: output, r.UC_X86_REG_XMM0: 0}, 0x82cb43)
        n.put(frame - 0x30, 'Q', output); n.put(frame - 0x58, 'Q', packet)
        n.call(0x82c360, {r.UC_X86_REG_R10: output, r.UC_X86_REG_R14: packet,
                         r.UC_X86_REG_RBP: frame, r.UC_X86_REG_R12: 0, r.UC_X86_REG_R13: 0}, 0x82c6ae)
        count = struct.unpack('<I', n.u.mem_read(output + 0xb8, 4))[0]
        n.put(value, 'I', 0xa5a5a5a5)
        n.call(0x8298d0, {r.UC_X86_REG_RDI: output, r.UC_X86_REG_RSI: 0, r.UC_X86_REG_RDX: value})
        found = bool(n.u.reg_read(r.UC_X86_REG_RAX) & 255)
        return {'count': count, 'travelTimeOverrideFound': found,
                'travelTimeOverrideHex': bytes(n.u.mem_read(value, 4)).hex()}
    for name in ['projectile-combat-native.json', 'combat-native.json']:
        path = args.cache / 'research' / name; raw = path.read_bytes(); inputs[str(path.resolve())] = sha(raw)
        observed = json.loads(raw)
        if observed['decoderImageSha256'] != sha(n.image): raise ValueError('Indexed override native fixture build mismatch')
        for key, observation in observed['observations'].items():
            if observation['opcode'] not in [28, 1027]: continue
            if observation['status'] != 'complete': raise ValueError('Incomplete override packet fixture')
            obj = bytes.fromhex(observation['object']); base = 168 if observation['opcode'] == 28 else 24
            cast = obj[base:base+0x150]
            count = struct.unpack_from('<I', cast, 0x60)[0]
            if count != 0: raise ValueError('Actual nonempty override list requires an independently bounded heap relocation control')
            result = convert(cast)
            if result != {'count': 0, 'travelTimeOverrideFound': False, 'travelTimeOverrideHex': 'a5a5a5a5'}: raise ValueError('Original empty override producer/query differs')
            records.append({'source': name, 'key': key, 'opcode': observation['opcode'], 'payloadSha256': observation['payloadSha256'], 'indexedOverrideCount': count, 'result': result})
    controls = []
    for key in [0, 1, 255]:
        raw = bytearray(0x150); types, values = n.allocate(16), n.allocate(16)
        n.put(types, 'B', key); n.put(values, 'f', 0.7)
        struct.pack_into('<Q', raw, 0x58, types); struct.pack_into('<I', raw, 0x60, 1); struct.pack_into('<Q', raw, 0x90, values)
        result = convert(bytes(raw))
        if result['count'] != 1 or result['travelTimeOverrideFound'] != (key == 0): raise ValueError('Original explicit indexed override control differs')
        controls.append({'type': key, 'valueHex': bytes(n.u.mem_read(values, 4)).hex(), 'result': result})
    ranges = [(0x82cb2a, 0x82cb43), (0x82c360, 0x82c6ae), (0x8298d0, 0x829936)]
    blocks = []
    for start, end in ranges:
        raw = n.image[start:end]
        if raw != n.source.image[start:end]: raise ValueError('Indexed override original instructions differ')
        blocks.append({'rva': start, 'bytes': end-start, 'sha256': sha(raw)})
    sources = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-indexed-cast-override-producer-controls', 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image), 'inputs': inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(sources)}, 'blocks': blocks, 'records': records, 'controls': controls, 'layout': {'packetCountOffset': 0x60, 'packetTypesOffset': 0x58, 'packetValuesOffset': 0x90, 'runtimeVectorOffset': 0xb0, 'runtimeCountOffset': 0xb8, 'travelTimeIndex': 0}, 'scope': {'actualEmptyListProducerAndQueryExecuted': True, 'nonemptyListControlsExecuted': True, 'browserNonemptyListTranslation': False, 'worldAcceptance': False}}
    output = args.cache / 'research/cast-indexed-overrides-native.json'; output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'packets': len(records), 'controls': len(controls)}))


if __name__ == '__main__': main()
