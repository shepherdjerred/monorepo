"""Original typed MapContainer bounds through the actual FoW uniform leaf.

The source omits its minimum: the actual typed constructor supplies that value.
The real provider construction and bounds-copy entry execute, stopping before
component processing. This proves numeric inputs, never a ready live map.
"""
import argparse
import inspect
import json
import struct
import sys
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_asset_native import REGISTRY
from vfx_spawn_native import ADDRESSES, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['package', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh original Map11 FoW proof required')
    request_bytes = args.input.read_bytes()
    request = json.loads(request_bytes)
    if (request['kind'] != 'original-map11-fow-bound-field-input' or request['schema'] != 1 or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['object'] != {'pathHash': '09e8f830', 'classHash': 'dde8c114'} or request['minimumAuthored'] is not False or
            request['fieldIdentities'] != {'minimum': 'b14297a4', 'maximum': 'bf563566'}):
        raise ValueError('Exact original Map11 bound-field input required')
    inputs = {str(args.input.resolve()): sha(request_bytes)}
    tools = Path(__file__).resolve().parent
    paths = {Path(__file__), *[Path(inspect.getfile(base)) for base in NativeCharacterAssets.__mro__ if base is not object]}
    paths.update(Path(module.__file__) for module in tuple(sys.modules.values())
                 if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
                 and Path(module.__file__).resolve().is_relative_to(tools))
    for path in paths | {args.package/'profile.json', args.package/'image.bin', args.client}:
        inputs[str(path.resolve())] = sha(path.read_bytes())
    for file, digest in request['inputs'].items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Original field producer/source changed: '+file)
        inputs[str(Path(file).resolve())] = digest
    raw = Path(request['source']['file']).read_bytes()
    if len(raw) != request['source']['bytes'] or sha(raw) != request['source']['sha256']:
        raise ValueError('Original bounds BIN differs')
    n = NativeCharacterAssets(args.package, args.client)
    n.initialize_character_types()
    for start, end in [(0x6994c0, None), (0x224a19, 0x224a25), (0x333270, None)]:
        n.call(start, {}, end)
    count, array = n.u32(n.base+REGISTRY+8), n.q(n.base+REGISTRY)
    if not 1887 <= count <= 4096:
        raise ValueError('Bounded original Map reflection registry required')
    previous = dict(n.types)
    n.types = {n.u32(n.q(array+index*8)+8): n.q(array+index*8) for index in range(count)}
    if len(n.types) != count or any(n.types.get(key) != value for key, value in previous.items()):
        raise ValueError('Map type registration changed existing identities')
    n.type_catalog = n.catalog()
    descriptor = n.type_catalog['dde8c114']
    fields = {field['hash']: field for field in descriptor['properties']}
    for identity, offset in [(0xb14297a4, 0x20), (0xbf563566, 0x28)]:
        if (fields[identity]['offset'], fields[identity]['type']) != (offset, 11):
            raise ValueError('Original MapContainer Vec2 layout differs')
    serialized = []
    for span in request['fields']:
        data = raw[span['offset']:span['offset']+span['bytes']]
        if (span['fieldHash'] != 'bf563566' or len(data) != span['bytes'] or sha(data) != span['sha256'] or
                int.from_bytes(data[:4], 'little') != 0xbf563566):
            raise ValueError('Exact original authored max field required')
        serialized.append(data)
    if len(serialized) != 1:
        raise ValueError('One actual max field and constructor-default minimum required')
    observed = n.observe_actor_fields(0xdde8c114, serialized)
    if observed['originalSkippedFields'] or observed['pendingReferences']:
        raise ValueError('Original bound fields did not load completely')
    asset = observed['object']
    expected_max = struct.pack('<2f', request['authoredMaximum']['X'], request['authoredMaximum']['Y'])
    if bytes(n.u.mem_read(asset+0x20, 8)) != bytes(8) or bytes(n.u.mem_read(asset+0x28, 8)) != expected_max:
        raise ValueError('Original typed default minimum/authored maximum differ')
    if n.q(n.base+0x247c680):
        raise ValueError('Original MapContainer provider must be cold')
    n.call(0x66a87c, {}, 0x66a8da)
    provider = n.q(n.base+0x247c680)
    if n.allocations.get(provider) != 0x90 or n.u32(provider+0x10):
        raise ValueError('Original provider construction/default component count differs')
    n.call(0x160dfe0, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: asset}, 0x160e015)
    if bytes(n.u.mem_read(provider+0x58, 16)) != bytes(n.u.mem_read(asset+0x20, 16)):
        raise ValueError('Original provider bounds copy differs')
    n.call(0x6108d0, {r.UC_X86_REG_RDI: 0}, 0x610953)
    extents = bytes(n.u.mem_read(n.base+0x25699d0, 12))
    expected_extents = struct.pack('<3f', *[request['authoredMaximum']['X'], 0, request['authoredMaximum']['Y']])
    if extents != expected_extents:
        raise ValueError('Both original published map extent axes differ')
    extent = struct.unpack_from('<f', extents)[0]
    # Only the complete scalar/header/array initialization prefix is needed
    # here. World-event subscription and a ready FoW owner remain unadmitted.
    cpu = n.allocate(0x80)
    n.call(0x21c910, {r.UC_X86_REG_RDI: cpu, r.UC_X86_REG_RSI: 4,
                      r.UC_X86_REG_XMM0: int.from_bytes(extents[:4], 'little')}, 0x21c9e1)
    if bytes(n.u.mem_read(cpu+0x18, 4)) != extents[:4]:
        raise ValueError('Original CPU FoW constructor extent copy differs')
    frame = ADDRESSES['stack']-8
    n.call(0x21c22c, {r.UC_X86_REG_RAX: cpu, r.UC_X86_REG_RBP: frame}, 0x21c252)
    uniform = bytes(n.u.mem_read(frame-0x20, 16))
    inverse = struct.unpack('<f', struct.pack('<f', 1/extent))[0]
    if uniform != struct.pack('<4f', inverse, -inverse, 0, 1):
        raise ValueError('Original raw FoW uniform bytes differ')
    for file, digest in inputs.items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('FoW source/input changed: '+file)
    ranges = [(0x66a87c, 0x66a8da), (0x160dfe0, 0x160e015), (0x6108d0, 0x610953),
              (0x21c910, 0x21c9e1), (0x21c22c, 0x21c252)]
    result = {'schema': 1, 'kind': 'original-map11-fow-extent-uniform-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputSha256': sha(request_bytes),
              'sourceBinSha256': sha(raw), 'classDescriptor': descriptor, 'loaded': observed,
              'providerBoundsHex': bytes(n.u.mem_read(provider+0x58, 16)).hex(),
              'publishedExtentHex': extents.hex(), 'publishedExtentXYZ': list(struct.unpack('<3f', extents)),
              'uniformHex': uniform.hex(), 'uniform': list(struct.unpack('<4f', uniform)), 'inputs': inputs,
              'sourceBlocks': [{'rva': start, 'bytes': end-start, 'sha256': sha(n.image[start:end])} for start, end in ranges],
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalTypedBoundFieldsAndConstructorDefaults': True,
                        'originalProviderConstructionAndBoundCopy': True, 'bothPublishedExtentAxesComparedAsRawBytes': True,
                        'actualMap11ExtentRecovered': True, 'originalUniformLeafExecuted': True,
                        'cpuResolutionSuppliedDiagnosticOnly': 4, 'cpuFowConstructorPrefixOnly': True,
                        'componentLoopExecuted': False, 'completeMapBootstrapExecuted': False,
                        'dynamicTeamFogProduced': False, 'nativeSpectatorAdmitted': False}}
    args.output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'extent': result['publishedExtentXYZ'], 'uniformHex': result['uniformHex']}))


if __name__ == '__main__':
    main()
