"""Verify allocation/copy/ownership boundaries of the composite asset arena."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from bounded_asset_arena_native import NativeBoundedAssetArena
from native_ai_unit_fixture import NativeAIUnitFixture
from wad_file_native import NativeWadFiles
from vfx_spawn_native import sha


class Control(NativeBoundedAssetArena, NativeWadFiles):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    n.initialize_asset_arena(32)
    source = n.allocate(32)
    expected = bytes(range(32))
    n.u.mem_write(source, expected)
    # Explicit allocator stress input; no game object or readiness is changed.
    n.next_heap = 0x11fffff0
    destination = n.allocate(32, 0xa5)
    if destination != 0x12000000 or not n.library_pointer(destination, 32):
        raise ValueError('Composite allocation was not in the additional owned arena')
    n.call(0x1feea44, {r.UC_X86_REG_RDI: destination, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: 32})
    if bytes(n.u.mem_read(destination, 32)) != expected or n.u.reg_read(r.UC_X86_REG_RAX) != destination:
        raise ValueError('Composite copy did not preserve its source bytes/ABI result')
    if n.library_pointer(destination, 33) or n.writable_file_memory(destination + 32, 1):
        raise ValueError('Composite pointer validation admitted an unowned adjacent byte')
    zero_entry = next(at for at, name in n.source.imports.items() if name == '___bzero')
    n.call(zero_entry, {r.UC_X86_REG_RDI: destination + 8, r.UC_X86_REG_RSI: 12})
    if bytes(n.u.mem_read(destination, 32)) != expected[:8] + bytes(12) + expected[20:]:
        raise ValueError('Composite bzero did not preserve adjacent owned bytes')
    cleared = bytes(n.u.mem_read(destination, 32))
    n.call(0x1feea44, {r.UC_X86_REG_RDI: destination, r.UC_X86_REG_RSI: 0, r.UC_X86_REG_RDX: 0})
    if bytes(n.u.mem_read(destination, 32)) != cleared or n.u.reg_read(r.UC_X86_REG_RAX) != destination:
        raise ValueError('Zero-length native copy accessed bytes or changed its ABI result')
    pattern_entry = next(at for at, name in n.source.imports.items() if name == '_memset_pattern16')
    n.call(pattern_entry, {r.UC_X86_REG_RDI: destination + 2, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: 28})
    if bytes(n.u.mem_read(destination, 32)) != cleared[:2] + (expected[:16] * 2)[:28] + cleared[30:]:
        raise ValueError('Composite pattern fill changed its partial tail or neighboring bytes')
    failures = []
    for name, action in [('allocation-size', lambda: n.allocate(0x100000)),
                         ('copy-size', lambda: n.call(0x1feea44, {r.UC_X86_REG_RDI: destination,
                           r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: 33})),
                         ('zero-fill-size', lambda: n.call(zero_entry, {r.UC_X86_REG_RDI: destination,
                           r.UC_X86_REG_RSI: 33})),
                         ('pattern-fill-size', lambda: n.call(pattern_entry, {r.UC_X86_REG_RDI: destination,
                           r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: 33})),
                         ('pattern-fill-source', lambda: n.call(pattern_entry, {r.UC_X86_REG_RDI: destination,
                           r.UC_X86_REG_RSI: 0, r.UC_X86_REG_RDX: 16}))]:
        try:
            action()
        except ValueError:
            failures.append(name)
        else:
            raise ValueError('Composite asset boundary did not reject ' + name)
    n.next_heap = n.asset_arena['end'] - 16
    try:
        n.allocate(32)
    except ValueError:
        failures.append('arena-capacity')
    else:
        raise ValueError('Composite arena capacity was not enforced')
    paths = {Path(__file__), Path(inspect.getfile(NativeBoundedAssetArena)),
             Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    result = {'schema': 1, 'kind': 'composite-asset-arena-boundary-control',
              'build': n.profile['clientVersion'], 'arena': n.asset_arena, 'rejectedBoundaries': failures,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'scope': {'copyBytesVerified': True, 'zeroFillBytesAndAdjacentBytesVerified': True,
                        'zeroLengthNullSourceCopyVerified': True,
                        'patternFillPartialTailAndAdjacentBytesVerified': True,
                        'additionalReadWriteDataOnly': True,
                        'nativeAllocatorPolicyRecovered': False, 'matchCoverage': False}}
    output = fixture.cache / 'research/bounded-asset-arena-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'rejectedBoundaries': failures, 'copyBytesVerified': True}))
    n.close_files()


if __name__ == '__main__':
    main()
