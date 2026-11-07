"""Exercise bounded CString append without bootstrapping a game world."""
import argparse
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string
from libcpp_string_append_native import APPEND_RVA
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

control_path = Path(__file__).with_name('probe-effect-callback-manager.py')
spec = importlib.util.spec_from_file_location('native_shared_string_control', control_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Control(module.Control):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    obj = n.allocate(24)
    n.call(0x11fe0, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: n.allocate_text('abc'), r.UC_X86_REG_RDX: 3})
    expected, controls = b'abc', []
    for text in [b'XYZ', b'', b'q' * 60, None, b'!\0ignored']:
        before = expected
        if text is None:
            source = n.q(obj + 16) if n.u.mem_read(obj, 1)[0] & 1 else obj + 1
            suffix = expected
        else:
            source = n.allocate(len(text) + 1)
            n.u.mem_write(source, text + b'\0')
            suffix = text.split(b'\0', 1)[0]
        expected += suffix
        n.call(APPEND_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: source})
        if read_libcpp_string(n, obj) != expected or n.u.reg_read(r.UC_X86_REG_RAX) != obj:
            raise ValueError('Standard CString append contents/terminator/reference differ')
        controls.append({'beforeHex': before.hex(), 'suffixHex': suffix.hex(), 'afterHex': expected.hex(),
                         'selfAppend': text is None, 'matched': True})
    paths = {Path(__file__), control_path, Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(read_libcpp_string)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    output = fixture.cache / 'research/libcpp-string-append-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'controls': controls, 'platformAppendCalls': n.libcpp_append_calls,
        'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'originalBlocks': list(n.blocks.values()), 'scope': {'platformAbiOnly': True,
            'explicitStringInputs': True, 'originalStringConstructorExecuted': True,
            'gameFunctionSubstituted': False, 'nativeAllocationPolicyMatched': False,
            'gameWorldBootstrapped': False, 'acceptedReplayEntity': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls)}))


if __name__ == '__main__':
    main()
