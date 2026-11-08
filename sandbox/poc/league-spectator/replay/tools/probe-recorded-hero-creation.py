"""Execute the original hero-creation consumer over a recorded decoded packet."""
import argparse
import inspect
import importlib.util
import json
import runpy
import struct
import sys
from pathlib import Path
import unicorn
import xxhash
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from actor_service_slices_native import NativeActorServiceSlices
from ai_hero_type_native import initialize_hero_client_types, verify_hero_client_cast
from ai_material_owner_type_native import initialize_ai_material_owner_type
from unit_collection_native import initialize_unit_collection
from skinned_vertex_buffer_native import NativeSkinnedVertexBuffers
from material_shader_defines_native import NativeMaterialShaderDefines
from material_uniform_update_native import NativeMaterialUniformUpdates
from installed_skinned_vertex_inputs import configure_installed_skin_vertices
from visibility_component_registry_native import initialize_visibility_component_registry
from resource_publication_trace_native import install_resource_publication_trace, resource_publication_trace_sources
from ai_unit_manager_native import initialize_ai_unit_manager, initialize_ai_network_registry, initialize_actor_callback_service
from archive_subchunks_native import load_installed_subchunks
from archive_sized_arena_native import NativeArchiveSizedArena
from champion_catalog_native import initialize_binary_resource_cache, initialize_binary_postload_tls, initialize_champion_catalog
from installed_resource_archive_native import register_resource_archive
from installed_scripts_native import prepare_scripts
from relative_team_colors_native import initialize_relative_team_colors
from script_manifest_native import load_manifest
from shared_graphics_registries_native import initialize_shared_graphics_registries
from shared_constant_inputs_native import initialize_shared_constant_types, initialize_shared_constant_inputs
from animation_graph_preparation_native import initialize_animation_repository
from appearance_factory_native import initialize_appearance_factory
from audio_emitter_service_native import initialize_audio_emitter_service
from asset_wait_dispatch_native import NativeAssetWaitDispatch
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from PIL import Image
from linked_game_mode_native import initialize_linked_mode_provider
from locale_configuration_native import NativeLocaleCaseConversion, initialize_locale_configuration
from mode_dependency_types_native import initialize_mode_dependency_types
from original_call_slices_native import call_original_sliced
from native_ai_unit_fixture import NativeAIUnitFixture
from navgrid_world_native import NativeNavgridStream, initialize_navgrid_world
from navgrid_collision_native import NativeNavgridCollisionArena, initialize_navgrid_collision_provider
from process_arguments_native import initialize_product_configuration
from pristine_block_cache_native import NativePristineBlockCache
from runtime_name_registry_native import initialize_runtime_name_registry
from startup_map_skin_native import recover_startup_map_skin
from startup_participants_native import initialize_recorded_participants
from vfx_spawn_native import NativeSpawn, sha
from unit_resource_native import NativeUnitResources
from unit_key_value_service_native import initialize_unit_key_value_service
from unit_category_module_native import initialize_unit_category_module
from unit_pointer_registry_native import initialize_unit_pointer_registry
from effect_callback_manager_native import initialize_effect_callback_manager
from local_controller_native import initialize_local_controller, CONSTRUCTOR_WITHOUT_LOG_WORKERS
from ascii_case_search_native import NativeAsciiCaseSearch
from libcpp_string_span_append_native import NativeLibcppStringSpanAppend
from bsd_string_copy_native import NativeBsdStringCopy
from read_only_client_directories_native import NativeReadOnlyClientDirectories
from client_loose_files_native import NativeClientLooseFiles
from cooperative_threads_native import NativeCooperativeThreads
from random_device_native import NativeRandomDeviceInputs
from mach_semaphores_native import NativeMachSemaphores
from global_resource_collection_native import initialize_global_resource_collection


runtime_path = Path(__file__).with_name('observe-character-unit-callbacks.py')
runtime_spec = importlib.util.spec_from_file_location('native_installed_resources_for_hero', runtime_path)
runtime_module = importlib.util.module_from_spec(runtime_spec)
sys.modules[runtime_spec.name] = runtime_module
runtime_spec.loader.exec_module(runtime_module)


class NativeRecordedHeroInputs(NativeMaterialUniformUpdates, NativeMaterialShaderDefines, NativeSkinnedVertexBuffers,
              NativeMachSemaphores, NativeRandomDeviceInputs, NativeCooperativeThreads, NativeClientLooseFiles,
              NativeBsdStringCopy, NativeReadOnlyClientDirectories, NativeLibcppStringSpanAppend,
              NativeAsciiCaseSearch, NativeLocaleCaseConversion, NativeActorServiceSlices,
              NativeNavgridCollisionArena, NativeArchiveSizedArena, NativeNavgridStream, NativeHeroStackProbe,
              runtime_module.NativeInstalledParticleResources):
    pass


class Control(NativeRecordedHeroInputs, NativePristineBlockCache, NativeSpawn):
    pass


def producer_paths(native):
    functions = [initialize_hero_client_types, initialize_ai_material_owner_type, initialize_unit_collection,
                 configure_installed_skin_vertices, initialize_ai_unit_manager, initialize_binary_resource_cache,
                 initialize_visibility_component_registry,
                 register_resource_archive, load_installed_subchunks, initialize_linked_mode_provider,
                 initialize_mode_dependency_types, initialize_product_configuration, initialize_runtime_name_registry,
                 recover_startup_map_skin, initialize_recorded_participants, call_original_sliced,
                 prepare_scripts, load_manifest, initialize_shared_graphics_registries,
                 initialize_shared_constant_types, initialize_shared_constant_inputs,
                 initialize_animation_repository, initialize_appearance_factory, initialize_audio_emitter_service,
                 initialize_locale_configuration, initialize_relative_team_colors,
                 initialize_navgrid_collision_provider, initialize_unit_key_value_service,
                 initialize_unit_category_module, initialize_unit_pointer_registry,
                 initialize_effect_callback_manager, initialize_local_controller,
                 initialize_global_resource_collection]
    return {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
            *resource_publication_trace_sources(),
            Path(xxhash._xxhash.__file__),
            Path(__file__).with_name('observe-map-asset-links.py'),
            Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsMeshDevice)),
            Path(inspect.getfile(GraphicsShaderCatalog)), Path(inspect.getfile(GraphicsPipelineDevice)),
            Path(inspect.getfile(GraphicsMaterialBindings)), Path(inspect.getfile(NativeAssetWaitDispatch)),
            Path(inspect.getfile(NativeUnitResources)),
            *[Path(__file__).with_name(name) for name in ['render-particle-shader.py', 'observe-shader-angle.py',
                'graphics_block_texture_device.py', 'native_block_texture_upload.py']],
            *[Path(inspect.getfile(fn)) for fn in functions],
            *[Path(inspect.getfile(c)) for c in type(native).__mro__ if c not in [object, Control]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'installation']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--graphics', type=Path, required=True, help='Explicit ANGLE directory for the offscreen resource bridge')
    parser.add_argument('--shared-shaders', type=Path, required=True, help='Exact prepared shared shader package')
    parser.add_argument('--prepare-missing-shaders', action='store_true', help='Prepare exact missing static stages at original backend requests')
    parser.add_argument('--shader-compiler', type=Path, help='Pinned offline shader compiler workspace')
    parser.add_argument('--shader-preparer-bun', type=Path, help='Explicit Bun executable for static shader preparation')
    args = parser.parse_args()
    if args.prepare_missing_shaders != bool(args.shader_compiler and args.shader_preparer_bun):
        parser.error('Static shader preparation requires its flag and both explicit tools')
    if not args.prepare_missing_shaders and (args.shader_compiler or args.shader_preparer_bun):
        parser.error('Shader tools require --prepare-missing-shaders')
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in producer_paths(n)}
    corpus = fixture.read(fixture.cache / 'research/structural-corpus.json')
    observations = fixture.read(fixture.cache / 'research/structural-corpus-native.json')
    semantics = fixture.read(fixture.cache / 'research/latest-semantics-effects.json')
    if (corpus['build'] != n.profile['clientVersion'] or corpus['protocol'] != n.profile['protocolDigest'] or
            observations['decoderImageSha256'] != sha(n.image) or
            observations['constructorImageSha256'] != n.profile['constructorImageSha256'] or
            semantics['build'] != corpus['build'] or semantics['protocol'] != corpus['protocol']):
        raise ValueError('Exact-build recorded hero input and decoded native object required')
    selected = [(key, sample) for key, sample in corpus['packets'].items()
                if sample['opcode'] == 1049 and sample['time'] == 0]
    if len(selected) != 1:
        raise ValueError('One initial recorded hero sample is required by this control')
    key, sample = selected[0]
    observation = observations['observations'][key]
    if (sample['stream'] != 2 or sample['param'] != 0 or observation['status'] != 'complete' or
            observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex']))):
        raise ValueError('Initial hero packet framing or decoded payload differs')
    packet, heap = bytes.fromhex(observation['object']), bytes.fromhex(observation['heap'])
    if len(packet) != 120 or heap[:120] != packet or not 120 <= len(heap) <= 0x100000:
        raise ValueError('Recorded hero object/heap escaped its native packet arena')
    codec_path = fixture.cache / 'public/decoder-16.21-macos/field-codecs.json'
    codec_bytes = fixture.raw(codec_path)
    codecs = json.loads(codec_bytes)
    if (sha(codec_bytes) != n.profile['fieldCodecsSha256'] or
            codecs['decoderImageSha256'] != sha(n.image) or
            codecs['protocolDigest'] != n.profile['protocolDigest']):
        raise ValueError('Pinned decoded hero identity field codecs required')

    def field(name, offset, count):
        codec = codecs['codecs'][name]
        columns = codec['decode']
        if (codec['bytes'] != count or len(columns) != count or
                any(len(column) != 256 or set(column) != set(range(256)) for column in columns)):
            raise ValueError('Recorded hero identity codec is not a byte permutation')
        return int.from_bytes(bytes(columns[lane][packet[offset + lane]] for lane in range(count)), 'little')

    entity_id, slot = field('heroNetworkId', 56, 4), field('heroSlot', 16, 1)
    text_pointer, text_length = struct.unpack_from('<QI', packet, 80)
    text_offset = text_pointer - 0x10200000
    if not 0 <= text_offset <= len(heap) - text_length or not 1 <= text_length <= 128:
        raise ValueError('Recorded hero character name escaped its decoded heap')
    character = heap[text_offset:text_offset + text_length].decode('ascii')
    if not character or any(not (ch.isalnum() or ch == '_') for ch in character):
        raise ValueError('Recorded hero character name is not an asset identifier')
    candidates = [value for value in semantics['heroes'] if value['entityId'] == entity_id and
                  value['slot'] == slot and value['champion'] == character]
    if len(candidates) != 1:
        raise ValueError('Recorded hero packet does not match one decoded roster identity')
    hero = candidates[0]
    setup, boundary, unit = {}, None, None
    state = {'handlerEntered': False, 'handlerReturned': False, 'networkEntityVerified': False}
    phase = 'setup'
    hero_constructors, last_blocks = [], []
    world = None
    publication_trace, publication_snapshot = None, None
    try:
        publication_trace = install_resource_publication_trace(n)
        setup['physicalClientFiles'] = n.configure_client_loose_files(args.installation / 'Game')
        setup['platformEntropy'] = n.configure_random_device_inputs('host-os-entropy')
        setup['machSemaphorePlatform'] = n.initialize_mach_semaphore_platform()
        if args.prepare_missing_shaders:
            setup['shaderPreparation'] = n.configure_shader_preparation(
                fixture, args.installation, args.shader_compiler, args.shader_preparer_bun)
        # The recovered spatial singleton adds an owned 16 MiB bucket vector.
        # Keep explicit bounded capacity beyond the observed asset high-water.
        setup['arena'] = n.initialize_asset_arena(128)
        setup['unitCategoryModule'] = initialize_unit_category_module(n)
        setup['audio'] = n.initialize_audio_facade()
        setup['ui'] = n.initialize_ui_data_prefix()
        setup['product'] = initialize_product_configuration(n, 'LoL')
        setup['locale'] = initialize_locale_configuration(n)
        setup['characterTypes'] = n.initialize_character_types()
        setup['modeDependencyTypes'] = initialize_mode_dependency_types(n)
        setup['aiMaterialOwnerType'] = initialize_ai_material_owner_type(n)
        setup['heroClientTypes'] = initialize_hero_client_types(n, reuse_existing=True)
        setup['installedSkinnedVertexInputs'] = configure_installed_skin_vertices(fixture, args.installation, hero)
        setup['recordedMapInput'] = recover_startup_map_skin(n, fixture.cache, fixture.root, fixture.read, fixture.raw)
        setup['participants'] = initialize_recorded_participants(fixture, setup['recordedMapInput'])
        setup['names'] = initialize_runtime_name_registry(n)
        phase = 'mode-assets'
        observer = runpy.run_path(str(Path(__file__).with_name('observe-map-asset-links.py')))['observe_map_assets']
        setup['mapAssets'] = observer(fixture, setup['recordedMapInput']['variant'],
                                      additional_roots=[fixture.reference['selectedIdentity']])
        setup['modeProvider'] = initialize_linked_mode_provider(n, setup['mapAssets'], fixture.reference)
        phase = 'world-services'
        setup['sharedConstantTypes'] = initialize_shared_constant_types(n)
        setup['scripts'] = prepare_scripts(fixture, args.installation)
        setup['scriptVM'] = n.initialize_character_script_vm()
        setup['scriptManifest'] = load_manifest(fixture, setup['scripts'])
        setup['globalResourceCollection'] = initialize_global_resource_collection(n)
        setup['spellPreloads'] = n.initialize_spell_preload_manager()
        setup['scriptProviders'] = n.initialize_module_providers()
        setup['aiUnitManager'] = initialize_ai_unit_manager(n)
        setup['unitCollection'] = initialize_unit_collection(n)
        setup['visibilityComponentRegistry'] = initialize_visibility_component_registry(n)
        setup['networkRegistry'] = initialize_ai_network_registry(n)
        setup['relativeTeamColors'] = initialize_relative_team_colors(n)
        setup['archives'] = []
        for name in ['DATA.wad.client', 'Global.wad.client', 'Bootstrap.windows.wad.client',
                     f"Champions/{hero['champion']}.wad.client",
                     f"Champions/{hero['champion']}.{setup['locale']['archiveLocale']}.wad.client"]:
            archive = register_resource_archive(fixture, args.installation, name)
            path = Path(archive['path'])
            archive['subchunks'] = load_installed_subchunks(fixture, args.installation, path,
                                                           archive['archive'], fixture.raw(path))
            setup['archives'].append(archive)
        setup['binaryCache'] = initialize_binary_resource_cache(n)
        setup['binaryTLS'] = initialize_binary_postload_tls(n)
        setup['catalog'] = initialize_champion_catalog(n)
        for name in ['libEGL.dll', 'libGLESv2.dll']:
            fixture.raw(args.graphics / name)
        for path in [Image.__file__, Image.core.__file__]:
            fixture.raw(Path(path))
        setup['graphics'] = n.initialize_character_graphics(args.graphics)
        setup['sharedGraphics'] = initialize_shared_graphics_registries(n, args.shared_shaders)
        setup['effectPreloads'] = n.initialize_effect_preload_components(2, False)
        setup['assetQueue'] = n.initialize_asset_work_queue()
        setup['assetCompletionDispatcher'] = n.initialize_asset_completion_dispatcher(1)
        print(json.dumps({'phase': 'shared-constants'}), flush=True)
        setup['sharedConstants'] = initialize_shared_constant_inputs(n)
        setup['materialUniformInterface'] = n.initialize_material_uniform_updates()
        setup['animationRepository'] = initialize_animation_repository(n)
        setup['unitPointerRegistry'] = initialize_unit_pointer_registry(n)
        setup['effectCallbackManager'] = initialize_effect_callback_manager(n, setup['recordedMapInput'])
        setup['localController'] = initialize_local_controller(n, policy=CONSTRUCTOR_WITHOUT_LOG_WORKERS)
        print(json.dumps({'phase': 'actor-service-start'}), flush=True)
        setup['actorCallbacks'] = initialize_actor_callback_service(n)
        setup['navgridCollision'] = initialize_navgrid_collision_provider(n)
        setup['navgrid'] = initialize_navgrid_world(fixture, owner_context=setup['navgridCollision']['provider'])
        setup['unitKeyValues'] = initialize_unit_key_value_service(n)
        setup['appearanceFactory'] = initialize_appearance_factory(n, world_runtime=True)
        world = setup['appearanceFactory']['worldRegistry']['object']
        if n.q(n.base + 0x24722c0) != world or n.u32(world + 0x14) or n.q(world + 0x48):
            raise ValueError('Original recorded hero consumer requires an empty published world')
        setup['world'] = {'object': world, 'constructorRva': 0x54a4d0}
        setup['audioEmitters'] = initialize_audio_emitter_service(n)

        def constructed(engine, address, size, user):
            if len(hero_constructors) >= 16:
                raise ValueError('Initial recorded hero exceeded the bounded constructor trace')
            pointer = engine.reg_read(r.UC_X86_REG_RDI)
            hero_constructors.append({'unit': pointer, 'allocationBytes': n.allocations.get(pointer)})

        def remember(engine, address, size, user):
            last_blocks.append({'rva': address - n.base, 'size': size})
            if len(last_blocks) > 64:
                del last_blocks[0]

        n.u.hook_add(unicorn.UC_HOOK_CODE, constructed, begin=n.base + 0x154c10, end=n.base + 0x154c10)
        n.u.hook_add(unicorn.UC_HOOK_BLOCK, remember, begin=n.base, end=n.base + len(n.image) - 1)
        n.u.mem_write(0x10200000, heap)
        phase = 'recorded-hero-handler'
        state['handlerEntered'] = True
        state['execution'] = {}
        scheduler = NativeAssetWaitDispatch(n)
        state['assetDispatch'] = {'waits': scheduler.waits, 'cpuRuns': scheduler.runs,
                                 'cooperativeSingleContext': True, 'osWorkerThreadsCreated': False,
                                 'readinessFieldsSupplied': False}
        try:
            call_original_sliced(n, 0x6e8f40, {r.UC_X86_REG_RDI: 0, r.UC_X86_REG_RSI: 0x10200000},
                state['execution'], execute_slice=scheduler.run,
                on_slice=lambda row: print(json.dumps({'phase': 'hero-handler', **row}), flush=True))
        finally:
            scheduler.close()
        state['handlerReturned'] = True
        phase = 'created-entity-verification'
        n.call(0x548f00, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: hero['entityId']})
        unit = n.u.reg_read(r.UC_X86_REG_RAX)
        if (not unit or n.q(unit + 0xe8) != world or n.u32(unit + 0x78) != hero['entityId'] or
                not any(row['unit'] == unit for row in hero_constructors)):
            raise ValueError('Recorded hero handler did not establish its owned active network entity')
        setup['createdTypeRoute'] = verify_hero_client_cast(n, unit)
        state['networkEntityVerified'] = True
        phase = 'live-unit-resource-inspection'
        before, heap_before = bytes(n.u.mem_read(unit, 0x49a0)), n.next_heap
        n.call(0x377260, {r.UC_X86_REG_RDI: unit + 0x10})
        group = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.next_heap != heap_before or bytes(n.u.mem_read(unit, 0x49a0)) != before:
            raise ValueError('Original resource-component getter mutated its accepted unit')
        if n.allocations.get(group) != 0x30:
            raise ValueError('Accepted unit has no owned original resource component')
        begin, end = n.q(group + 0x18), n.q(group + 0x20)
        if end < begin or (end - begin) % 8 or end - begin > 32768 or (end > begin and not n.library_pointer(begin, end - begin)):
            raise ValueError('Accepted unit overlay vector escaped owned bounds')
        base = n.q(group + 0x10)
        overlays = [n.q(at) for at in range(begin, end, 8)]
        maps, keys = [], set()
        for pointer in dict.fromkeys([base, *overlays]):
            if not pointer:
                continue
            if not n.library_pointer(pointer, 24):
                raise ValueError('Accepted unit resolver escaped owned memory')
            rows, count = n.q(pointer + 8), n.u32(pointer + 0x10)
            if count > 65536 or count and not n.library_pointer(rows, count * 16):
                raise ValueError('Accepted unit resolver rows escaped owned memory')
            entries = [{'key': n.u32(rows + i * 16), 'value': n.q(rows + i * 16 + 8)} for i in range(count)]
            maps.append({'object': pointer, 'headerHex': bytes(n.u.mem_read(pointer, 24)).hex(), 'rows': entries})
            keys.update(entry['key'] for entry in entries if entry['key'])
        n.unit_resources = {unit: group}
        state['resourceView'] = {'group': group, 'base': base, 'overlays': overlays,
                                 'context': n.q(unit + 0x110), 'maps': maps,
                                 'queries': [{'key': key, **NativeUnitResources.resolve(n, key, [unit], [])}
                                             for key in sorted(keys)],
                                 'originalComponentGetterReadOnly': True,
                                 'matchAppearanceReadinessVerified': False}
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'phase': phase,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    'registers': {key: n.u.reg_read(getattr(r, 'UC_X86_REG_' + key.upper()))
                                  for key in ['rax', 'rbx', 'rcx', 'rdx', 'rdi', 'rsi', 'rbp', 'rsp']},
                    'lastBlocks': last_blocks}
        boundary['stackHex'] = bytes(n.u.mem_read(boundary['registers']['rsp'], 128)).hex()
    finally:
        if publication_trace is not None:
            publication_snapshot = publication_trace.snapshot()
            publication_trace.close()
        n.close_files()
        if n.shader_catalog is not None:
            for path, digest in n.shader_catalog.inputs.items():
                if sha(fixture.raw(Path(path))) != digest:
                    raise ValueError('Recorded hero shader input changed during its native call')
        if n.device is not None:
            n.close_graphics()
    if world is not None and bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Recorded hero consumer escaped the guarded world allocation')
    unit_snapshots = [{'unit': row['unit'], 'bytesHex': bytes(n.u.mem_read(row['unit'], 0x49a0)).hex()}
                      for row in hero_constructors if n.allocations.get(row['unit']) == 0x49a0]
    physical_files = n.validate_client_loose_files()
    if {str(path.resolve()) for path in producer_paths(n)} != set(sources):
        raise ValueError('Recorded hero producer graph changed during execution')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Recorded hero producer changed during execution: ' + path)
    result = {'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'packetKey': key, 'packetPayloadSha256': observation['payloadSha256'], 'decodedIdentity': hero,
              'setup': setup, 'state': state, 'heroConstructors': hero_constructors, 'unit': unit, 'boundary': boundary,
              'unitSnapshots': unit_snapshots,
              'resourcePublicationTrace': publication_snapshot,
              'physicalPresentationFiles': physical_files,
              'cooperativeThreads': n.cooperative_thread_summary(),
              'platformEntropyCalls': n.random_device_calls,
              'machSemaphores': n.mach_semaphore_summary(),
              'machSemaphoreScope': 'component-provider-only; asset and VFX counters have separate owners',
              'machSemaphoreCalls': n.mach_semaphore_calls,
              'localControllerLogQueueAccesses': getattr(n, 'local_controller_log_accesses', []),
              'assetArena': n.asset_arena, 'nativeCallbackCode': n.native_callback_code,
              'pristineBlockCache': n.pristine_block_cache_statistics(),
              'originalBlocks': list(n.blocks.values()),
              'archiveSizedAllocations': n.archive_sized_allocations,
              'actorServiceExecution': n.actor_service_execution,
              'shaderPreparationBatches': n.shader_preparation_batches,
              'expandedMaterialShaderInputs': n.expanded_material_shader_inputs,
              'materialUniformUpdates': getattr(n, 'material_uniform_updates', []),
              'skinnedVertexInputs': getattr(n, 'skinned_vertex_inputs', []),
              'graphicsResources': {'textures': n.gpu_records, 'fileRequests': n.file_requests,
                                    'assetQueue': n.asset_queue_state() if n.asset_work_queue is not None else None},
              'inputs': fixture.inputs, 'sources': {Path(path).name: digest for path, digest in sorted(sources.items())},
              'sourceFingerprintsCheckedBeforeAndAfterExecution': True,
              'scope': {'actualRecordedHeroPacket': True, 'networkIdSetterCalledByHost': False,
                        'unitConstructorCalledByHost': False, 'worldAdmissionCalledByHost': False,
                        'acceptedMatchAppearanceVerified': False, 'mainViewerExpanded': False,
                        'backgroundClientWorkerCodeExecuted': False, 'replayEntropyRecovered': False}}
    output = fixture.cache / 'research/recorded-hero-creation-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'state': state, 'heroConstructors': hero_constructors,
                      'boundary': boundary and {k: v for k, v in boundary.items() if k not in ['lastBlocks', 'stackHex']}}))
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
