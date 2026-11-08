"""Check bounded span append, including embedded NUL and overlapping sources."""
import argparse
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string
from libcpp_string_span_append_native import NativeLibcppStringSpanAppend, SPAN_APPEND_RVA
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_span_append_dependencies', entry)
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
    paths = runtime.producer_paths(n) | {Path(__file__), Path(inspect.getfile(read_libcpp_string))}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    obj = n.allocate(24)
    n.call(0x11fe0, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: n.allocate_text('abc'), r.UC_X86_REG_RDX: 3})
    expected, controls = b'abc', []
    for value, amount in [(b'xyz', 2), (b'', 0), (b'q' * 60, 60), (None, 11), (b'!\0tail', 6)]:
        before = expected
        if value is None:
            source = n.q(obj + 16) if n.u.mem_read(obj, 1)[0] & 1 else obj + 1
            suffix = before[:amount]
        else:
            source = n.allocate(len(value) + 1)
            n.u.mem_write(source, value + b'\0')
            suffix = value[:amount]
        n.call(SPAN_APPEND_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: amount})
        expected += suffix
        if n.u.reg_read(r.UC_X86_REG_RAX) != obj or read_libcpp_string(n, obj) != expected:
            raise ValueError('Span append length/bytes/terminator/reference control differs')
        controls.append({'beforeHex': before.hex(), 'suffixHex': suffix.hex(), 'afterHex': expected.hex(),
                         'selfOverlap': value is None, 'matched': True})
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Span append source changed during execution: ' + path)
    output = fixture.cache / 'research/libcpp-string-span-append-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'controls': controls,
        'platformCalls': n.libcpp_span_append_calls, 'inputs': fixture.inputs, 'sources': sources,
        'scope': {'platformAbiOnly': True, 'originalStringConstructorExecuted': True,
                  'nativeAllocationPolicyMatched': False, 'gameWorldBootstrapped': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls)}))


if __name__ == '__main__':
    main()
