"""Verify late ABI continuations without making composite asset data executable."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from bounded_asset_arena_native import NativeBoundedAssetArena
from libcpp_concat_native import LibcppConcat, CONCAT, read_libcpp_string
from legacy_effect_native import NativeLegacyEffectInputs
from native_ai_unit_fixture import NativeAIUnitFixture
from native_callback_code import START, SIZE, STRIDE
from index_buffer_native import NativeIndexBuffers
from vfx_graphics_native import DEVICE
from vfx_spawn_native import sha


class Control(NativeBoundedAssetArena, NativeIndexBuffers, LibcppConcat, NativeLegacyEffectInputs):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    n.initialize_asset_arena(32)
    # Explicit allocator stress, not recovered game state: first continuation
    # must be created after normal allocations have reached non-executable data.
    n.next_heap = n.asset_arena['start']
    concat = next(at for at, name in n.source.imports.items() if name == CONCAT)
    cases = []
    for left, right in [(b'pre', b'fix'), (b'DATA/Characters/', b'Karthus/Skins/Skin10/Resources'),
                        (b'', b''), (b'prefix:', b'a\0b')]:
        source = n.allocate(len(right) + 1)
        n.u.mem_write(source, right + b'\0')
        rhs = n.allocate(24)
        n.call(0x11fe0, {r.UC_X86_REG_RDI: rhs, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: len(right)})
        prefix = n.allocate(len(left) + 1)
        n.u.mem_write(prefix, left + b'\0')
        result = n.allocate(24, 0xa5)
        n.call(concat, {r.UC_X86_REG_RDI: result, r.UC_X86_REG_RSI: prefix, r.UC_X86_REG_RDX: rhs})
        actual = read_libcpp_string(n, result)
        if (actual != left + right or n.u.reg_read(r.UC_X86_REG_RAX) != result or
                n.pending_cpp_concat is not None or not n.cpp_concat_calls[-1]['completed']):
            raise ValueError('Late concatenation lost bytes, sret result or continuation state')
        cases.append({'prefixHex': left.hex(), 'rightHex': right.hex(), 'resultHex': actual.hex()})
    if not START <= n.cpp_concat_return < START + SIZE:
        raise ValueError('Late continuation was allocated from ordinary data storage')
    # The once callback is a benign original type-descriptor getter. Its control
    # address is supplied original data; the ABI provider does not alter bytes.
    once = next(at for at, name in n.source.imports.items() if name == '_pthread_once')
    control = n.base + len(n.image) - 16
    control_bytes = bytes(n.u.mem_read(control, 16))
    once_calls = []
    n.u.hook_add(unicorn.UC_HOOK_CODE, lambda *_: once_calls.append(True),
                 begin=n.base + 0xea3b0, end=n.base + 0xea3b0)
    for _ in range(2):
        n.call(once, {r.UC_X86_REG_RDI: control, r.UC_X86_REG_RSI: n.base + 0xea3b0})
        if n.u.reg_read(r.UC_X86_REG_RAX) != 0 or not n.file_once[control]['complete']:
            raise ValueError('Once continuation lost completion or ABI result')
    if len(once_calls) != 1 or bytes(n.u.mem_read(control, 16)) != control_bytes:
        raise ValueError('Once callback repeated or altered its supplied control bytes')
    # Exercise the same index factory/return hooks with a byte-recording backend;
    # the CPU header itself is constructed by the original game constructor.
    class IndexBytes:
        def create_buffer(self, raw, flags):
            self.raw = raw
            return {'bytes': len(raw)}
    n.mesh_backend = IndexBytes()
    n.index_callbacks = {name: n.allocate_native_callback('index-buffer-' + name, handler)
                         for name, handler in [('create', n.index_buffer_create), ('return', n.index_buffer_return)]}
    n.pending_index_buffer, n.native_index_buffers = None, {}
    indices = bytes.fromhex('000001000200')
    index_source = n.allocate(len(indices))
    n.u.mem_write(index_source, indices)
    n.call(n.index_callbacks['create'] - n.base, {r.UC_X86_REG_RDI: DEVICE,
           r.UC_X86_REG_RSI: len(indices), r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: 0,
           r.UC_X86_REG_R8: index_source})
    header = n.u.reg_read(r.UC_X86_REG_RAX)
    if (n.mesh_backend.raw != indices or header not in n.native_index_buffers or
            n.pending_index_buffer is not None):
        raise ValueError('Late index-buffer continuations lost bytes or original header result')
    protection = lambda at: next(p for first, last, p in n.u.mem_regions() if first <= at <= last)
    if protection(START) != 5 or protection(n.asset_arena['start']) != 3:
        raise ValueError('Callback code must be RX and supplemental asset data must remain RW')
    # Existing original base-unit constructor attempts an immediate vtable write.
    # No handwritten guest algorithm is needed to test guest write protection.
    rejected = []
    data = n.allocate(16)
    n.u.mem_write(data, b'\xc3' + bytes(15))
    for label, error, entry, registers in [
        ('execute-data', unicorn.UC_ERR_FETCH_PROT, data - n.base, {}),
        ('write-code', unicorn.UC_ERR_WRITE_PROT, 0x5481e0, {r.UC_X86_REG_RDI: START})]:
        try:
            n.call(entry, registers)
        except unicorn.UcError as exc:
            if exc.errno != error:
                raise
            rejected.append(label)
        else:
            raise ValueError('Native code/data permission boundary admitted ' + label)
    observed = []
    def continuation(engine, address, length, user):
        observed.append({'address': address, 'stack': engine.reg_read(r.UC_X86_REG_RSP)})
        n.ret()
    before = n.next_heap
    address = n.allocate_native_callback('owned-return-control', continuation)
    n.call(address - n.base, {})
    if len(observed) != 1 or n.next_heap != before:
        raise ValueError('Owned continuation did not execute once independently of data allocation')
    while len(n.native_callback_code['entries']) < SIZE // STRIDE:
        n.allocate_native_callback('capacity-control', continuation)
    try:
        n.allocate_native_callback('overflow-control', continuation)
    except ValueError:
        rejected.append('callback-capacity')
    else:
        raise ValueError('Callback capacity did not fail explicitly')
    if n.next_heap != before or n.u.mem_read(START + 1, STRIDE - 1) != b'\xcc' * (STRIDE - 1):
        raise ValueError('Callback registration changed data allocation or unowned trap bytes')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    report = {'schema': 1, 'kind': 'late-native-abi-callback-code-control',
              'build': n.profile['clientVersion'], 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'cases': cases, 'rejectedBoundaries': rejected, 'callbackCode': n.native_callback_code,
              'assetArena': n.asset_arena, 'ownedReturnObservations': observed,
              'onceOriginalCallbackExecutions': len(once_calls),
              'indexBuffer': n.native_index_buffers[header],
              'scope': {'allocatorCursorSuppliedForStress': True, 'originalStringConstructorExecuted': True,
                        'indexBackendRecordsBytesOnly': True, 'gpuSubmissionObserved': False,
                        'assetDataExecutable': False, 'gameFunctionsReplaced': False, 'matchCoverage': False}}
    output = fixture.cache / 'research/native-callback-code.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'rejectedBoundaries': rejected,
                      'callbackEntries': len(n.native_callback_code['entries'])}))
    n.close_files()


if __name__ == '__main__':
    main()
