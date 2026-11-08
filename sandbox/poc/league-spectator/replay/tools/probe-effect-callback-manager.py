"""Verify original callback startup and original Vfx-key callback enqueue."""
import argparse
import importlib.util
import inspect
import json
import runpy
import sys
from pathlib import Path
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from archive_sized_arena_native import NativeArchiveSizedArena
from effect_callback_manager_native import initialize_effect_callback_manager
from libcpp_string_resize_native import RESIZE_RVA, RESERVE_RVA, INSERT_RVA, COPY_RVA
from libcpp_string_span_append_native import NativeLibcppStringSpanAppend
from libcpp_concat_native import read_libcpp_string
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from ascii_case_search_native import NativeAsciiCaseSearch
from client_loose_files_native import NativeClientLooseFiles
from native_ai_unit_fixture import NativeAIUnitFixture
from navgrid_collision_native import NativeNavgridCollisionArena, initialize_navgrid_collision_provider
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world
from process_arguments_native import initialize_product_configuration
from pristine_block_cache_native import NativePristineBlockCache
from startup_map_skin_native import recover_startup_map_skin
from unit_category_module_native import initialize_unit_category_module
from unit_key_value_service_native import initialize_unit_key_value_service
from vfx_spawn_native import NativeSpawn, sha

runtime_path = Path(__file__).with_name('observe-character-unit-callbacks.py')
spec = importlib.util.spec_from_file_location('native_effect_callback_resources', runtime_path)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class Inputs(NativeAsciiCaseSearch, NativeClientLooseFiles, NativeLibcppStringSpanAppend, NativeNavgridCollisionArena, NativeArchiveSizedArena, NativeNavgridStream,
              NativeHeroStackProbe, runtime.NativeInstalledParticleResources):
    pass


class Control(Inputs, NativePristineBlockCache, NativeSpawn):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('installation', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    functions = [initialize_effect_callback_manager, initialize_unit_category_module,
                 initialize_unit_key_value_service, initialize_product_configuration,
                 initialize_hero_client_types, verify_hero_client_cast, recover_startup_map_skin,
                 initialize_navgrid_collision_provider, initialize_navgrid_world,
                 register_resource_archive, load_installed_subchunks]
    paths = {Path(__file__), runtime_path, Path(__file__).with_name('observe-map-asset-links.py'),
             Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c not in [object, Control, Inputs]],
             *[Path(inspect.getfile(f)) for f in functions]}
    sources_before = {p.name: sha(p.read_bytes()) for p in sorted(paths)}
    setup, controls, boundary = {}, [], None
    unit = None
    phase = 'setup'
    try:
        setup['looseFilesPolicy'] = n.configure_client_loose_files(args.installation / 'Game')
        n.initialize_asset_arena(64)
        setup['categories'] = initialize_unit_category_module(n)
        setup['audio'] = n.initialize_audio_facade()
        setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        setup['characterTypes'] = n.initialize_character_types()
        setup['heroTypes'] = initialize_hero_client_types(n, reuse_existing=True)
        setup['recordedMapInput'] = recover_startup_map_skin(n, fixture.cache, fixture.root, fixture.read, fixture.raw)
        phase = 'platform-string-resize-controls'
        obj = n.allocate(24)
        n.call(0x11fe0, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: n.allocate_text('abc'), r.UC_X86_REG_RDX: 3})
        expected = b'abc'
        setup['platformResizeControls'] = []
        setup['platformReserveControls'] = []
        for capacity in [2, 41, 1]:
            n.call(RESERVE_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: capacity})
            long_storage = n.u.mem_read(obj, 1)[0] & 1
            pointer = n.q(obj + 16) if long_storage else obj + 1
            actual_length = n.q(obj + 8) if long_storage else n.u.mem_read(obj, 1)[0] >> 1
            actual_capacity = (n.q(obj) & ~1) - 1 if long_storage else 22
            if (actual_length != len(expected) or actual_capacity < capacity or
                    bytes(n.u.mem_read(pointer, len(expected) + 1)) != expected + b'\0'):
                raise ValueError('Standard platform reserve contents/size/capacity/terminator differ')
            setup['platformReserveControls'].append({'requestedCapacity': capacity, 'actualCapacity': actual_capacity})
        for length, fill in [(8, 0x7a), (52, 0), (2, 0x78), (6, 0x3f), (0, 0)]:
            expected = expected[:length] + bytes([fill]) * max(0, length - len(expected))
            n.call(RESIZE_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: length, r.UC_X86_REG_RDX: fill})
            long_storage = n.u.mem_read(obj, 1)[0] & 1
            pointer = n.q(obj + 16) if long_storage else obj + 1
            actual_length = n.q(obj + 8) if long_storage else n.u.mem_read(obj, 1)[0] >> 1
            if actual_length != length or bytes(n.u.mem_read(pointer, length + 1)) != expected + b'\0':
                raise ValueError('Standard platform resize contents/size/terminator differ')
            setup['platformResizeControls'].append({'bytes': length, 'fill': fill, 'contentsHex': expected.hex()})
        setup['platformInsertControls'] = []
        for position, text in [(0, b'prefix'), (3, b'\0middle'), (13, b'suffix')]:
            source = n.allocate(len(text))
            n.u.mem_write(source, text)
            expected = expected[:position] + text + expected[position:]
            n.call(INSERT_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: position,
                               r.UC_X86_REG_RDX: source, r.UC_X86_REG_RCX: len(text)})
            long_storage = n.u.mem_read(obj, 1)[0] & 1
            pointer = n.q(obj + 16) if long_storage else obj + 1
            actual_length = n.q(obj + 8) if long_storage else n.u.mem_read(obj, 1)[0] >> 1
            if (n.u.reg_read(r.UC_X86_REG_RAX) != obj or actual_length != len(expected) or
                    bytes(n.u.mem_read(pointer, len(expected) + 1)) != expected + b'\0'):
                raise ValueError('Standard span insertion contents/size/terminator/reference differ')
            setup['platformInsertControls'].append({'position': position, 'insertedHex': text.hex(), 'contentsHex': expected.hex()})
        setup['platformCopyControls'] = []
        for text in [b'long' * 16 + b'\0embedded', b'OK']:
            source = n.allocate(len(text) + 1)
            n.u.mem_write(source, text + b'\0')
            source_obj = n.allocate(24)
            n.call(0x11fe0, {r.UC_X86_REG_RDI: source_obj, r.UC_X86_REG_RSI: source, r.UC_X86_REG_RDX: len(text)})
            n.call(COPY_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: source_obj})
            if n.u.reg_read(r.UC_X86_REG_RAX) != obj or read_libcpp_string(n, obj) != text:
                raise ValueError('Standard copy assignment size/contents/reference differ')
            n.call(COPY_RVA, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: obj})
            if read_libcpp_string(n, obj) != text:
                raise ValueError('Standard self-copy assignment changed contents')
            setup['platformCopyControls'].append({'bytes': len(text), 'contentsHex': text.hex(), 'selfCopyVerified': True})
        phase = 'map-assets'
        observer = runpy.run_path(str(Path(__file__).with_name('observe-map-asset-links.py')))['observe_map_assets']
        setup['mapAssets'] = observer(fixture, setup['recordedMapInput']['variant'])
        phase = 'installed-archive-registration'
        setup['archives'] = []
        for name in ['DATA.wad.client', 'Global.wad.client', 'Bootstrap.windows.wad.client']:
            archive = register_resource_archive(fixture, args.installation, name)
            path = Path(archive['path'])
            archive['subchunks'] = load_installed_subchunks(fixture, args.installation, path,
                                                          archive['archive'], fixture.raw(path))
            setup['archives'].append(archive)
        phase = 'callback-manager-startup'
        setup['callbackManager'] = initialize_effect_callback_manager(n, setup['recordedMapInput'])
        phase = 'key-service-startup'
        setup['collisionProvider'] = initialize_navgrid_collision_provider(n)
        setup['navgrid'] = initialize_navgrid_world(fixture, setup['collisionProvider']['provider'])
        setup['keyService'] = initialize_unit_key_value_service(n)
        phase = 'hero-constructor'
        unit = n.allocate(0x4aa0)
        n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
        n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
        setup['heroCast'] = verify_hero_client_cast(n, unit)
        phase = 'original-vfx-wrapper-enqueue'
        manager = setup['callbackManager']['object']
        key = n.u32(n.base + 0x255b798)
        for index, value in enumerate([0, 3, 7]):
            n.call(0x102ab0, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: key, r.UC_X86_REG_RDX: value})
            begin, end, capacity = [n.q(manager + offset) for offset in [0xd8, 0xe0, 0xe8]]
            if not begin or end - begin != (index + 1) * 16 or not begin < end <= capacity:
                raise ValueError('Original callback enqueue count/capacity differs')
            callback, owner = n.q(end - 16), n.q(end - 8)
            if (n.allocations.get(callback) != 0x30 or n.allocations.get(owner) != 0x20 or
                    n.q(owner + 0x18) != callback or
                    n.u32(callback + 0x20) != key or n.u32(callback + 0x24) != value or
                    n.u32(unit + 0x4980) != value or
                    bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100):
                raise ValueError('Original Vfx callback payload or unit guard differs')
            controls.append({'key': key, 'value': value, 'queuedOrdinal': index,
                             'callback': callback, 'owner': owner,
                             'callbackHex': bytes(n.u.mem_read(callback, 0x30)).hex(),
                             'queueCount': index + 1, 'callbackExecuted': False})
    except Exception as error:
        boundary = {'phase': phase, 'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_' + name.upper()))
                                  for name in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    loose_files = n.validate_client_loose_files()
    sources_after = {p.name: sha(p.read_bytes()) for p in sorted(paths)}
    if sources_before != sources_after:
        raise ValueError('Native prerequisite source changed during original execution')
    output = fixture.cache / 'research/effect-callback-manager-native.json'
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'setup': setup, 'controls': controls,
              'unit': unit, 'boundary': boundary, 'inputs': fixture.inputs,
              'platformResizeCalls': n.libcpp_resize_calls,
              'platformReserveCalls': n.libcpp_reserve_calls,
              'platformInsertCalls': n.libcpp_insert_calls,
              'platformCopyCalls': n.libcpp_copy_calls,
              'platformAppendCalls': n.libcpp_append_calls,
              'platformSpanAppendCalls': n.libcpp_span_append_calls,
              'platformAsciiCaseSearchCalls': n.ascii_case_search_calls,
              'looseFiles': loose_files,
              'looseFileCalls': n.client_loose_file_calls,
              'fileLookups': n.file_lookups,
              'fileCalls': n.file_calls,
              'pristineBlockCache': n.pristine_block_cache_statistics(),
              'sources': sources_after,
              'originalBlocks': list(n.blocks.values()),
              'scope': {'recordedMapArgument': 'recordedMapInput' in setup,
                        'fullOriginalManagerPostInitializationCompleted': 'callbackManager' in setup,
                        'originalVfxWrapperEnqueueVerified': len(controls) == 3 and boundary is None,
                        'suppliedWrapperValues': True, 'queuedCallbacksExecuted': False,
                        'resourceMutationAccepted': False, 'acceptedReplayEntity': False,
                        'sourceFingerprintsVerifiedBeforeAndAfter': True,
                        'mainViewerExpanded': False}}
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'manager': setup.get('callbackManager'),
                      'controls': len(controls), 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
