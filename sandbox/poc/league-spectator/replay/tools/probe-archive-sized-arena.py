"""Check large native file buffers in both owned allocator regions."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from archive_sized_arena_native import NativeArchiveSizedArena, MAX_ARCHIVE_BYTES
from bounded_asset_arena_native import NativeBoundedAssetArena
from native_ai_unit_fixture import NativeAIUnitFixture
from wad_file_native import NativeWadFiles
from vfx_spawn_native import sha


class Control(NativeArchiveSizedArena, NativeBoundedAssetArena, NativeWadFiles):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    count = 0x100013
    baseline = n.allocate(count)
    n.initialize_asset_arena(32)
    # Explicit allocator stress; this changes no original game object or flag.
    n.next_heap = n.asset_arena['start']
    source, destination = n.allocate(count), n.allocate(count + 32, 0xa5)
    expected = (bytes(range(256)) * ((count + 255) // 256))[:count]
    n.u.mem_write(source, expected)
    target = destination + 16
    n.call(0x1feea44, {r.UC_X86_REG_RDI: target, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: count})
    if bytes(n.u.mem_read(target, count)) != expected or n.u.reg_read(r.UC_X86_REG_RAX) != target:
        raise ValueError('Archive-sized native copy bytes or return value differ')
    zero = next(at for at, name in n.source.imports.items() if name == '___bzero')
    pattern = next(at for at, name in n.source.imports.items() if name == '_memset_pattern16')
    n.call(zero, {r.UC_X86_REG_RDI: target, r.UC_X86_REG_RSI: count})
    if any(n.u.mem_read(target, count)):
        raise ValueError('Archive-sized zero fill did not clear its requested bytes')
    n.call(pattern, {r.UC_X86_REG_RDI: target, r.UC_X86_REG_RSI: source + 7, r.UC_X86_REG_RDX: count})
    repeated = (expected[7:23] * ((count + 15) // 16))[:count]
    if (bytes(n.u.mem_read(target, count)) != repeated or
            bytes(n.u.mem_read(destination, 16)) != b'\xa5' * 16 or
            bytes(n.u.mem_read(target + count, 16)) != b'\xa5' * 16):
        raise ValueError('Archive-sized pattern tail or neighboring bytes differ')
    maximum = n.allocate(MAX_ARCHIVE_BYTES, 0x5a)
    if (not n.owns_asset_bytes(maximum, MAX_ARCHIVE_BYTES) or
            n.owns_asset_bytes(maximum, MAX_ARCHIVE_BYTES + 1) or
            bytes(n.u.mem_read(maximum + MAX_ARCHIVE_BYTES - 16, 16)) != b'\x5a' * 16):
        raise ValueError('Maximum WAD-sized allocation ownership/last bytes differ')
    rejected = []
    cases = [('allocation-size', lambda: n.allocate(MAX_ARCHIVE_BYTES + 1)),
             ('copy-escape', lambda: n.call(0x1feea44, {r.UC_X86_REG_RDI: target,
                r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: count + 17})),
             ('zero-fill-escape', lambda: n.call(zero, {r.UC_X86_REG_RDI: target, r.UC_X86_REG_RSI: count + 17})),
             ('pattern-fill-source', lambda: n.call(pattern, {r.UC_X86_REG_RDI: target,
                r.UC_X86_REG_RSI: 0, r.UC_X86_REG_RDX: count})),
             ('pattern-fill-escape', lambda: n.call(pattern, {r.UC_X86_REG_RDI: target,
                r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: count + 17}))]
    for name, operation in cases:
        try:
            operation()
        except ValueError:
            rejected.append(name)
        else:
            raise ValueError('Archive-sized arena did not reject ' + name)
    n.next_heap = n.asset_arena['end'] - 16
    try:
        n.allocate(32)
    except ValueError:
        rejected.append('arena-capacity')
    else:
        raise ValueError('Archive-sized arena did not preserve its total capacity bound')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'baselineAllocation': baseline, 'comparisonBytes': count, 'arena': n.asset_arena,
              'largeAllocations': n.archive_sized_allocations, 'rejectedBoundaries': rejected,
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'scope': {'nativeMemoryCopyAndFillABIs': True, 'bothAllocatorRegionsChecked': True,
                        'maximumWadAllocationChecked': True, 'patternPartialTailAndGuardsChecked': True,
                        'callerMovedAllocationCursor': True, 'nativeAllocatorPolicyRecovered': False,
                        'matchCoverage': False}}
    output = fixture.cache / 'research/archive-sized-arena-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'comparisonBytes': count, 'rejectedBoundaries': rejected}))
    n.close_files()


if __name__ == '__main__':
    main()
