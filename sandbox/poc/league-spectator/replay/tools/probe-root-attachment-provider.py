"""Original key-zero root-position leaf and source-matrix predicate controls.

The animation-component owner field view is supplied, not selected by the full
provider factory. No match transform, concrete Hero getter or attachment is
admitted by this proof.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path

from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from game_mode_data_native import NativeGameModeData
from libcpp_shared_native import NativeLibcppSharedOwnership
from vfx_spawn_native import sha


class NativeProviderLifecycle(NativeLibcppSharedOwnership, NativeGameModeData):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, native_class=NativeProviderLifecycle)
    n = fixture.native
    unit = fixture.construct_ai()
    component, output = n.allocate(0x20), n.allocate(0x20)
    n.put(component + 0x18, 'Q', unit)
    provider = n.allocate(0x30)
    n.call(0x54ced0, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: unit})
    if n.q(provider) != n.base + 0x2336698 or n.q(n.q(unit) + 0x68) != n.base + 0xd14f0:
        raise ValueError('Original AI-base provider/root getter differs')
    position_cases = []
    for position in [[0.0, -0.0, 0.0], [123.125, -91.75, 8024.5],
                     [1 / 3, -1 / 7, 16777217], [-3.4028234e38, 1.17549435e-38, -1e-40]]:
        expected = struct.pack('<3f', *position)
        n.u.mem_write(unit + 0x15c, expected)
        n.u.mem_write(output, b'\xa5' * 0x20)
        # Original full leaf, key zero jumps over every rig/bone lookup.
        n.call(0x76f720, {r.UC_X86_REG_RDI: component, r.UC_X86_REG_RSI: 0,
                           r.UC_X86_REG_RDX: output})
        leaf = bytes(n.u.mem_read(output, 12))
        if leaf != expected or bytes(n.u.mem_read(output + 12, 20)) != b'\xa5' * 20:
            raise ValueError('Original root position leaf differs or escaped its output')
        n.call(0x54de50, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: output})
        if n.u.reg_read(r.UC_X86_REG_RAX) & 255 != 1 or bytes(n.u.mem_read(output, 12)) != expected:
            raise ValueError('Original base entity position provider differs')
        position_cases.append({'suppliedPosition': position, 'outputHex': leaf.hex(),
                               'output': list(struct.unpack('<3f', leaf))})
    wrapper, obj, frame = n.allocate(0x200), n.allocate(0x200), n.allocate(0x200)
    n.put(wrapper + 0x178, 'Q', obj)
    flag_cases = []
    for initial in [0, 0x4000]:
        for mask in range(32):
            n.put(obj + 0x60, 'I', initial)
            n.call(0x367f70, {r.UC_X86_REG_RDI: wrapper, r.UC_X86_REG_RSI: mask})
            actual = n.u32(obj + 0x60)
            expected = initial | (mask & 2) | ((mask << 4) & 0x10) | ((mask & 4) << 3) | ((mask & 0x18) << 5)
            if actual != expected:
                raise ValueError('Original wrapper-to-object flag mapping differs')
            required = actual & 0x30 == 0x10
            endpoint = 0x17665ed if required else 0x176664d
            n.call(0x17665d6, {r.UC_X86_REG_RBP: frame + 0x100, r.UC_X86_REG_RBX: obj}, endpoint)
            if bytes(n.u.mem_read(frame + 0x50, 64)) != struct.pack('<16f', 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1):
                raise ValueError('Original temporary source matrix is not identity')
            flag_cases.append({'wrapperFlags': mask, 'initialObjectFlags': initial,
                               'objectFlags': actual, 'requiresSourceMatrix': required,
                               'originalStopRva': endpoint})
    fixture.check_guard(unit)
    ranges = [(0x367f70, 0x367fce), (0x1755cf0, 0x1755cfd),
              (0x1766576, 0x1766605), (0x76f720, 0x76f86a),
              (0xd14f0, 0xd14f5), (0x54de50, 0x54dee2),
              (0x111160, 0x1111b6), (0x76f870, 0x76f9b0)]
    sources = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
               Path(inspect.getfile(NativeProviderLifecycle)),
               *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'original-root-attachment-provider-leaf-controls',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'positionCases': position_cases,
              'flagCases': flag_cases, 'inputs': fixture.inputs,
              'sources': {str(p.resolve()): sha(p.read_bytes()) for p in sorted(sources)},
              'sourceBlocks': [{'rva': a, 'size': b-a, 'sha256': sha(n.image[a:b])} for a, b in ranges],
              'scope': {'originalAiBaseConstructorAndOwnership': True,
                        'suppliedAnimationComponentOwnerFieldView': True,
                        'originalKeyZeroPositionLeafExecuted': True,
                        'originalBasePositionProviderExecuted': True,
                        'originalWrapperFlagSetterExecuted': True,
                        'originalSourceMatrixPredicateExecuted': True,
                        'originalProviderMatrixCallbackExecuted': False,
                        'concreteHeroRootPositionEstablished': False,
                        'providerFactorySelectionEstablished': False,
                        'matchAttachmentsResolved': False, 'compilerAdmissionChanged': False}}
    path = fixture.cache / 'research/root-attachment-provider-native.json'
    path.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(path), 'positionCases': len(position_cases), 'flagCases': len(flag_cases)}))


if __name__ == '__main__':
    main()
