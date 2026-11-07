"""Exercise the complete original texture mip count with a bounded libm ABI."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from character_script_native import NativeCharacterScripts
from libm_texture_native import NativeTextureLog2
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha


class Control(NativeTextureLog2, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    texture = n.allocate(0x110)
    n.u.mem_write(texture + 0x10, b'\xa5' * 0x100)
    cases = []
    for width, height in [(1, 1), (2, 1), (512, 1024), (1024, 512), (1023, 511),
                          (3, 5), (65535, 32768), (0, 65535)]:
        for mipmapped in [False, True]:
            n.put(texture + 4, 'HH', width, height)
            n.u.mem_write(texture + 0xb, bytes([int(mipmapped)]))
            n.call(0x1600480, {r.UC_X86_REG_RDI: texture})
            actual = n.u.reg_read(r.UC_X86_REG_RAX)
            expected = max(width, height).bit_length() if mipmapped else 1
            if actual != expected:
                raise ValueError('Original texture mip-level count disagrees with the integer dimension oracle')
            cases.append({'width': width, 'height': height, 'mipmapped': mipmapped, 'levels': actual})
    n.put(texture + 4, 'HH', 0, 0)
    n.u.mem_write(texture + 0xb, b'\x01')
    rejected_zero = False
    try:
        n.call(0x1600480, {r.UC_X86_REG_RDI: texture})
    except ValueError as error:
        if str(error) != 'Texture log2 caller or positive uint16 dimension differs':
            raise
        rejected_zero = True
    if not rejected_zero or bytes(n.u.mem_read(texture + 0x10, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Zero dimension rejection or texture-query allocation guard differs')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'cases': cases, 'zeroDimensionRejected': rejected_zero,
              'textureMathCalls': n.texture_math_calls, 'originalQueryRva': 0x1600480,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalTextureMipQuery': True, 'platformLibmSupplied': True,
                        'darwinLibmBitParityEstablished': False, 'actualTextureDecoded': False,
                        'mainViewerExpanded': False}}
    output = fixture.cache / 'research/native-texture-levels.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'zeroDimensionRejected': rejected_zero}))


if __name__ == '__main__':
    main()
