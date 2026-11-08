"""Observe original AI constructor writes covering target visibility bytes."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    unit = n.allocate(0x4100, 0xa5)
    writes = []
    def observe(engine, access, address, size, value, user):
        covered = [offset for offset in [0x201, 0x208] if address <= unit + offset < address + size]
        if covered:
            instruction = engine.reg_read(r.UC_X86_REG_RIP) - n.base
            writes.append({'instructionRva': instruction, 'offset': address-unit, 'bytes': size,
                'coveredFields': covered, 'low64ValueHex': (value & ((1 << 64)-1)).to_bytes(8,'little').hex(),
                'instructionBytesHex': n.image[instruction:instruction+15].hex()})
    n.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, observe, begin=unit, end=unit+0x3fff)
    n.call(0xbc980, {r.UC_X86_REG_RDI: unit})
    fixture.check_guard(unit)
    constructor_writes = list(writes)
    defaults = {'byte201': bytes(n.u.mem_read(unit+0x201,1))[0],
                'byte208': bytes(n.u.mem_read(unit+0x208,1))[0]}
    writes.clear()
    table = n.q(unit + 0x1e0)
    owner = n.q(unit + 0x1e8)
    reference = n.q(unit + 0x1f0)
    if reference != unit + 0x78:
        raise ValueError('Original AI visibility component does not reference its network identity')
    owner_table = n.q(owner)
    owner_record = {'object': owner, 'unitOffset': owner-unit, 'vtableRva': owner_table-n.base,
        'callback48Rva': n.q(owner_table+0x48)-n.base, 'callback50Rva': n.q(owner_table+0x50)-n.base,
        'networkReferenceUnitOffset': reference-unit}
    # Register the existing constructed component under an explicitly supplied
    # network field using its original independent constructor insertion block.
    samples = fixture.read(fixture.cache / 'research/target-visibility-inputs.json')
    objects = fixture.read(fixture.cache / 'research/target-visibility-objects-native.json')
    if objects['decoderImageSha256'] != sha(n.image):
        raise ValueError('Target visibility native packet image differs')
    chosen = next(iter(objects['observations'].values()))
    first_packet = bytes.fromhex(chosen['object'])
    key = int.from_bytes(first_packet[0xc:0x10], 'little')
    if n.q(n.base+0x246c960):
        raise ValueError('Original target visibility registry must be cold')
    n.call(0x66a140, {}, 0x66a16d)
    if n.allocations.get(n.q(n.base+0x246c960)) != 0x20:
        raise ValueError('Original visibility registry construction differs')
    n.put(reference, 'I', key)
    n.call(0x21b103, {r.UC_X86_REG_RBX: unit+0x1e0, r.UC_X86_REG_RSI: reference,
                     r.UC_X86_REG_RSP: 0x10010000}, 0x21b19c)
    packet = n.allocate(0x30)
    setter_controls = []
    for sample_key, observation in list(objects['observations'].items())[:10]:
        if observation['status'] != 'complete' or observation['opcode'] != 822:
            raise ValueError('Original complete opcode822 objects required')
        data = bytes.fromhex(observation['object'])
        n.u.mem_write(packet, data)
        identity = int.from_bytes(data[0xc:0x10], 'little')
        n.put(unit+0x201, 'B', 0)
        status = fixture.run_to(0x21b710, 0x21b75e,
            {r.UC_X86_REG_RDI: packet+0x10, r.UC_X86_REG_RSI: identity}, allow_return=True)
        after = bytes(n.u.mem_read(unit+0x201,1))[0]
        if after != int(identity == key) or (status == 'projection-boundary') != (identity == key):
            raise ValueError('Original opcode822 network-component lookup or initialization flag differs')
        setter_controls.append({'sampleKey': sample_key, 'requestedNetworkId': identity,
            'registeredNetworkId': key, 'afterByte201': after, 'status': status,
            'sourceTime': samples['packets'][sample_key]['time'],
            'sourceStream': samples['packets'][sample_key]['stream']})
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-ai-target-visibility-constructor-writes',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'writes': constructor_writes, 'setterWrites': writes, 'visibilityVtableRva': table-n.base,
        'unit': unit, 'ownerInterface': owner_record, 'setterControls': setter_controls,
        'virtual70Rva': n.q(table+0x70)-n.base,
        'defaultByte201': defaults['byte201'],
        'defaultByte208': defaults['byte208'],
        'defaultVisibilityObjectHex': bytes(n.u.mem_read(unit+0x1e0,0x90)).hex(),
        'scope': {'fullOriginalAiConstructor': True, 'allocationInitialFillA5': True,
                  'watchAllWritesOverlappingFields': True, 'originalComponentMapInsertionPrefix': True,
                  'originalPacketInitializationSetterPrefix': True, 'packetOwnerCallbacksExecuted': False,
                  'actualMatchVisibilityRecovered': False}}
    output = fixture.cache / 'research/target-visibility-writes-native.json'
    output.write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'output':str(output),'writes':writes,'vtable':hex(table-n.base),'ownerInterface':owner_record,
                     'setterControls':len(setter_controls),
                     'default201':report['defaultByte201'],'default208':report['defaultByte208']}))


if __name__ == '__main__': main()
