"""Observe original missing texture/sampler selection without GPU substitutes.

The reflection names are explicit supplied inputs, as in the existing constant
packing oracle. This does not execute original Metal shader reflection or draws.
"""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from native_pipeline_description import NativePipelineDescription
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    n = NativePipelineDescription(cache / 'public/decoder-16.21-macos', args.client)
    rows = []
    try:
        for supplied in [[], ['Diffuse_Texture', 'Mask_Texture'], ['OtherTexture']]:
            for kind, entry, offset in [('texture', 0x191fad0, 0x30), ('sampler', 0x191fcb0, 0x40)]:
                n.load_system([])
                request = n.allocate(64)
                values = n.allocate(max(1, 40 * len(supplied)))
                n.put(request + 16, 'QII', values, len(supplied), len(supplied))
                for i, name in enumerate(supplied):
                    n.put(values + i * 40, 'Q', n.string(name))
                    # No selected texture is dereferenced: a match here must
                    # fail instead of passing a pretend GPU resource.
                    n.put(values + i * 40 + 8, 'Q', 0xa5a5a5a5a5a5a5a5)
                name = 'TransitionDestTexture'
                wrapper = n.allocate(16)
                n.put(wrapper, 'QII', n.string(name), len(name), len(name) + 1)
                n.call(0x1499ab0, {r.UC_X86_REG_RDI: wrapper})
                identity = n.u.reg_read(r.UC_X86_REG_EAX)
                reflection = n.allocate(0x80)
                field = n.allocate(8)
                n.put(field, 'II', identity, 7)
                n.put(reflection + offset, 'QII', field, 1, 1)
                result = n.allocate(16)
                owner = n.allocate(0x28)
                n.call(entry, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: request,
                               r.UC_X86_REG_RDX: reflection, r.UC_X86_REG_RCX: result})
                pointer, count, capacity = n.q(result), n.u32(result + 8), n.u32(result + 12)
                if count != 1 or capacity < 1:
                    raise ValueError('Original missing binding did not retain its reflected slot')
                actual = bytes(n.u.mem_read(pointer, 16))
                if actual != bytes.fromhex('00000000000000000700000000000000'):
                    raise ValueError('Original missing binding was not a null resource with its original slot')
                rows.append({'kind': kind, 'entryRva': entry, 'reflectionName': name,
                             'suppliedTextureNames': supplied, 'slot': 7, 'resource': 0,
                             'bytesHex': actual.hex(), 'originalCallReturned': True})
        paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
        result = {'schema': 1, 'kind': 'original-material-absent-texture-selection',
                  'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
                  'decoderImageSha256': sha(n.image), 'cases': rows,
                  'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                  'originalBlocks': list(n.blocks.values()),
                  'scope': {'originalSelectionExecuted': True, 'suppliedReflection': True,
                            'originalMetalReflection': False, 'gpuSubstitutesBound': False,
                            'drawReady': False, 'matchCoverage': False}}
        output = cache / 'research/material-texture-absence-native.json'
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(output), 'cases': len(rows), 'mismatches': 0}))
    finally:
        n.close_files() if hasattr(n, 'close_files') else None


if __name__ == '__main__':
    main()
