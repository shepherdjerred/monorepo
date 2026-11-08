"""Original provider-free bound-size producer and typed Flex scale leaf."""
import argparse
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from vfx_asset_native import NativeVfxAssets
from vfx_spawn_native import name_hash, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    n = NativeVfxAssets(args.cache/'public/decoder-16.21-macos', args.client)
    inputs = {}
    def read(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return json.loads(data)
    package = read(args.cache/'public/latest-world-descriptor-abi/package.json')
    path = args.cache/'research/world-descriptors-native.json'
    factory = read(path)
    if (inputs[str(path.resolve())] != package['observationSha256'] or
            factory['decoderImageSha256'] != sha(n.image) or
            not factory['scope']['completeOriginalDescriptorFactory']):
        raise ValueError('Pinned complete original provider-free factory required')
    defaults = []
    for case in factory['cases']:
        creation = case['creation']
        wrapper, obj = bytes.fromhex(creation['activatedWrapperHex']), bytes.fromhex(creation['objectHex'])
        parent = bytes.fromhex(creation['initialState']['parentHex'])
        record = {'wrapperBoundSizeHex': wrapper[0x224:0x228].hex(),
                  'objectBoundSizeHex': obj[0x100:0x104].hex(),
                  'parentBoundSizeHex': parent[0x1cc:0x1d0].hex()}
        if set(record.values()) != {'00000000'}:
            raise ValueError('Complete provider-free factory default size differs')
        defaults.append(record)
    flex_type = n.type_catalog['b13097f0']
    prop = next(p for p in flex_type['properties'] if p['hash'] == name_hash('scaleBirthScaleByBoundObjectSize'))
    if flex_type['size'] != 48 or prop['offset'] != 4 or prop['type'] != 10:
        raise ValueError('Typed Flex bound-size float layout differs')
    flex, parent, holder, definition, actor, emitter, frame = [n.allocate(size) for size in
        [48, 0x2c0, 0x40, 0x300, 0x120, 0x20, 0x600]]
    n.call(flex_type['constructRva'], {r.UC_X86_REG_RDI: flex})
    if bytes(n.u.mem_read(flex, 28)) != bytes(28):
        raise ValueError('Original Flex float defaults are not all zero')
    n.put(parent + 0x1d8, 'Q', holder)
    n.put(holder + 0x38, 'Q', definition)
    n.put(definition + 0x74, 'I', 0x7f7fffff)
    n.put(actor, 'QQ', parent, emitter)
    n.put(emitter + 0x10, 'Q', definition)
    n.put(definition + 0x258, 'Q', flex)
    controls = []
    for coefficient in [0.0, 0.005, 1.0, 100.0]:
        n.put(flex + 4, 'f', coefficient)
        for size in [0.0, 100.0, 200.0, 250.0, 500.0]:
            # Execute the complete original parent-bound-size operation; no
            # components exist in this isolated parent, so its loop is empty.
            n.u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack('<f', size), 'little'))
            n.call(0x1763fd0, {r.UC_X86_REG_RDI: parent,
                r.UC_X86_REG_XMM0: int.from_bytes(struct.pack('<f', size), 'little')})
            bound = struct.unpack('<f', n.u.mem_read(parent + 0x1cc, 4))[0]
            n.call(0x1759499, {r.UC_X86_REG_RBX: actor, r.UC_X86_REG_R14: parent,
                r.UC_X86_REG_RBP: frame + 0x500, r.UC_X86_REG_XMM3: 0}, 0x1759508)
            factor = struct.unpack('<f', n.u.mem_read(actor + 0xb0, 4))[0]
            scalar = struct.unpack('<f', struct.pack('<f', coefficient))[0]
            product = struct.unpack('<f', struct.pack('<f', scalar * bound))[0]
            expected = product if product > 0 else 1.0
            if factor != expected or (size == 0 and (bound != 0 or factor != 1)):
                raise ValueError('Original Flex scale leaf differs from verified float32 operation')
            controls.append({'coefficient': scalar, 'suppliedBoundSize': size,
                             'nativeParentBoundSize': bound, 'birthScaleFactor': factor})
    ranges = [(0x369748, 0x36976a), (0x36ad54, 0x36ade9),
              (0x36b090, 0x36b0a4), (0x1755dc0, 0x1755dd2),
              (0x1763fd0, 0x1764109), (0x1765ea9, 0x1765eba),
              (0x1759499, 0x1759508), (0x178e310, 0x178e360)]
    paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    output = args.cache/'research/flex-bound-size-native.json'
    result = {'schema': 1, 'kind': 'original-provider-free-flex-bound-size-leaf-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'typedFlex': flex_type,
              'boundScaleProperty': prop, 'completeFactoryDefaults': defaults,
              'controls': controls, 'inputs': inputs,
              'sources': {str(p.resolve()): sha(p.read_bytes()) for p in paths},
              'originalBlocks': list(n.blocks.values()),
              'sourceBlocks': [{'rva': a, 'size': z-a, 'sha256': sha(n.image[a:z])} for a,z in ranges],
              'scope': {'originalTypedFlexConstructor': True, 'pinnedCompleteFactoryDefaults': True,
                        'originalBoundSizeSetterAndBirthScaleLeaf': True,
                        'providerFreeBoundSizeZeroEstablished': True,
                        'fullVisualDifferentialEstablished': False,
                        'nonzeroSourceProviderBoundSizeRecovered': False,
                        'runtimeAdmissionChanged': False}}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'factoryDefaults': len(defaults), 'controls': len(controls)}))


if __name__ == '__main__':
    main()
