"""Original individual mesh caller's two-float COLOR_LOOKUP_UV packing."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('cache', type=Path)
    args = p.parse_args(); cache = args.cache.resolve(); inputs = {}
    sha = lambda b: hashlib.sha256(b).hexdigest()
    def raw(path):
        data = path.read_bytes(); key = str(path.resolve()); digest = sha(data)
        if key in inputs and inputs[key] != digest: raise ValueError('Mesh lookup input drift')
        inputs[key] = digest; return data
    def read(path): return json.loads(raw(path))
    raw(Path(__file__))
    profile = read(cache / 'public/decoder-16.21-macos/profile.json')
    image = raw(cache / 'public/decoder-16.21-macos/image.bin')
    native = read(cache / 'research/direct-mesh-record-native.json')
    if sha(image) != profile['decoderImageSha256'] or native['decoderImageSha256'] != sha(image) or native['kind'] != 'original-static-mesh-cpu-record-controls':
        raise ValueError('Exact original mesh record fixture required')
    for path, digest in native['inputs'].items():
        if sha(raw(Path(path))) != digest: raise ValueError('Stale original mesh record input')
    u = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64); base = profile['imageBase']
    u.mem_map(base, len(image)); u.mem_write(base, image)
    arena = 0x10000000; u.mem_map(arena, 0x10000)
    attributes, frame = arena + 0x1000, arena + 0x2000
    cases = []
    for case in native['cases']:
        frames = []
        for tick, record in enumerate(case['frames']):
            attrs = record['output']['state']['vectors']['attributes']
            packed = bytes.fromhex(attrs['hex'])
            if len(packed) != attrs['count'] * 44: raise ValueError('Original attribute pool malformed')
            outputs = []
            for index in range(attrs['count']):
                u.mem_write(attributes, packed); u.mem_write(frame-0x330, b'\xa5' * 16)
                u.mem_write(frame-0x60, struct.pack('<Q', (index+1)*44))
                u.reg_write(r.UC_X86_REG_RBP, frame); u.reg_write(r.UC_X86_REG_R13, attributes)
                u.emu_start(base+0x173e556, base+0x173e568, count=4)
                if u.reg_read(r.UC_X86_REG_RIP) != base+0x173e568: raise ValueError('Original lookup instruction bound')
                outputs.append(bytes(u.mem_read(frame-0x330, 16)).hex())
            frames.append({'tick': tick, 'lookupHex': outputs})
        cases.append({'seedHex': case['seedHex'], 'pose': case['pose'], 'uvMode': case['uvMode'], 'frames': frames})
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest: raise ValueError('Final mesh lookup input drift')
    report = {'schema': 1, 'kind': 'original-individual-mesh-color-lookup-packing',
        'build': native['build'], 'protocol': native['protocol'], 'inputs': inputs,
        'originalBlock': {'rva': 0x173e556, 'size': 0x12, 'sha256': sha(image[0x173e556:0x173e568])},
        'cases': cases, 'scope': {'originalAttributePoolInputs': True, 'originalCallerPackingExecuted': True,
            'materialSetterOrGpuExecuted': False, 'nativeWorldAcceptance': False}}
    output = cache / 'research/direct-mesh-lookup-native.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases)}))


if __name__ == '__main__': main()
