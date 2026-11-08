"""Exercise the original navgrid query with its recovered cold spatial provider."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from archive_sized_arena_native import NativeArchiveSizedArena
from bounded_asset_arena_native import NativeBoundedAssetArena
from character_script_native import NativeCharacterScripts
from native_ai_unit_fixture import NativeAIUnitFixture
from navgrid_collision_native import (BUCKET_BYTES, NativeNavgridCollisionArena,
                                     initialize_navgrid_collision_provider)
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


class Control(NativeNavgridCollisionArena, NativeArchiveSizedArena,
              NativeBoundedAssetArena, NativeNavgridStream, NativeCharacterScripts):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    results, boundary = {}, None
    try:
        n.initialize_asset_arena(64)
        results['product'] = initialize_product_configuration(n, 'LoL')
        results['provider'] = initialize_navgrid_collision_provider(n)
        provider = results['provider']
        for label, operation in [
                ('duplicateInitializer', lambda: initialize_navgrid_collision_provider(n)),
                ('outsideConstructorAllocation', lambda: n.allocate(BUCKET_BYTES))]:
            try:
                operation()
            except ValueError as error:
                results[label] = {'rejected': True, 'reason': str(error)}
            else:
                raise ValueError('Required guard accepted ' + label)
        results['navgrid'] = initialize_navgrid_world(fixture, owner_context=provider['provider'])
        runtime = results['navgrid']['runtime']
        criteria = n.allocate(8)
        points = []
        # Use actual loaded cells, the original caller's three float constants,
        # and an explicitly empty spatial world. No actor/collision is fabricated.
        for index in [0, 1, 12000, 236074]:
            before = n.u32(provider['spatial'] + 0x4050)
            registers = {r.UC_X86_REG_RDI: runtime, r.UC_X86_REG_RSI: 0,
                         r.UC_X86_REG_RDX: n.q(runtime + 0xe0) + index * 16,
                         r.UC_X86_REG_RCX: criteria}
            for register, source in [(r.UC_X86_REG_XMM0, 0x16bce9f + 0xa0db1d),
                                     (r.UC_X86_REG_XMM1, 0x16bcea7 + 0xa1e71d),
                                     (r.UC_X86_REG_XMM2, 0x16bceaf + 0xa0e5a5)]:
                registers[register] = int.from_bytes(n.image[source:source + 4], 'little')
            n.call(0x16c4290, registers)
            if ((n.u.reg_read(r.UC_X86_REG_RAX) & 255) != 0 or
                    n.u32(provider['spatial'] + 0x4050) != before + 1):
                raise ValueError('Original cold spatial query result/generation differs')
            points.append({'cellIndex': index, 'returnLowByte': n.u.reg_read(r.UC_X86_REG_RAX) & 255,
                           'generationBefore': before,
                           'generationAfter': n.u32(provider['spatial'] + 0x4050)})
        required = [0x1966a0, 0x196790]
        if not all(any(at <= entry < at + block['size'] for at, block in n.blocks.items())
                   for entry in required):
            raise ValueError('Original provider/spatial query did not execute')
        arena = n.asset_arena
        if not any(start == arena['start'] and end + 1 == arena['end'] and
                   permissions == unicorn.UC_PROT_READ | unicorn.UC_PROT_WRITE
                   for start, end, permissions in n.u.mem_regions()):
            raise ValueError('Spatial storage mapping must remain owned RW without execute')
        results['queries'] = points
        results['queryControl'] = {'originalRva': 0x16c4290, 'emptySpatialWorld': True,
                                   'actorsInserted': 0, 'collisionResultsSupplied': False,
                                   'originalProviderAndSpatialQueryExecuted': True}
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                  for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             Path(inspect.getfile(initialize_product_configuration)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control]]}
    report = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'results': results, 'boundary': boundary,
              'arena': n.asset_arena, 'spatialAllocations': n.navgrid_collision_allocations,
              'spatialFills': n.navgrid_collision_fills,
              'loader': getattr(n, 'navgrid_world_observation', None),
              'inputs': fixture.inputs, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'staticCallChain': [{'rva': start, 'size': end - start,
                                   'sha256': sha(n.image[start:end])}
                                  for start, end in [(0x6102d4, 0x6102e4),
                                                     (0x16bd5d0, 0x16bd5e3),
                                                     (0x16c1f70, 0x16c1ff0),
                                                     (0x195dc0, 0x195e20),
                                                     (0x1966a0, 0x196702)]],
              'originalBlocks': list(n.blocks.values()),
              'scope': {'originalProviderQueryCompleted': boundary is None,
                        'coldSpatialWorld': True, 'actualHeroInitializationVerified': False,
                        'gameObjectFieldsSupplied': False, 'readinessBitsSupplied': False,
                        'acceptedReplayEntities': False, 'mainViewerExpanded': False}}
    output = fixture.cache / 'research/navgrid-collision-native.json'
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'results': results, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
