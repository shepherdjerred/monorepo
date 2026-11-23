"""Execute the complete original scene/VFX-manager startup, preserving boundaries.

The original caller allocates both objects and supplies its own scene argument.
No quality, scene, worker-readiness or resource-cache field is fabricated.
"""
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

from unicorn import x86_const as r
from original_vfx_startup_native import initialize_original_vfx_startup
from original_asset_dispatch_native import initialize_original_asset_dispatch
from original_buff_module_native import initialize_original_buff_module
from original_buff_hero_native import initialize_original_buff_hero_context, construct_original_buff_hero, bind_original_control_buff_hero
from original_audio_provider_native import initialize_original_audio_configuration, initialize_original_audio_providers
from original_diagnostic_log_native import initialize_original_diagnostic_log_mutex
from offscreen_application_native import NativeOffscreenApplication
from client_version_scan_native import NativeClientVersionScan
from client_version_string_native import NativeClientVersionString
from configuration_file_overlay_native import NativeConfigurationFileOverlay, configure_original_configuration_overlay, original_configuration_overlay_summary
from darwin_scheduler_query_native import NativeDarwinSchedulerQueries
from darwin_condition_objects_native import NativeDarwinConditionObjects
from darwin_sdk_threads_native import NativeDarwinSdkThreads
from darwin_sdk_storage_native import NativeDarwinSdkStorage
from darwin_sdk_clocks_native import NativeDarwinSdkClocks
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from darwin_online_processors_native import NativeDarwinOnlineProcessors
from dynamic_vfx_buffers_native import NativeDynamicVfxBuffers
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha


driver = Path(__file__).with_name('probe-archived-replay-ui-bootstrap.py')
spec = importlib.util.spec_from_file_location('original_vfx_startup_platform', driver)
platform = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = platform
spec.loader.exec_module(platform)


class Control(NativeDarwinSdkClocks, NativeDarwinSdkStorage, NativeDarwinSdkThreads, NativeDarwinConditionObjects, NativeDarwinSchedulerQueries, NativeConfigurationFileOverlay, NativeClientVersionString, NativeClientVersionScan, NativeOffscreenApplication, NativeDarwinOnlineProcessors, NativeDynamicVfxBuffers, platform.NativeArchivedReplayUiControl):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'installation', 'source', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--graphics', type=Path,
                        help='Explicit actual ANGLE DLL directory for the existing verified graphics device adapter')
    parser.add_argument('--asset-queue', action='store_true',
                        help='Verify original I/O queue construction and existing completion-owner association')
    parser.add_argument('--buff-module', action='store_true',
                        help='Execute the original Buff/Spell global-prefix and root script-scope constructor')
    parser.add_argument('--hero', action='store_true',
                        help='Construct a fresh original concrete hero for BuffManager/provider ownership; no snapshot or entity registration')
    parser.add_argument('--mode-input', type=Path,
                        help='Exact recorded Map11 mode/constants source projection, with all other reference reads rejected')
    parser.add_argument('--bind-hero-buffs', action='store_true',
                        help='Execute original local-world control admission and BuffManager binding; no replay entity acceptance')
    parser.add_argument('--audio-providers', action='store_true',
                        help='Execute original container registration and complete audio-facade provider binding')
    parser.add_argument('--audio-archive', choices=['DATA.wad.client'],
                        help='Register exact signed DATA and all original subchunks for configuration/provider control')
    parser.add_argument('--scheduler-source', type=Path,
                        help='Pinned original Darwin pthread source for explicit default-priority query ABI')
    parser.add_argument('--condition-source', type=Path)
    parser.add_argument('--condition-types-source', type=Path)
    parser.add_argument('--thread-public-source', type=Path)
    parser.add_argument('--thread-impl-source', type=Path)
    parser.add_argument('--sdk-clock-source', type=Path)
    parser.add_argument('--sdk-clock-types-source', type=Path)
    args = parser.parse_args()
    if args.bind_hero_buffs and not args.hero:
        parser.error('--bind-hero-buffs requires --hero')
    if args.audio_providers and not args.audio_archive:
        parser.error('--audio-providers requires the explicit signed --audio-archive')
    if bool(args.condition_source) != bool(args.condition_types_source):
        parser.error('Condition and condition-type sources must be selected together')
    if bool(args.thread_public_source) != bool(args.thread_impl_source) or args.thread_public_source and not (args.scheduler_source and args.condition_types_source):
        parser.error('SDK thread references require both headers and explicit scheduler/type sources')
    if bool(args.sdk_clock_source) != bool(args.sdk_clock_types_source) or args.sdk_clock_source and not args.thread_public_source:
        parser.error('SDK clocks require both pinned sources and the SDK thread platform')
    for name in ['cache', 'client', 'installation', 'source']:
        setattr(args, name, getattr(args, name).resolve(strict=True))
    args.output = args.output.resolve()
    if any(args.output.is_relative_to(root) for root in [args.cache, args.client.parent, args.installation]):
        raise ValueError('VFX startup receipt must stay outside retained source roots')
    source_bytes = args.source.read_bytes()
    source = json.loads(source_bytes)
    tools = Path(__file__).resolve().parent
    if (source['kind'] != 'original-vfx-manager-startup-source' or
            source['build'] != '16.21.829.8620' or source['protocol'] != '20e09df23c66b85e' or
            source['startupEntryRva'] != 0x36fd40 or
            source['sources']['inspect-original-vfx-manager-startup.py'] !=
            sha((tools/'inspect-original-vfx-manager-startup.py').read_bytes())):
        raise ValueError('Exact original VFX startup source proof required')
    for file, expected in source['inputs'].items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Original VFX startup source input changed: '+file)
    paths = {Path(__file__).resolve()}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename:
            path = Path(filename).resolve()
            if path.is_relative_to(tools) and path.suffix == '.py':
                paths.add(path)
    sources = {str(path): sha(path.read_bytes()) for path in sorted(paths)}
    n = Control(args.cache/'public/decoder-16.21-macos', args.client)
    fixture = platform.ReadOnlyInputs(n, args.cache)
    setup, execution, boundary, phase = {}, {}, None, 'source-identity'
    try:
        if sha(n.image) != source['decoderImageSha256']:
            raise ValueError('Exact original VFX startup image differs')
        for block in source['sourceBlocks']:
            start, end = block['startRva'], block['endRva']
            if n.image[start:end] != n.source.image[start:end] or sha(n.image[start:end]) != block['sha256']:
                raise ValueError('Original scene/VFX startup instruction bytes differ')
        exe = args.installation/'Game/League of Legends.exe'
        if sha(fixture.raw(exe)) != n.profile['windowsClientSha256']:
            raise ValueError('Exact archived installation build required')
        phase = 'original-platform-initialization'
        n.initialize_layout_constants()
        if args.audio_providers:
            setup['diagnosticMutex'] = initialize_original_diagnostic_log_mutex(n)
        n.clock_inputs = {'numer': 1, 'denom': 1, 'ticks': 1_000_000_000}
        setup['platformClockInputs'] = dict(n.clock_inputs)
        setup['looseFiles'] = n.configure_client_loose_files(args.installation/'Game')
        setup['hostEntropy'] = n.configure_random_device_inputs('host-os-entropy')
        setup['onlineProcessors'] = n.configure_online_processors(os.cpu_count(), performance_levels_unavailable=True)
        setup['semaphores'] = n.initialize_mach_semaphore_platform()
        setup['arena'] = n.initialize_asset_arena(64)
        if args.scheduler_source:
            setup['schedulerQueries'] = n.configure_scheduler_queries(fixture.raw(args.scheduler_source), default_user_priority=31)
        if args.condition_source:
            setup['conditionObjects'] = n.configure_condition_objects(fixture.raw(args.condition_source), fixture.raw(args.condition_types_source))
        if args.thread_public_source:
            setup['sdkThreads'] = n.configure_sdk_threads(fixture.raw(args.scheduler_source), fixture.raw(args.condition_types_source),
                fixture.raw(args.thread_public_source), fixture.raw(args.thread_impl_source))
        if args.sdk_clock_source:
            setup['sdkHostClock'] = n.configure_sdk_host_clock(fixture.raw(args.sdk_clock_source), fixture.raw(args.sdk_clock_types_source))
        if not args.audio_providers:
            setup['audio'] = n.initialize_audio_facade()
        if not args.audio_providers:
            setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        if args.audio_archive:
            phase = 'original-audio-configuration-archive'
            setup['scriptVM'] = n.initialize_character_script_vm()
            setup['audioArchive'] = register_resource_archive(fixture, args.installation, args.audio_archive)
            archived = setup['audioArchive']
            path = Path(archived['path'])
            archived['subchunks'] = load_installed_subchunks(fixture, args.installation, path,
                                                            archived['archive'], fixture.raw(path))
        if args.audio_providers:
            phase = 'original-compiled-configuration-before-audio-and-ui'
            configure_original_configuration_overlay(n, fixture)
            setup['audioConfiguration'] = {}
            initialize_original_audio_configuration(n, setup['audioConfiguration'])
            setup['audio'] = n.initialize_audio_facade()
        phase = 'original-vfx-dependency-stack'
        initialize_original_vfx_startup(n, fixture, args.graphics, source, setup, execution,
                                        resource_groups=setup.get('audioConfiguration', {}).get('resourceGroups'))
        if args.asset_queue:
            phase = 'original-asset-dispatch-ownership'
            setup['assetDispatch'] = initialize_original_asset_dispatch(n)
        if args.buff_module:
            phase = 'original-buff-spell-module-globals'
            setup['buffModule'] = initialize_original_buff_module(n)
            owner = setup['buffModule']['rootFrames']
            before = bytes(n.u.mem_read(owner, 0x150))
            try:
                initialize_original_buff_module(n)
            except ValueError as error:
                if 'Exact cold original' not in str(error):
                    raise
            else:
                raise ValueError('Existing original script-scope root was silently reinitialized')
            if bytes(n.u.mem_read(owner, 0x150)) != before or n.u32(n.base+0x2568648) != 1:
                raise ValueError('Rejected duplicate module startup changed the original root')
            setup['buffModuleColdOwnerGuard'] = {'duplicateRejected': True, 'existingRootBytesUnchanged': True}
        if args.audio_providers:
            phase = 'original-audio-provider-registration'
            setup['audioProviders'] = {}
            initialize_original_audio_providers(n, setup['audioProviders'])
            setup['ui'] = n.initialize_ui_data_prefix()
        if args.hero:
            phase = 'original-cold-concrete-hero-construction'
            setup['characterTypes'] = n.initialize_character_types()
            if args.mode_input is None:
                raise ValueError('Original recorded mode/constants input required for the cold hero control')
            setup['heroContext'] = initialize_original_buff_hero_context(fixture, args.mode_input)
            setup['hero'] = construct_original_buff_hero(fixture, setup['heroContext'])
            if args.bind_hero_buffs:
                phase = 'original-control-unit-buff-manager-binding'
                setup['heroBuffBinding'] = bind_original_control_buff_hero(fixture, setup['heroContext'], setup['hero'])
        phase = 'complete'
    except Exception as error:
        boundary = {'phase': phase, 'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name.upper()))
                                  for name in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp',
                                               'r12', 'r13', 'r14', 'r15']}}
        if n.source.imports.get(boundary['instructionRva']) == '_fopen':
            boundary['originalFileRequest'] = {
                'path': n.cstring(n.u.reg_read(r.UC_X86_REG_RDI)).decode('utf-8'),
                'mode': n.cstring(n.u.reg_read(r.UC_X86_REG_RSI)).decode('ascii'),
                'callerRva': n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base}
    finally:
        n.close_files()
        if n.device is not None:
            n.close_graphics()
    try:
        if getattr(n, 'configuration_overlay', None) is not None:
            setup['configurationOverlay'] = original_configuration_overlay_summary(n)
        fixture.verify()
        for file, expected in {**sources, **source['inputs']}.items():
            if sha(Path(file).read_bytes()) != expected:
                raise ValueError('Original VFX startup source changed: '+file)
        if args.source.read_bytes() != source_bytes:
            raise ValueError('Original VFX startup authority changed')
        result = {'schema': 1, 'kind': 'original-complete-vfx-manager-startup-observation',
                  'build': source['build'], 'protocol': source['protocol'], 'imageSha256': sha(n.image),
                  'sourceAuthoritySha256': sha(source_bytes), 'sources': sources, 'inputs': fixture.inputs,
                  'setup': setup, 'execution': execution, 'phase': phase, 'boundary': boundary,
                  'originalBlocks': list(n.blocks.values()), 'cooperativeThreads': n.cooperative_thread_summary(),
                  'dynamicBufferAllocations': getattr(getattr(n, 'dynamic_buffer_device', None), 'records', []),
                  'clientVersionScans': getattr(n, 'client_version_scan_calls', []),
                  'clientVersionStrings': getattr(n, 'client_version_string_calls', []),
                  'scope': {'originalStartupCompleted': phase == 'complete', 'sceneArgumentSupplied': False,
                            'qualityOrReadinessFieldsSupplied': False, 'archivedResourcesLoaded': False,
                            'liveWorldBindingsAdmitted': False}}
        args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    finally:
        fixture.close()
    print(json.dumps({'output': str(args.output), 'phase': phase, 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
