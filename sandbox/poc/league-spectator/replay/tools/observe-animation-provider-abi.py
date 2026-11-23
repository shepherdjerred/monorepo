"""Bind authored provider class identities to original native update methods.

MoveSpeed sentinels and an empty cold buff-manager control are ABI observations,
not recorded game values or proof of a live Homeguard provider.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from animation_provider_native import create_animation_provider_fixture, construct_animation_hero
import animation_provider_native as provider_module
from vfx_spawn_native import sha, name_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'snapshot_bindings', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    files = {Path(__file__)}
    for value in vars(provider_module).values():
        if inspect.isfunction(value) or inspect.isclass(value):
            candidate = Path(inspect.getfile(value)).resolve()
            if candidate.parent == root:
                files.add(candidate)
    for klass in provider_module.NativeAnimationProvider.__mro__:
        if klass is not object:
            files.add(Path(inspect.getfile(klass)))
    sources = {str(file.resolve()): sha(file.read_bytes()) for file in files}
    bindings_bytes = args.snapshot_bindings.read_bytes()
    fixture = create_animation_provider_fixture(args.cache, args.client, json.loads(bindings_bytes))
    n = fixture.native
    unit = construct_animation_hero(fixture)
    output = n.allocate(16)
    results = []
    for name, updater in [('MoveSpeedParametricUpdater', 0x1176f0), ('IsHomeguardParametricUpdater', 0x1188e0)]:
        identity = name_hash(name)
        descriptor = n.types.get(identity)
        if descriptor is None:
            raise ValueError('Original authored provider type is absent: '+name)
        size = n.q(descriptor+0x40)
        constructor = n.q(descriptor+0x20)
        if not 8 <= size <= 128 or not n.base <= constructor < n.base+len(n.image):
            raise ValueError('Original authored provider constructor/extent differs')
        data = n.allocate(size+16)
        n.u.mem_write(data+size, b'\xa5'*16)
        n.call(constructor-n.base, {r.UC_X86_REG_RDI: data})
        table = n.q(data)
        n.call(n.q(table+0x10)-n.base, {r.UC_X86_REG_RDI: data})
        if n.u.reg_read(r.UC_X86_REG_RAX) != descriptor or n.q(table+0x28) != n.base+updater:
            raise ValueError('Original provider RTTI/update virtual does not match authored class')
        probes = []
        values = [-0.0, 1.0, 345.0, 380.0, 400.5] if name.startswith('MoveSpeed') else [None]
        for value in values:
            if value is not None:
                n.put(unit+0xf9c, 'f', value)
            elif n.q(unit+0x25b8+0x18) != n.q(unit+0x25b8+0x20):
                raise ValueError('Cold original buff manager is not empty')
            n.put(output+8, 'I', 0x7fc00000)
            n.call(updater, {r.UC_X86_REG_RDI: data, r.UC_X86_REG_RSI: unit+8, r.UC_X86_REG_RDX: output})
            bits = n.u32(output+8)
            expected = struct.unpack('<I', struct.pack('<f', value))[0] if value is not None else 0
            if bits != expected or bytes(n.u.mem_read(data+size, 16)) != b'\xa5'*16:
                raise ValueError('Original provider ABI scalar/extent differs')
            probes.append({'sentinelValue': value, 'bits': bits})
        results.append({'name': name, 'classHash': identity, 'descriptorRva': descriptor-n.base,
                        'objectBytes': size, 'constructorRva': constructor-n.base,
                        'vtableRva': table-n.base, 'updateSlot': 0x28, 'updaterRva': updater, 'probes': probes})
    for file, digest in sources.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Provider ABI source changed during observation: '+file)
    for file, digest in fixture.inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Provider ABI input changed during observation: '+file)
    args.output.write_text(json.dumps({'schema': 1, 'kind': 'original-authored-animation-provider-abi',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
        'snapshotBindingsSha256': sha(bindings_bytes),
        'sources': sources,
        'providers': results, 'originalBlocks': list(n.blocks.values()),
        'scope': {'originalTypedProviderConstructorsExecuted': True,
                  'originalCompleteUpdateMethodsExecuted': True,
                  'homeguardObservation': 'empty-cold-buff-storage-only',
                  'liveBuffStorageOrProviderEstablished': False,
                  'nativeFrameSchedulingEstablished': False, 'nativeGraphInputsAdmitted': False}}, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'providers': len(results), 'probes': sum(len(row['probes']) for row in results),
                      'homeguard': 'empty-cold-control-only'}))


if __name__ == '__main__':
    main()
