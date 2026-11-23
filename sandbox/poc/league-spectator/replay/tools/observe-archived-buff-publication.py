"""Execute source-backed buff preload requests against complete signed archives.

No source wrapper, readiness flag, registry row or script filename is supplied.
The receipt retains the first unsupported original execution boundary.
"""
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

from unicorn import x86_const as r
from archive_subchunks_native import load_installed_subchunks
from buff_metadata_native import initialize_buff_metadata_types
from champion_catalog_native import initialize_binary_resource_cache, initialize_binary_postload_tls
from effect_context_native import NativeEffectContexts
from global_resource_collection_native import initialize_global_resource_collection
from installed_resource_archive_native import register_resource_archive
from process_arguments_native import initialize_product_configuration
from runtime_name_registry_native import initialize_runtime_name_registry, inspect_runtime_name_registry
from script_manifest_native import load_manifest
from vfx_spawn_native import name_hash, sha
from darwin_online_processors_native import NativeDarwinOnlineProcessors
from dynamic_vfx_buffers_native import NativeDynamicVfxBuffers
from original_vfx_startup_native import initialize_original_vfx_startup
from shared_graphics_registries_native import initialize_shared_graphics_registries
from original_asset_dispatch_native import initialize_original_asset_dispatch
from libc_memchr_native import NativeBoundedMemchr
from original_buff_module_native import initialize_original_buff_module
from original_buff_hero_native import initialize_original_buff_hero_context, construct_original_buff_hero, bind_original_control_buff_hero
from original_recorded_buff_case_native import observe_recorded_buff_case
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


driver = Path(__file__).with_name('probe-archived-replay-ui-bootstrap.py')
spec = importlib.util.spec_from_file_location('archived_buff_platform_inputs', driver)
platform = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = platform
spec.loader.exec_module(platform)


class Control(NativeDarwinSdkClocks, NativeDarwinSdkStorage, NativeDarwinSdkThreads, NativeDarwinConditionObjects, NativeDarwinSchedulerQueries, NativeConfigurationFileOverlay, NativeClientVersionString, NativeClientVersionScan, NativeOffscreenApplication, NativeBoundedMemchr, NativeDarwinOnlineProcessors, NativeDynamicVfxBuffers, platform.NativeArchivedReplayUiControl):
    registry = NativeEffectContexts.registry
    lookup_context = NativeEffectContexts.lookup_context


def native_string(n, at):
    data, count = n.q(at), n.u32(at+8)
    if count > 4096 or not n.library_pointer(data, count+1) or n.u.mem_read(data+count, 1)[0]:
        raise ValueError('Original buff string escaped owned terminated storage')
    return bytes(n.u.mem_read(data, count)).decode('ascii')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'installation', 'installation_manifest', 'input', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--factory-only', action='store_true',
                        help='Exercise the independent original runtime factory without requesting full spell/VFX dependencies')
    parser.add_argument('--vfx-startup-source', type=Path,
                        help='Exact original scene/VFX caller source authority for complete dependency initialization')
    parser.add_argument('--graphics', type=Path,
                        help='Explicit existing ANGLE device adapter input for original VFX startup')
    parser.add_argument('--shared-shaders', type=Path,
                        help='Explicit immutable shared-shader translation package used by original dependent material loads')
    parser.add_argument('--mode-input', type=Path)
    parser.add_argument('--buff-capture', type=Path)
    parser.add_argument('--buff-prefix-proof', type=Path)
    parser.add_argument('--scheduler-source', type=Path)
    parser.add_argument('--condition-source', type=Path)
    parser.add_argument('--condition-types-source', type=Path)
    parser.add_argument('--thread-public-source', type=Path)
    parser.add_argument('--thread-impl-source', type=Path)
    parser.add_argument('--sdk-clock-source', type=Path)
    parser.add_argument('--sdk-clock-types-source', type=Path)
    args = parser.parse_args()
    if any([args.mode_input, args.buff_capture, args.buff_prefix_proof]) and not all(
            [args.mode_input, args.buff_capture, args.buff_prefix_proof, args.vfx_startup_source, args.shared_shaders]):
        parser.error('Recorded component control requires mode/capture/prefix proof and explicit full graphics dependencies')
    if bool(args.condition_source) != bool(args.condition_types_source):
        parser.error('Condition and condition-type sources must be selected together')
    if bool(args.thread_public_source) != bool(args.thread_impl_source) or args.thread_public_source and not (args.scheduler_source and args.condition_types_source):
        parser.error('SDK thread references require both headers and explicit scheduler/type sources')
    if bool(args.sdk_clock_source) != bool(args.sdk_clock_types_source) or args.sdk_clock_source and not args.thread_public_source:
        parser.error('SDK clocks require both pinned sources and the SDK thread platform')
    for name in ['cache', 'client', 'installation', 'installation_manifest', 'input']:
        setattr(args, name, getattr(args, name).resolve(strict=True))
    args.output = args.output.resolve()
    if any(args.output.is_relative_to(root) for root in [args.cache, args.client.parent, args.installation]):
        raise ValueError('Publication receipt must stay outside retained input roots')
    encoded, manifest_bytes = args.input.read_bytes(), args.installation_manifest.read_bytes()
    request, manifest = json.loads(encoded), json.loads(manifest_bytes)
    vfx_source_bytes = args.vfx_startup_source.read_bytes() if args.vfx_startup_source else None
    vfx_source = json.loads(vfx_source_bytes) if vfx_source_bytes else None
    if bool(args.vfx_startup_source) != bool(args.graphics):
        raise ValueError('Original VFX source authority and explicit hardware adapter input must be selected together')
    if args.shared_shaders is not None and not args.vfx_startup_source:
        raise ValueError('Shared shader selection requires the explicit original VFX/graphics startup')
    tools = Path(__file__).resolve().parent
    if (request['kind'] != 'original-homeguard-complete-spell-object-source-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            request['preparerSha256'] != sha((tools/'prepare-homeguard-spell-source-input.mjs').read_bytes()) or
            request['readerSha256'] != sha((tools/'exact-map-bin.mjs').read_bytes()) or
            not 0 < len(request['records']) <= 16 or
            manifest['kind'] != 'archived-original-controller-bootstrap-with-scripts'):
        raise ValueError('Exact complete authored spell input and installation authority required')
    for file, digest in request['inputs'].items():
        if sha(Path(file).read_bytes()) != digest:
            raise ValueError('Complete authored spell input changed: '+file)
    if vfx_source is not None:
        if (vfx_source['kind'] != 'original-vfx-manager-startup-source' or
                vfx_source['sources']['inspect-original-vfx-manager-startup.py'] !=
                sha((tools/'inspect-original-vfx-manager-startup.py').read_bytes())):
            raise ValueError('Exact original scene/VFX source authority required')
        for file, digest in vfx_source['inputs'].items():
            if sha(Path(file).read_bytes()) != digest:
                raise ValueError('Original VFX source input changed: '+file)
    source_paths = {Path(__file__).resolve()}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename:
            path = Path(filename).resolve()
            if path.is_relative_to(tools) and path.suffix == '.py':
                source_paths.add(path)
    sources = {str(path): sha(path.read_bytes()) for path in sorted(source_paths)}
    n = Control(args.cache/'public/decoder-16.21-macos', args.client)
    fixture = platform.ReadOnlyInputs(n, args.cache)
    setup, cases, phase, boundary = {}, [], 'installation-authority', None
    try:
        if sha(n.image) != request['decoderImageSha256']:
            raise ValueError('Exact original publication image differs')
        for item in manifest['files']:
            file = (args.installation/item['file']).resolve(strict=True)
            if not file.is_relative_to(args.installation):
                raise ValueError('Installation authority escapes retained root')
            raw = fixture.raw(file)
            if len(raw) != item['bytes'] or sha(raw) != item['sha256']:
                raise ValueError('Complete installation authority bytes differ: '+item['file'])
        for file in [args.client, args.cache/'public/decoder-16.21-macos/profile.json',
                     args.cache/'public/decoder-16.21-macos/image.bin']:
            fixture.raw(file)
        phase = 'original-platform-initializers'
        n.initialize_layout_constants()
        n.clock_inputs = {'numer': 1, 'denom': 1, 'ticks': 1_000_000_000}
        setup['platformClockInputs'] = dict(n.clock_inputs)
        setup['looseFiles'] = n.configure_client_loose_files(args.installation/'Game')
        setup['hostEntropy'] = n.configure_random_device_inputs('host-os-entropy')
        if vfx_source is not None:
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
        if not args.buff_capture:
            setup['audio'] = n.initialize_audio_facade()
        if not args.buff_capture:
            setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        setup['characterTypes'] = n.initialize_character_types()
        setup['buffTypes'] = initialize_buff_metadata_types(n)
        setup['buffModule'] = initialize_original_buff_module(n)
        setup['diagnosticMutex'] = initialize_original_diagnostic_log_mutex(n)
        setup['names'] = initialize_runtime_name_registry(n)
        n.call(0x35dd5c, {}, 0x35dd6e)
        registry = n.registry()
        shared = n.lookup_context(registry, 3579051965)
        if shared != registry+0x68 or n.q(n.q(shared)+0x30)-n.base != 0x35a270:
            raise ValueError('Original Shared context differs')
        setup['context'] = {'registry': registry, 'shared': shared, 'contextId': 3579051965}
        # This complete original constructor owns the decompression mutex's
        # cold startup. Subchunk loading subsequently verifies and reuses it.
        phase = 'original-script-vm'
        setup['scriptVM'] = n.initialize_character_script_vm()
        setup['archives'] = []
        for name in ['DATA.wad.client', 'Global.wad.client', 'Bootstrap.windows.wad.client', 'Scripts.wad.client']:
            phase = 'signed-archive:'+name
            archive = register_resource_archive(fixture, args.installation, name)
            file = Path(archive['path'])
            archive['subchunks'] = load_installed_subchunks(fixture, args.installation, file,
                                                           archive['archive'], fixture.raw(file))
            setup['archives'].append(archive)
            print(json.dumps({'phase': phase, 'nativeSignatureVerified': True}), flush=True)
        if args.buff_capture:
            phase = 'original-compiled-configuration-before-audio-and-ui'
            configure_original_configuration_overlay(n, fixture)
            setup['audioConfiguration'] = {}
            initialize_original_audio_configuration(n, setup['audioConfiguration'])
            setup['audio'] = n.initialize_audio_facade()
        phase = 'original-script-manifest'
        setup['scriptManifest'] = load_manifest(fixture, setup['archives'][-1])
        phase = 'original-global-collection-and-preload-repository'
        setup['globalCollection'] = initialize_global_resource_collection(n)
        setup['spellPreloads'] = n.initialize_spell_preload_manager()
        # The earlier complete original context-registry constructor is the
        # same module-provider owner. Retain its source/bytecode interfaces.
        if (n.q(n.base+0x24728d0) != registry or n.allocations.get(registry) != 0xc0 or
                [n.q(registry+offset)-n.base for offset in [0, 0x68, 0x88]] !=
                [0x231a6d8, 0x231a638, 0x231a7e8]):
            raise ValueError('Original context/module-provider ownership differs')
        setup['moduleProviders'] = {'object': registry, 'constructorRva': 0x3530b0,
                                    'existingContextRegistryRetained': True,
                                    'sourceInterface': registry+0x68, 'bytecodeInterface': registry+0x88}
        setup['binaryCache'] = initialize_binary_resource_cache(n)
        setup['binaryTLS'] = initialize_binary_postload_tls(n)
        if n.q(n.base+0x246c978):
            raise ValueError('Original spell-name registry must be cold')
        spell_registry = n.allocate(0x50)
        n.call(0x8325b0, {r.UC_X86_REG_RDI: spell_registry})
        if n.q(n.base+0x246c978) != spell_registry:
            raise ValueError('Original spell-name registry publication differs')
        if vfx_source is not None:
            phase = 'complete-original-vfx-startup'
            setup['vfxStartup'], setup['vfxExecution'] = {}, {}
            initialize_original_vfx_startup(n, fixture, args.graphics, vfx_source,
                                            setup['vfxStartup'], setup['vfxExecution'],
                                            resource_groups=setup.get('audioConfiguration', {}).get('resourceGroups'))
            if args.shared_shaders is not None:
                phase = 'original-shared-graphics-registries'
                setup['sharedGraphics'] = initialize_shared_graphics_registries(n, args.shared_shaders)
            phase = 'original-caller-dispatched-asset-queue'
            setup['assetDispatch'] = initialize_original_asset_dispatch(n)
        for item in request['records']:
            phase = 'whole-authored-spell:'+item['registeredName']
            raw = Path(item['source']['file']).read_bytes()
            if len(raw) != item['source']['bytes'] or sha(raw) != item['sourceSha256']:
                raise ValueError('Whole authored spell source bytes differ')
            fields = []
            for span in item['fields']:
                offset, size = span['offset'], span['bytes']
                if not 0 <= offset <= len(raw)-size or not 5 <= size <= 1024*1024:
                    raise ValueError('Whole spell field escaped its original source')
                field = raw[offset:offset+size]
                if sha(field) != span['sha256']:
                    raise ValueError('Whole spell field digest differs')
                fields.append(field)
            read = n.observe_actor_fields(name_hash('SpellObject'), fields)
            row = {'name': item['registeredName'], 'sourceSha256': item['sourceSha256'],
                   'ownerPathHash': item['ownerPathHash'], 'resourceNameHash': item['resourceNameHash'],
                   'authoredFieldHashes': item['authoredFieldHashes'], 'originalTypedRead': read}
            cases.append(row)
            if read['originalSkippedFields'] or read['pendingReferences']:
                raise ValueError('Whole spell retains unsupported original fields/references')
            spell = read['object']
            if n.q(spell+0x70):
                raise ValueError('Authored script-data override needs its original consumer')
            buff = n.q(spell+0x60)
            if not n.library_pointer(buff, 128):
                raise ValueError('Whole authored spell has no owned original BuffData')
            n.call(0x861563, {r.UC_X86_REG_RBX: spell}, 0x8615aa)
            if native_string(n, buff+0x10) != item['registeredName']:
                raise ValueError('Original whole spell name-copy differs')
            row['nativeNameRegistered'] = True
            if not args.factory_only:
                phase = 'original-preload-request:'+item['registeredName']
                n.call(0x84b9d0, {r.UC_X86_REG_RDI: setup['spellPreloads']['object']+8,
                                 r.UC_X86_REG_RSI: shared, r.UC_X86_REG_RDX: n.q(buff+0x10)})
                preload = n.u.reg_read(r.UC_X86_REG_RAX)
                if preload and not n.library_pointer(preload, 0xb8):
                    raise ValueError('Original preload request escaped owned storage')
                row['preloadRequest'] = {'resource': preload, 'allocatedBytes': n.allocations.get(preload),
                                         'objectHex': bytes(n.u.mem_read(preload, 0xb8)).hex() if preload else None}
                if vfx_source is not None:
                    phase = 'original-asset-read-completion-and-callback-drain:'+item['registeredName']
                    row['assetQueueBeforeDrain'] = n.asset_queue_state()
                    n.drain_asset_read_jobs()
                    row['assetQueueAfterDrain'] = n.asset_queue_state()
            phase = 'original-runtime-factory:'+item['registeredName']
            n.call(0x8601a0, {r.UC_X86_REG_RDI: item['resourceNameHash'], r.UC_X86_REG_RSI: shared})
            resource = n.u.reg_read(r.UC_X86_REG_RAX)
            row['originalRuntimeResource'] = resource
            row['resourceStatus'] = 'resolved' if resource else 'unavailable-original-factory-returned-null'
            if resource:
                if not n.library_pointer(resource, 0x10):
                    raise ValueError('Original runtime buff resource escaped owned storage')
                # This resource holds a C-string pointer, not a GameString.
                pointer = n.q(resource+8)
                name = bytes(n.u.mem_read(pointer, len(item['registeredName'])+1))
                if name != item['registeredName'].encode()+b'\0':
                    raise ValueError('Original runtime resource name differs from source')
            print(json.dumps({'phase': phase, 'status': row['resourceStatus']}), flush=True)
        setup['registeredNames'] = inspect_runtime_name_registry(n, setup['names'])
        if args.buff_capture:
            phase = 'original-signed-archive-audio-provider-composition'
            setup['audioProviders'] = {}
            initialize_original_audio_providers(n, setup['audioProviders'])
            setup['ui'] = n.initialize_ui_data_prefix()
            phase = 'original-cold-recorded-mode-hero'
            setup['heroContext'] = initialize_original_buff_hero_context(fixture, args.mode_input)
            setup['hero'] = construct_original_buff_hero(fixture, setup['heroContext'])
            phase = 'original-control-hero-buff-owner'
            setup['heroBuffBinding'] = bind_original_control_buff_hero(fixture, setup['heroContext'], setup['hero'])
            phase = 'original-recorded-buff-component-consumer'
            setup['recordedBuffComponent'] = {}
            observe_recorded_buff_case(fixture, setup['heroContext'], setup['hero'],
                                       args.buff_capture, args.buff_prefix_proof, setup['recordedBuffComponent'])
        phase = 'complete'
    except Exception as error:
        stack = n.u.reg_read(r.UC_X86_REG_RSP)
        boundary = {'phase': phase, 'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'nativeCallerRva': n.q(stack)-n.base if n.library_pointer(stack, 8) else None,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name.upper()))
                                  for name in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']}}
    finally:
        n.close_files()
        if n.shader_catalog is not None:
            for file, expected in n.shader_catalog.inputs.items():
                if sha(fixture.raw(Path(file))) != expected:
                    raise ValueError('Shared shader source changed during original preload: '+file)
        if n.device is not None:
            n.close_graphics()
    try:
        if getattr(n, 'configuration_overlay', None) is not None:
            setup['configurationOverlay'] = original_configuration_overlay_summary(n)
        fixture.verify()
        for file, digest in {**sources, **request['inputs']}.items():
            if sha(Path(file).read_bytes()) != digest:
                raise ValueError('Native publication source changed: '+file)
        if args.input.read_bytes() != encoded or args.installation_manifest.read_bytes() != manifest_bytes:
            raise ValueError('Native publication authority changed')
        if vfx_source_bytes is not None and args.vfx_startup_source.read_bytes() != vfx_source_bytes:
            raise ValueError('Original VFX startup authority changed')
        report = {'schema': 1, 'kind': 'original-archived-buff-publication-observation',
                  'build': request['build'], 'protocol': request['protocol'], 'imageSha256': sha(n.image),
                  'inputSha256': sha(encoded), 'installationManifestSha256': sha(manifest_bytes),
                  'vfxStartupSourceSha256': sha(vfx_source_bytes) if vfx_source_bytes else None,
                  'inputs': fixture.inputs, 'sources': sources, 'setup': setup, 'cases': cases,
                  'phase': phase, 'boundary': boundary, 'originalBlocks': list(n.blocks.values()),
                  'dynamicBufferAllocations': getattr(getattr(n, 'dynamic_buffer_device', None), 'records', []),
                  'assetQueueJobs': n.asset_queue_jobs, 'assetCompletionRuns': n.asset_completion_runs,
                  'assetCallbackRuns': n.asset_callback_runs,
                  'machSemaphores': n.mach_semaphore_summary(), 'cooperativeThreads': n.cooperative_thread_summary(),
                  'memchrCalls': getattr(n, 'memchr_calls', []),
                  'clientVersionScans': getattr(n, 'client_version_scan_calls', []),
                  'clientVersionStrings': getattr(n, 'client_version_string_calls', []),
                  'scope': {'scriptsMountedFromSignedOriginalArchive': len(setup.get('archives', [])) == 4,
                            'originalScriptVmConstructed': 'scriptVM' in setup,
                            'allScriptManifestFieldsCompared': 'scriptManifest' in setup,
                            'dependentSpellAndVfxPreloadsRequested': not args.factory_only,
                            'sourceWrappersSupplied': False, 'readinessFlagsSupplied': False,
                            'recordedBuffMembershipEstablished': False, 'liveBuffProvidersAdmitted': False}}
        args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    finally:
        fixture.close()
    print(json.dumps({'output': str(args.output), 'phase': phase, 'cases': len(cases), 'boundary': boundary}))
    if boundary:
        raise SystemExit(1)
    if any(row['originalRuntimeResource'] == 0 for row in cases):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
