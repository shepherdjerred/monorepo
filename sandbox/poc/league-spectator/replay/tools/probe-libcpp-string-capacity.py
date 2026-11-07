"""Verify maximal shared string storage and atomic over-bound rejections."""
import argparse
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string
from libcpp_string_resize_native import RESIZE_RVA, RESERVE_RVA, INSERT_RVA
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

control_path = Path(__file__).with_name('probe-effect-callback-manager.py')
spec = importlib.util.spec_from_file_location('native_string_capacity_control', control_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, module.Control)
    n = fixture.native
    paths = {Path(__file__), control_path, Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(read_libcpp_string)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    obj = n.allocate(24)
    n.call(0x11fe0, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: n.allocate_text(''), r.UC_X86_REG_RDX: 0})
    n.call(RESIZE_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: 65535, r.UC_X86_REG_RDX: 0x61})
    if read_libcpp_string(n, obj) != b'a' * 65535 or n.q(obj) & ~1 != 65536:
        raise ValueError('Maximal string did not fit the shared reader/storage contract')
    before = bytes(n.u.mem_read(obj, 24)), read_libcpp_string(n, obj)
    source = n.allocate_text('z')
    rejections = []
    for entry, regs in [
        (RESIZE_RVA, {r.UC_X86_REG_RSI: 65536, r.UC_X86_REG_RDX: 0x62}),
        (RESERVE_RVA, {r.UC_X86_REG_RSI: 65536}),
        (INSERT_RVA, {r.UC_X86_REG_RSI: 65535, r.UC_X86_REG_RDX: source, r.UC_X86_REG_RCX: 1}),
    ]:
        try:
            n.call(entry, {r.UC_X86_REG_RDI: obj, **regs})
        except ValueError as error:
            rejections.append({'entryRva': entry, 'message': str(error)})
        else:
            raise ValueError('Oversized platform string operation was admitted')
        if (bytes(n.u.mem_read(obj, 24)), read_libcpp_string(n, obj)) != before:
            raise ValueError('Rejected platform operation changed its prior valid string')
    n.call(RESIZE_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: 65534, r.UC_X86_REG_RDX: 0})
    n.call(INSERT_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: 65534,
                        r.UC_X86_REG_RDX: source, r.UC_X86_REG_RCX: 1})
    if read_libcpp_string(n, obj) != b'a' * 65534 + b'z':
        raise ValueError('Insertion to the exact shared byte bound differs')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Capacity control source changed during execution')
    output = fixture.cache / 'research/libcpp-string-capacity-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'maximumStringBytes': 65535, 'maximumAllocatedBytes': 65536,
        'boundaryRejections': rejections, 'statePreservedOnEveryRejection': True,
        'exactBoundResizeAndInsertVerified': True, 'inputs': fixture.inputs, 'sources': sources,
        'originalBlocks': list(n.blocks.values()), 'scope': {'platformAbiOnly': True,
            'explicitStringInputs': True, 'nativeAllocationPolicyMatched': False,
            'gameWorldBootstrapped': False, 'acceptedReplayEntity': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'rejections': len(rejections), 'maximumStringBytes': 65535}))


if __name__ == '__main__':
    main()
