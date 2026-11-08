"""Check explicit random_device lifecycle, unsigned samples and exhaustion."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from random_device_native import NativeRandomDeviceInputs
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_random_device_dependencies', entry)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class Control(runtime.Control):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    paths = runtime.producer_paths(n) | {Path(__file__)}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    words = [0, 1, 0x80000000, 0xffffffff]
    policy = n.configure_random_device_inputs('supplied-uint32-control', words)
    token, obj = n.allocate(24), n.allocate(4)
    n.call(0x11fe0, {r.UC_X86_REG_RDI: token, r.UC_X86_REG_RSI: n.allocate_text('/dev/urandom'), r.UC_X86_REG_RDX: 12})
    n.call(0x1fee456, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: token})
    for word in words:
        n.call(0x1fee462, {r.UC_X86_REG_RDI: obj})
        if n.u.reg_read(r.UC_X86_REG_RAX) != word:
            raise ValueError('Unsigned platform entropy sample differs')
    rejections = 0
    try:
        n.call(0x1fee462, {r.UC_X86_REG_RDI: obj})
    except ValueError:
        rejections += 1
    n.call(0x1fee45c, {r.UC_X86_REG_RDI: obj})
    try:
        n.call(0x1fee462, {r.UC_X86_REG_RDI: obj})
    except ValueError:
        rejections += 1
    if rejections != 2 or n.random_device_cursor != 4:
        raise ValueError('Entropy transcript exhaustion/lifecycle guard differs')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Entropy provider source changed during execution: ' + path)
    output = fixture.cache / 'research/random-device-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'policy': policy, 'samples': words, 'boundaryRejections': rejections, 'calls': n.random_device_calls,
        'sources': sources, 'inputs': fixture.inputs, 'scope': {'platformAbiOnly': True, 'replaySeedRecovered': False,
            'nativeEntropySourceMatched': False, 'gameFunctionSubstituted': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'samples': len(words), 'boundaryRejections': rejections}))


if __name__ == '__main__':
    main()
