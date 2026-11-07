"""Original animation-component registration over explicit static asset inputs.

This is a component control. Its typed resource link is supplied through the
original link instructions; resource selection, readiness and replay acceptance
are not established by that isolated link.
"""
import argparse
import inspect
import json
import runpy
from pathlib import Path
from unicorn import x86_const as r
from ai_hero_stack_native import NativeHeroStackProbe
from ai_hero_type_native import initialize_hero_client_types
from ai_material_owner_type_native import initialize_ai_material_owner_type
from shared_particle_resources_native import NativeSharedParticleResources
from index_buffer_native import NativeIndexBuffers
from character_graph_snapshot import restore
from libcpp_shared_native import NativeLibcppSharedOwnership
from native_ai_unit_fixture import NativeAIUnitFixture
from process_arguments_native import initialize_product_configuration
from mode_dependency_types_native import initialize_mode_dependency_types
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from original_call_slices_native import call_original_sliced
from bounded_asset_arena_native import NativeBoundedAssetArena
from archive_sized_arena_native import NativeArchiveSizedArena
from champion_catalog_native import initialize_binary_resource_cache, initialize_binary_postload_tls
from shared_constant_inputs_native import initialize_shared_constant_types, initialize_shared_constant_inputs
from asset_wait_dispatch_native import NativeAssetWaitDispatch
from shared_graphics_registries_native import initialize_shared_graphics_registries
from skinned_vertex_buffer_native import NativeSkinnedVertexBuffers
from static_material_postload_native import postload_supplied_static_materials
from shader_package_preparation_native import shader_preparation_config, prepare_native_shader_path
from material_shader_defines_native import NativeMaterialShaderDefines
from material_uniform_update_native import NativeMaterialUniformUpdates
from hero_root_component_producer_native import construct_supplied_hero_component
from animation_graph_preparation_native import initialize_animation_repository, prepare_animation_graph
from audio_emitter_service_native import initialize_audio_emitter_service
from vfx_spawn_native import sha


MainControl = runpy.run_path(str(Path(__file__).with_name('probe-recorded-hero-creation.py')))['Control']


class Control(MainControl):
    pass


def class_source(cls):
    # run_path classes do not have an importable module for inspect.getfile.
    # Their own methods still retain the exact original source filename.
    try:
        return Path(inspect.getfile(cls))
    except TypeError:
        if cls.__module__ == '<run_path>':
            return Path(__file__).with_name('probe-recorded-hero-creation.py')
        for value in vars(cls).values():
            function = value.__func__ if isinstance(value, (staticmethod, classmethod)) else value
            if hasattr(function, '__code__'):
                return Path(function.__code__.co_filename)
        raise ValueError('Native producer class has no identifiable source: '+cls.__name__)


def producer_paths(n):
    functions = [initialize_hero_client_types, initialize_ai_material_owner_type, initialize_mode_dependency_types,
                 initialize_product_configuration, call_original_sliced,
                 initialize_shared_constant_inputs, initialize_shared_constant_types,
                 initialize_binary_resource_cache, initialize_binary_postload_tls,
                 initialize_shared_graphics_registries, register_resource_archive,
                 load_installed_subchunks, postload_supplied_static_materials,
                 shader_preparation_config, prepare_native_shader_path, construct_supplied_hero_component,
                 initialize_animation_repository, prepare_animation_graph, initialize_audio_emitter_service, restore]
    graphics_sources = ['graphics_shader_catalog.py','graphics_mesh_device.py','graphics_mesh_attributes.py',
                        'graphics_texture_device.py','graphics_pipeline_device.py','graphics_material_bindings.py',
                        'render-particle-shader.py','observe-shader-angle.py','graphics_block_texture_device.py',
                        'native_block_texture_upload.py','shader_permutation.py']
    return {Path(__file__), Path(__file__).with_name('probe-recorded-hero-creation.py'),
            *[Path(__file__).with_name(name) for name in graphics_sources],
            class_source(NativeAIUnitFixture), class_source(NativeAssetWaitDispatch),
            *[Path(inspect.getfile(fn)) for fn in functions],
            *[class_source(c) for c in type(n).__mro__ if c is not object]}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    p.add_argument('--angle', required=True, type=Path)
    p.add_argument('--installation', required=True, type=Path)
    p.add_argument('--shared-shaders', required=True, type=Path)
    p.add_argument('--material-preflight-only', action='store_true')
    p.add_argument('--shader-compiler', type=Path)
    p.add_argument('--shader-preparer-bun', type=Path)
    args = p.parse_args()
    if bool(args.shader_compiler) != bool(args.shader_preparer_bun):
        raise ValueError('Static shader compiler and Bun must be supplied together')
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in producer_paths(n)}
    skinned_inputs = n.configure_skinned_vertex_inputs([
        fixture.raw(fixture.cache / 'public/latest-scene/champions/viego/43/model.skn')])
    actor = 'champions/viego/43'
    stem = actor.replace('/', '-')
    reference = fixture.read(fixture.cache / 'research' / f'character-asset-postload-{stem}-types-23ea1915-45cd899f-9b67e9f6-ef3a0f33-f5fb07c7-native.json')
    graph = fixture.read(fixture.cache / 'research' / f'character-asset-links-{stem}-native.json')
    for report in [reference, graph]:
        if report['actorKey'] != actor or report['decoderImageSha256'] != sha(n.image):
            raise ValueError('Exact static character control required')
        for path, digest in report['inputs'].items():
            if sha(fixture.raw(Path(path))) != digest:
                raise ValueError('Character component input changed: '+path)
        for name, digest in report['sources'].items():
            if sha(fixture.raw(fixture.root / 'tools' / name)) != digest:
                raise ValueError('Character component producer changed: '+name)
    if not reference['scope']['completeSuppliedStage'] or reference['scope']['assetReadinessVerified'] or graph['boundaries']:
        raise ValueError('Completed static graph with explicit readiness omission required')
    restore(fixture, reference['snapshot'])
    arena = n.initialize_asset_arena(32)
    skin_cases = [case for case in graph['cases'] if case['typeHash'] == 0x9b67e9f6]
    if len(skin_cases) != 1:
        raise ValueError('One explicit typed SkinCharacterDataProperties control required')
    skin = skin_cases[0]['loaded']['object']
    n.initialize_audio_facade()
    audio_emitters = initialize_audio_emitter_service(n)
    n.initialize_ui_data_prefix()
    initialize_product_configuration(n, 'LoL')
    initialize_mode_dependency_types(n)
    material_owner_type = initialize_ai_material_owner_type(n)
    initialize_hero_client_types(n, reuse_existing=True)
    graphics = n.initialize_character_graphics(args.angle)
    shared_graphics = initialize_shared_graphics_registries(n, args.shared_shaders)
    if args.shader_compiler:
        n.configure_shader_preparation(fixture,args.installation,args.shader_compiler,args.shader_preparer_bun)
    archives = []
    for name in ['DATA.wad.client', 'Global.wad.client', 'Bootstrap.windows.wad.client', 'Champions/Viego.wad.client']:
        archive = register_resource_archive(fixture, args.installation, name)
        load_installed_subchunks(fixture, args.installation, Path(archive['path']), archive['archive'],
                                 fixture.raw(Path(archive['path'])))
        archives.append(archive)
    if not n.q(n.base + 0x247b830):
        initialize_binary_resource_cache(n)
    initialize_binary_postload_tls(n)
    if not all(key in n.types for key in [0x525cc130, 0x0125d45c, 0x95ef430a, 0x344a9a75]):
        initialize_shared_constant_types(n)
    asset_queue = n.initialize_asset_work_queue()
    completion_dispatcher = n.initialize_asset_completion_dispatcher(1)
    scheduler = NativeAssetWaitDispatch(n)
    try:
        shader_definitions = postload_supplied_static_materials(n, graph, scheduler, 0x205255d6)
        print(json.dumps({'phase':'custom-shader-postload','roots':len(shader_definitions['roots'])}),flush=True)
        static_materials = postload_supplied_static_materials(n, graph, scheduler)
    except Exception as error:
        registers = {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name.upper())) for name in ['rip','rax','rbx','rcx','rdx','rdi','rsi','r8','r9','rsp','rbp']}
        record = {'schema':1,'kind':'original-hero-animation-component-registration-control',
                  'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],
                  'decoderImageSha256':sha(n.image),'completed':False,'phase':'static-material-preflight',
                  'boundary':{'kind':type(error).__name__,'message':str(error),'registers':registers,
                              'memory':{name:bytes(n.u.mem_read(value,128)).hex() for name,value in registers.items()
                                        if n.library_pointer(value,128)}},
                  'inputs':fixture.inputs,'sources':sources,
                  'scope':{'fullOriginalComponentConstructorAndRegistration':False,
                           'suppliedStaticResourceLink':True,'resourceSelectionRecovered':False,
                           'assetReadinessEstablished':False,'acceptedReplayEntities':False}}
        (fixture.cache/'research/hero-root-component-native.json').write_text(json.dumps(record,separators=(',',':')),encoding='utf-8')
        print(json.dumps(record['boundary']),flush=True)
        raise
    print(json.dumps({'phase':'static-material-postload','roots':len(static_materials['roots'])}),flush=True)
    if args.material_preflight_only:
        print(json.dumps({'phase':'static-material-preflight-only','completed':True}),flush=True)
        n.close_files();n.close_graphics()
        return
    constants = initialize_shared_constant_inputs(n)
    material_uniform_interface = n.initialize_material_uniform_updates()
    animation_repository = initialize_animation_repository(n)
    n.animation_graph_preparations = []
    for root in graph['cases']:
        if root['typeHash'] == 0xf5fb07c7:
            prepare_animation_graph(n,root['loaded']['object'])
    unit = n.allocate(0x4aa0)
    n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    world = n.allocate(0x168)
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    n.call(0x14c3790, {r.UC_X86_REG_RDI: unit + 0x40, r.UC_X86_REG_RSI: n.allocate_text('Viego')})
    resource = n.allocate(0x170)
    n.call(0x2a6000, {r.UC_X86_REG_RDI: resource})
    context = n.character_context('Viego', 43)
    n.call(0x2a69b3, {r.UC_X86_REG_RBX: resource, r.UC_X86_REG_RAX: context['object']}, 0x2a69b7)
    # Validate the supplied raw static object with the original dynamic cast,
    # then execute the original resource link. No host writes to resource+40.
    n.call(0x14b6400, {r.UC_X86_REG_RDI: n.types[0x9b67e9f6], r.UC_X86_REG_RSI: skin,
                       r.UC_X86_REG_RDX: n.types[0x9b67e9f6]})
    if n.u.reg_read(r.UC_X86_REG_RAX) != skin:
        raise ValueError('Original cast did not recover supplied static skin')
    n.call(0x2a766f, {r.UC_X86_REG_RAX: skin, r.UC_X86_REG_RBX: resource}, 0x2a7677)
    handle = n.allocate(8)
    n.put(handle, 'Q', resource)
    n.call(n.q(n.q(unit + 0x10) + 0x10) - n.base, {r.UC_X86_REG_RDI: unit + 0x10})
    registry = n.u.reg_read(r.UC_X86_REG_RAX)
    before = n.u32(registry + 8)
    execution = {}
    try:
        component = construct_supplied_hero_component(n,scheduler,unit,handle,execution,
            on_slice=lambda row: print(json.dumps({'phase':'component-producer',**row}),flush=True))
    except Exception:
        registers = {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name.upper())) for name in ['rip', 'rax', 'rdi', 'rsi', 'rdx', 'rbx', 'rsp', 'r14', 'r15']}
        memory = {}
        for name, pointer in registers.items():
            if name == 'rip' or not pointer:
                continue
            try:
                memory[name] = bytes(n.u.mem_read(pointer, 128)).hex()
            except Exception:
                pass
        print(json.dumps({'boundary': registers, 'memory': memory}))
        output = fixture.cache / 'research/hero-root-component-native.json'
        output.write_text(json.dumps({'schema': 1, 'kind': 'original-hero-animation-component-registration-control',
          'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
          'decoderImageSha256': sha(n.image), 'completed': False, 'phase':'component-producer', 'execution': execution,
          'boundary': registers, 'boundaryMemory': memory, 'inputs': fixture.inputs,
          'sources': sources,
          'scope': {'fullOriginalComponentConstructorAndRegistration': False,
                    'suppliedStaticResourceLink': True, 'resourceSelectionRecovered': False,
                    'assetReadinessEstablished': False, 'acceptedReplayEntities': False,
                    'matchTransformsRecovered': False, 'mainViewerExpanded': False}}, separators=(',', ':')), encoding='utf-8')
        raise
    shared = n.allocate(16)
    n.call(0x54f630, {r.UC_X86_REG_RDI: shared, r.UC_X86_REG_RSI: unit, r.UC_X86_REG_RDX: 0})
    provider = n.q(shared)
    if n.q(provider) != n.base+0x2336b28 or n.u32(provider+0x30) != 0:
        raise ValueError('Original source factory did not retain concrete Hero key-zero provider')
    n.call(0x54e420, {r.UC_X86_REG_RDI: provider})
    selected = n.u.reg_read(r.UC_X86_REG_RAX)
    if selected != component or n.q(component + 0x18) != unit or n.u32(registry + 8) != before + 1:
        raise ValueError('Original animation-component registration/provider selection differs')
    output = n.allocate(32)
    positions = [[1096, -106, 1180], [8001.25, 4.5, 12999.75]]
    cases = []
    import struct
    for position in positions:
        n.put(unit + 0x15c, '3f', *position)
        n.u.mem_write(output, b'\xa5' * 32)
        n.call(0x54e2c0, {r.UC_X86_REG_RDI: provider, r.UC_X86_REG_RSI: output})
        actual = bytes(n.u.mem_read(output, 12))
        if n.u.reg_read(r.UC_X86_REG_RAX) & 255 != 1 or actual != struct.pack('<3f', *position):
            raise ValueError('Registered original provider did not recover Hero root position')
        if bytes(n.u.mem_read(output + 12, 20)) != b'\xa5' * 20:
            raise ValueError('Registered original provider escaped supplied output')
        cases.append({'position': position, 'positionHex': actual.hex()})
    if bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original component registration escaped its Hero allocation')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Native component source changed: '+path)
    for path, digest in n.shader_catalog.inputs.items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Native component shader input changed: '+path)
    result = {'schema': 1, 'kind': 'original-hero-animation-component-registration-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'actorControl': actor, 'unit': unit,
              'graphics': graphics, 'sharedGraphics': shared_graphics, 'archives': archives, 'arena': arena, 'constants': constants,
              'assetQueue': asset_queue, 'completionDispatcher': completion_dispatcher,
              'staticMaterials':static_materials,
              'shaderDefinitions':shader_definitions,'shaderPreparationBatches':n.shader_preparation_batches,
              'expandedMaterialShaderInputs':n.expanded_material_shader_inputs,
              'animationRepository':animation_repository,'animationGraphs':n.animation_graph_preparations,
              'audioEmitterService':audio_emitters,
              'materialOwnerRuntimeType':material_owner_type,
              'materialUniformInterface':material_uniform_interface,
              'materialUniformUpdates':n.material_uniform_updates,
              'assetDispatch': {'waits': scheduler.waits, 'runs': scheduler.runs},
              'execution': execution, 'completed': True,
              'skinnedInputs': skinned_inputs,
              'meshBuffers': [{key:value for key,value in row.items() if key != 'bytesHex'}
                              for row in n.mesh_backend.buffer_records],
              'sourceBlocks': [{'rva':a,'size':b-a,'sha256':sha(n.image[a:b])} for a,b in
                               [(0x1303c0,0x1304b0),(0x185acd7,0x185ad06),(0x1917a40,0x1917a70),
                                (0x54e2c0,0x54e420),(0x10673c,0x106779)]],
              'component': component, 'provider': provider, 'registryCountBefore': before,
              'registryCountAfter': n.u32(registry+8), 'cases': cases,
              'inputs': fixture.inputs, 'sources': sources,
              'scope': {'fullOriginalComponentConstructorAndRegistration': True,
                        'originalProducerAndEncodedHeroPublicationPrefix': True,
                        'fullAppearanceCallbackAccepted': False,
                        'originalSourceProviderFactoryAndLookup': True,
                        'originalConcreteHeroPositionProvider': True,
                        'suppliedStaticResourceLink': True, 'resourceSelectionRecovered': False,
                        'assetReadinessEstablished': False, 'acceptedReplayEntities': False,
                        'matchTransformsRecovered': False, 'mainViewerExpanded': False}}
    output_path = fixture.cache / 'research/hero-root-component-native.json'
    output_path.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output_path), 'cases': len(cases), 'component': component}))


if __name__ == '__main__':
    main()
