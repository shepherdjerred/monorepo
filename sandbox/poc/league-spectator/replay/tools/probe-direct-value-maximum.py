"""Original typed singleton ValueFloat postload, virtual maximum and link timers.

The maximum is resource metadata, not a probability-composed sample bound.
No resource cache, parent creation, removal acceptance or geometry is claimed.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_postload_native import NativeVfxPostload
from vfx_asset_native import OBJECT
from vfx_spawn_native import sha, name_hash


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path); p.add_argument('client', type=Path)
    args = p.parse_args(); cache = args.cache.resolve(); decoder = cache / 'public/decoder-16.21-macos'
    inputs, sources = {}, {}
    def raw(path):
        data = path.read_bytes(); key = str(path.resolve()); digest = sha(data)
        if key in inputs and inputs[key] != digest: raise ValueError('Input changed during capture')
        inputs[key] = digest; return data
    def read(path): return json.loads(raw(path))
    for cls in NativeVfxPostload.__mro__:
        if cls is not object:
            path = Path(inspect.getfile(cls)); sources[str(path.resolve())] = sha(path.read_bytes())
    sources[str(Path(__file__).resolve())] = sha(Path(__file__).read_bytes())
    for filename in ['profile.json', 'image.bin', 'vfx-assets.json']: raw(decoder / filename)
    manifest = read(cache / 'public/latest-effects/manifest.json')
    inventory = read(decoder / 'vfx-assets.json')
    n = NativeVfxPostload(decoder, args.client)
    if inputs[str((decoder / 'vfx-assets.json').resolve())] != n.profile['vfxAssetsSha256'] or inventory['effectsManifestSha256'] != inputs[str((cache / 'public/latest-effects/manifest.json').resolve())]:
        raise ValueError('Exact original field inventory required')
    prop = next(x for x in n.type_catalog['09cde442']['properties'] if x['hash'] == name_hash('particleLifetime'))
    if (prop['offset'], prop['type'], prop['mask']) != (0xf8, 131, 0): raise ValueError('Lifetime property changed')
    f = lambda v: struct.unpack('<f', struct.pack('<f', v))[0]
    def scalar(at): return struct.unpack('<f', n.u.mem_read(at, 4))[0]
    def maximum(pointer):
        vtable = n.q(pointer); target = n.q(vtable + 0x30) - n.base
        if target != 0x16d7d90: raise ValueError('Unproven maximum virtual target')
        n.call(target, {r.UC_X86_REG_RDI: pointer})
        return struct.unpack('<f', struct.pack('<I', n.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
    cases, controls = [], []
    for index in [0, 2, 3]:
        identity = 'champions/karthus/10/ce863744'; ref = manifest['definitions'][identity]
        definition_raw = raw(cache / 'public/latest-effects' / ref['file'])
        meta = inventory['emitters'][f'{identity}:{index}']
        if sha(definition_raw) != ref['sha256'] or sha(definition_raw) != meta['definitionSha256']: raise ValueError('Source definition changed')
        source = json.loads(definition_raw)['definition']['complexEmitterDefinitionData'][index]
        blob = raw(cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob) != meta['rawSourceSha256']: raise ValueError('Original BIN changed')
        fields = []
        for field in meta['fields']:
            encoded = blob[field['offset']:field['offset'] + field['bytes']]
            if sha(encoded) != field['sha256']: raise ValueError('Original field span changed')
            fields.append(encoded)
        before = n.load(fields); after = n.postload()
        if before['ignored'] or before['mismatched'] or after['pendingLinkFixups'] or after['mathCalls']: raise ValueError('Unresolved original field/postload')
        pointer = n.q(OBJECT + 0x100)
        if not pointer or n.u32(pointer + 0x18) != 1 or n.u32(pointer + 0x28) != 1: raise ValueError('Singleton loaded resource required')
        resource = bytes(n.u.mem_read(pointer, 0x50))
        result = maximum(pointer)
        link = n.allocate(0xa0); n.put(link + 0x10, 'Q', OBJECT)
        n.call(0x16e1742, {r.UC_X86_REG_RDI: link, r.UC_X86_REG_R15: link}, 0x16e17e6)
        cases.append({'effectId': identity, 'emitterIndex': index, 'source': source['particleLifetime'],
            'fieldRegistration': prop, 'resourceHex': resource.hex(), 'virtualMaximum': result,
            'linkTimers': [scalar(link + 0x90), scalar(link + 0x94)],
            'sourceLifetime': scalar(OBJECT + 0x108), 'particleLinger': scalar(OBJECT + 0x118),
            'emitterLinger': scalar(OBJECT + 0x11c), 'completeOriginalFieldOrderPreserved': True})
        if index == 0:
            # Original one-key postload branch with explicit owned scalar inputs.
            # Keep the actual original probability object in place; the entire
            # branch reads raw key0 and never dereferences its probability slot.
            times, values = n.q(pointer + 0x10), n.q(pointer + 0x20)
            for time in [-1, 0, .5, 1]:
                for value in [-4, -0.0, .125, 2, 4, 1e20]:
                    for wrapper in [-17, 99, 1e10]:
                        n.put(times, 'f', time); n.put(values, 'f', value)
                        n.put(OBJECT + 0xf8, 'f', wrapper)
                        n.call(0x16d7b00, {r.UC_X86_REG_RDI: pointer})
                        controls.append({'time': time, 'value': value, 'wrapperConstant': wrapper,
                            'maximum': maximum(pointer), 'cachedBits': bytes(n.u.mem_read(pointer + 0x38, 4)).hex()})
        n.restore_preload_arena()
    ranges = [(0x16d7b00, 0x16d7c23), (0x16d7d90, 0x16d7d9b), (0x16e1742, 0x16e17e6)]
    blocks = []
    for a, z in ranges:
        if n.image[a:z] != n.source.image[a:z]: raise ValueError('Original instruction bytes changed')
        blocks.append({'rva': a, 'size': z-a, 'sha256': sha(n.image[a:z])})
    for path, digest in {**inputs, **sources}.items():
        if sha(Path(path).read_bytes()) != digest: raise ValueError('Final maximum proof drift: ' + path)
    output = cache / 'research/direct-value-maximum-native.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'native-singleton-value-float-maximum',
        'build': manifest['build'], 'protocol': manifest['protocol'], 'inputs': inputs, 'sources': sources,
        'originalBlocks': blocks, 'cases': cases, 'controls': controls,
        'scope': {'completeAuthoredFieldReaderAndPostload': True, 'originalVirtualMaximum': True,
            'originalLinkTimerConsumer': True, 'probabilityComposedUpperBound': False,
            'multiKeyMaximumTranslated': False, 'nativeWorldAcceptance': False, 'renderedCoverage': False}}, indent=2), encoding='utf8')
    print(json.dumps({'output': str(output), 'authored': len(cases), 'controls': len(controls), 'maxima': [x['virtualMaximum'] for x in cases]}))


if __name__ == '__main__': main()
