"""Observe actual AI appearance callbacks with supplied typed asset pointers.

This is a cold AI-base control, not an accepted hero or live match. The caller
supplies a cache key and typed character/skin objects. No readiness bit, unit
callback or world route is substituted.
"""
import argparse
import inspect
import json
import runpy
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from character_postload_native import NativeCharacterPostload
from ai_client_native import NativeAIClientInputs
from wad_file_native import NativeWadFiles
from installed_scripts_native import prepare_scripts
from character_script_native import NativeCharacterScripts
from spell_preload_native import NativeSpellPreload
from character_graphics_native import NativeCharacterGraphics
from graphics_texture_device import GraphicsTextureDevice
from graphics_mesh_device import GraphicsMeshDevice
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_mesh_native import NativeVfxMeshContext
from spell_preload_trace import observe_preloads
from script_manifest_native import load_manifest
from libcpp_string_native import assign_c_string
from module_provider_native import NativeModuleProviders
from effect_preload_native import NativeEffectPreload
from legacy_effect_native import NativeLegacyEffectInputs
from installed_resource_archive_native import register_resource_archive
from archive_subchunks_native import load_installed_subchunks
from appearance_projection_native import project_appearance
from startup_map_skin_native import recover_startup_map_skin
from startup_participants_native import initialize_recorded_participants
from runtime_name_registry_native import initialize_runtime_name_registry,inspect_runtime_name_registry
from shared_particle_resources_native import NativeSharedParticleResources
from asset_work_queue_native import NativeAssetWorkQueue
from aligned_asset_memory_native import AlignedAssetMemory
from libcpp_concat_native import LibcppConcat
from libc_width_format_native import LibcWidthFormatting
from index_buffer_native import NativeIndexBuffers
from animation_graph_preparation_native import initialize_animation_repository,prepare_animation_graph
from animation_repository_inspection_native import inspect_animation_repository
from appearance_factory_native import initialize_appearance_factory
from ai_world_registration_native import register_control
from process_arguments_native import initialize_product_configuration
from bounded_asset_arena_native import NativeBoundedAssetArena
from audio_emitter_service_native import initialize_audio_emitter_service,inspect_audio_emitter_registry
from appearance_asset_dispatch_native import project_appearance_with_asset_dispatch
from asset_wait_dispatch_native import NativeAssetWaitDispatch
from serialized_asset_progress_native import observe_serialized_asset_progress
from asset_callback_slices_native import NativeAssetCallbackSlices
from libcpp_shared_native import NativeLibcppSharedOwnership
from libc_sprintf_native import NativeLibcSprintf
from libc_ascii_compare_native import NativeAsciiCaseCompare
from libm_texture_native import NativeTextureLog2
from shader_package_preparation_native import NativeShaderPackagePreparation
from shared_constant_inputs_native import initialize_shared_constant_types,initialize_shared_constant_inputs
from champion_catalog_native import initialize_binary_resource_cache,initialize_binary_postload_tls,initialize_champion_catalog
from PIL import Image
from shared_graphics_registries_native import initialize_shared_graphics_registries
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from vfx_pipeline_native import NativeVfxPipelineContext
from vfx_object_native import NativeVfxObjects
from vfx_resource_native import NativeVfxResourceContext
from effect_preload_trace import observe_effect_preloads
from effect_context_native import NativeEffectContexts
from unit_resource_native import NativeUnitResources
from character_graph_snapshot import restore
from vfx_spawn_native import sha,name_hash

TYPES = [0x23ea1915,0x45cd899f,0x9b67e9f6,0xef3a0f33,0xf5fb07c7]


class NativeInstalledParticleResources(NativeTextureLog2,NativeBoundedAssetArena,NativeShaderPackagePreparation,NativeAsciiCaseCompare,NativeLibcSprintf,NativeLibcppSharedOwnership,NativeAssetCallbackSlices,NativeIndexBuffers,LibcWidthFormatting,LibcppConcat,AlignedAssetMemory,NativeAssetWorkQueue):pass


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache',type=Path)
    p.add_argument('client',type=Path)
    p.add_argument('--actor',required=True)
    p.add_argument('--output',type=Path,help='Explicit observation file; its parent must exist')
    p.add_argument('--unit-kind',choices=['base','client'],default='client')
    p.add_argument('--installation',type=Path,help='Register the matching installed Scripts WAD with original validation')
    p.add_argument('--script-runtime',action='store_true',help='Construct the original standalone character-script VM')
    p.add_argument('--spell-preload',action='store_true',help='Construct the original shared spell-preload manager')
    p.add_argument('--graphics',type=Path,help='Use the real GLES bridge from this explicit ANGLE DLL directory')
    p.add_argument('--script-registry',action='store_true',help='Load and compare the installed all_lua_files manifest with original code')
    p.add_argument('--module-providers',action='store_true',help='Construct the original shared source/bytecode module providers')
    p.add_argument('--effect-preload',action='store_true',help='Initialize original VFX manager data components without worker startup')
    p.add_argument('--effect-quality',type=int,choices=range(4))
    p.add_argument('--effect-graphics34b',type=int,choices=[0,1])
    p.add_argument('--resource-archive',action='append',default=[],help='Explicit installed DATA/FINAL archive mounted with original validation')
    p.add_argument('--map-variant',help='Supply the original Map12 context with this exact installed variant; not recovered replay state')
    p.add_argument('--recorded-map-variant',action='store_true',help='Recover the map-skin input and mode from the actual startup packet')
    p.add_argument('--shared-shaders',type=Path,help='Use the existing pipeline/material bridges and original shared graphics registries')
    p.add_argument('--asset-work-queue',action='store_true',help='Own original read/decode/callback dispatch without OS worker startup')
    p.add_argument('--champion-catalog',action='store_true',help='Construct the original installed champion/skin catalog before appearance loading')
    p.add_argument('--shared-constants',action='store_true',help='Read installed shared shader declarations and prepare original CPU layouts; backend publication remains separate')
    p.add_argument('--animation-graphs',action='store_true',help='Construct the original animation repository and execute original graph preparation before appearance')
    p.add_argument('--appearance-factory',action='store_true',help='Register the original runtime class requested by the current appearance control')
    p.add_argument('--appearance-world-runtime',action='store_true',help='Construct the original world registry, complete runtime static module and visibility configuration')
    p.add_argument('--register-control-unit',action='store_true',help='Admit the supplied cold AI client through the original local index; not replay entity acceptance')
    p.add_argument('--product',choices=['LoL','TFT'],help='Construct original product configuration from explicit supplied process arguments')
    p.add_argument('--asset-arena-mib',type=int,choices=[32,64,128],help='Bounded additional owned non-executable data arena for composite asset loading')
    p.add_argument('--audio-emitter-service',action='store_true',help='Construct and bind the original CPU emitter service without activating an audio device')
    p.add_argument('--cooperative-assets',action='store_true',help='Dispatch original queued asset work at synchronous resource waits with a separate guarded stack')
    p.add_argument('--recorded-participants',action='store_true',help='Initialize the original participant manager from the verified recorded startup packet')
    p.add_argument('--runtime-name-registry',action='store_true',help='Execute original startup construction of the named-record registry')
    p.add_argument('--prepare-missing-shaders',action='store_true',help='Prepare exact missing static shader paths at suspended backend requests, using separate package versions')
    p.add_argument('--shader-compiler',type=Path,help='Pinned offline shader compiler workspace for --prepare-missing-shaders')
    p.add_argument('--shader-preparer-bun',type=Path,help='Explicit Bun executable for --prepare-missing-shaders')
    args = p.parse_args()
    if args.script_runtime and not args.installation:
        p.error('--script-runtime requires --installation')
    if args.spell_preload and not args.script_runtime:
        p.error('--spell-preload requires --script-runtime')
    if args.graphics and not args.spell_preload:
        p.error('--graphics requires --spell-preload')
    if args.script_registry and not args.spell_preload:
        p.error('--script-registry requires --spell-preload')
    if args.module_providers and not (args.script_registry and args.graphics):
        p.error('--module-providers requires --script-registry and --graphics')
    if args.effect_preload and not (args.module_providers and args.effect_quality is not None and args.effect_graphics34b is not None):
        p.error('--effect-preload requires --module-providers and explicit effect quality/graphics34b inputs')
    if not args.effect_preload and (args.effect_quality is not None or args.effect_graphics34b is not None):
        p.error('Effect manager scalar inputs require --effect-preload')
    if args.map_variant and args.recorded_map_variant:p.error('Choose a supplied or recorded map variant, not both')
    if (args.resource_archive or args.map_variant or args.recorded_map_variant) and not args.effect_preload:
        p.error('Resource archives and map context controls require --effect-preload')
    if len(args.resource_archive) > 63 or len(set(name.casefold() for name in args.resource_archive)) != len(args.resource_archive):
        p.error('Resource archive selection must be unique and fit the native mount table')
    if args.shared_shaders and not (args.resource_archive and args.effect_preload and args.graphics):
        p.error('--shared-shaders requires installed resource archives, effect preloading and graphics')
    if args.asset_work_queue and not args.shared_shaders:p.error('--asset-work-queue requires --shared-shaders')
    if args.champion_catalog and not (args.asset_work_queue and any(name.casefold()=='global.wad.client' for name in args.resource_archive)):
        p.error('--champion-catalog requires --asset-work-queue and --resource-archive Global.wad.client')
    if args.shared_constants and not (args.asset_work_queue and {'global.wad.client','bootstrap.windows.wad.client'}<=set(name.casefold() for name in args.resource_archive)):
        p.error('--shared-constants requires --asset-work-queue and explicit Global.wad.client/Bootstrap.windows.wad.client archives')
    if args.animation_graphs and not args.asset_work_queue:p.error('--animation-graphs requires --asset-work-queue')
    if args.appearance_factory and not args.animation_graphs:p.error('--appearance-factory requires --animation-graphs')
    if args.appearance_world_runtime and not args.appearance_factory:p.error('--appearance-world-runtime requires --appearance-factory')
    if args.register_control_unit and not (args.appearance_world_runtime and args.unit_kind=='client'):
        p.error('--register-control-unit requires --appearance-world-runtime and --unit-kind client')
    if args.audio_emitter_service and not args.appearance_world_runtime:p.error('--audio-emitter-service requires --appearance-world-runtime')
    if args.audio_emitter_service and args.unit_kind!='client':p.error('--audio-emitter-service requires --unit-kind client')
    if args.cooperative_assets and not args.audio_emitter_service:p.error('--cooperative-assets requires --audio-emitter-service')
    if args.recorded_participants and not (args.recorded_map_variant and args.appearance_world_runtime and args.unit_kind=='client'):
        p.error('--recorded-participants requires --recorded-map-variant, --appearance-world-runtime and --unit-kind client')
    if args.runtime_name_registry and not args.recorded_participants:p.error('--runtime-name-registry requires --recorded-participants')
    installed_runtime = args.champion_catalog or args.shared_constants or args.animation_graphs
    if args.asset_arena_mib and not installed_runtime:
        p.error('--asset-arena-mib requires installed runtime asset composition')
    if args.prepare_missing_shaders and not (installed_runtime and args.shared_shaders and args.shader_compiler and args.shader_preparer_bun):
        p.error('--prepare-missing-shaders requires installed runtime assets, --shared-shaders, --shader-compiler and --shader-preparer-bun')
    if not args.prepare_missing_shaders and (args.shader_compiler or args.shader_preparer_bun):
        p.error('Shader preparation tools require --prepare-missing-shaders')
    native_class = NativeInstalledParticleResources if installed_runtime else NativeAssetWorkQueue if args.asset_work_queue else NativeSharedParticleResources if args.shared_shaders else NativeLegacyEffectInputs if args.resource_archive else NativeEffectPreload if args.effect_preload else NativeModuleProviders if args.module_providers else NativeCharacterGraphics if args.graphics else NativeSpellPreload if args.spell_preload else NativeCharacterScripts if args.script_runtime else NativeWadFiles if args.installation else NativeAIClientInputs
    fixture = NativeAIUnitFixture(args.cache,args.client,native_class)
    n,cache = fixture.native,fixture.cache
    shader_preparation=None
    if args.prepare_missing_shaders:
        shader_preparation=n.configure_shader_preparation(fixture,args.installation,args.shader_compiler,args.shader_preparer_bun)
    actor_stem = args.actor.replace('/','-')
    # Keep the expanded configuration's default filename below Windows path
    # limits. Existing configuration names remain available to older consumers.
    output = args.output.resolve() if args.output else cache/'research'/(
        'character-unit-callbacks-'+actor_stem+'-registered-native.json' if args.register_control_unit else
        'character-unit-callbacks-'+actor_stem+'-shader-native.json' if args.prepare_missing_shaders else
        'character-unit-callbacks-'+actor_stem+'-names-native.json' if args.runtime_name_registry else
        'character-unit-callbacks-'+actor_stem+'-participants-native.json' if args.recorded_participants else
        'character-unit-callbacks-'+actor_stem+'-dispatch-native.json' if args.cooperative_assets else
        'character-unit-callbacks-'+actor_stem+'-audio-native.json' if args.audio_emitter_service else
        'character-unit-callbacks-'+actor_stem+'-world-native.json' if args.appearance_world_runtime else
        'character-unit-callbacks-'+actor_stem+'-appearance-native.json' if args.appearance_factory else
        'character-unit-callbacks-'+actor_stem+'-animation-native.json' if args.animation_graphs else
        'character-unit-callbacks-'+actor_stem+('-base' if args.unit_kind == 'base' else '')+('-wad' if args.installation else '')+('-script' if args.script_runtime else '')+('-preload' if args.spell_preload else '')+('-registry' if args.script_registry else '')+('-modules' if args.module_providers else '')+('-effects' if args.effect_preload else '')+('-shared' if args.shared_shaders else '')+('-resources' if args.resource_archive else '')+('-map-recorded' if args.recorded_map_variant else '-map-'+args.map_variant.lower() if args.map_variant else '')+('-gpu' if args.graphics else '')+('-queue' if args.asset_work_queue else '')+('-catalog' if args.champion_catalog else '')+('-constants' if args.shared_constants else '')+'-native.json')
    if not output.parent.is_dir():raise ValueError('Observation output parent must already exist')
    if len(str(output))>=260:raise ValueError('Observation path exceeds the portable Windows limit; supply a shorter --output')
    suffix = '-types-'+'-'.join(format(identity,'08x') for identity in sorted(TYPES))
    postload = fixture.read(cache/'research'/('character-asset-postload-'+actor_stem+suffix+'-native.json'))
    graph = fixture.read(cache/'research'/('character-asset-links-'+actor_stem+'-native.json'))
    effects = fixture.read(cache/'public/latest-effects/manifest.json')
    if (postload['actorKey'] != args.actor or not postload['scope']['completeSuppliedStage'] or
            postload['scope']['assetReadinessVerified'] or not postload['snapshot'] or not graph['scope']['referenceLinksFixed']):
        raise ValueError('Matching explicit original post-load control required')
    for report in [graph,postload]:
        for path,digest in report['inputs'].items():
            if sha(fixture.raw(Path(path))) != digest:
                raise ValueError('Character callback input changed: '+path)
        for path,digest in report['sources'].items():
            if sha(fixture.raw(fixture.root/'tools'/path)) != digest:
                raise ValueError('Character callback producer changed: '+path)
    restore(fixture,postload['snapshot'])
    if args.asset_arena_mib:n.initialize_asset_arena(args.asset_arena_mib)
    product_configuration=initialize_product_configuration(n,args.product) if args.product else None
    map_assets = None
    startup_map_input = None
    recorded_participants = None
    runtime_name_initialization,runtime_name_registry = None,None
    if args.runtime_name_registry:runtime_name_initialization=initialize_runtime_name_registry(n)
    variant = args.map_variant
    if args.recorded_map_variant:
        startup_map_input = recover_startup_map_skin(n,cache,fixture.root,fixture.read,fixture.raw)
        if startup_map_input['mapId'] != 12:raise ValueError('Only the exact prepared Map12 graph is supported by this control')
        variant = startup_map_input['variant']
        if args.recorded_participants:recorded_participants=initialize_recorded_participants(fixture,startup_map_input)
    if variant:
        observe_map_assets = runpy.run_path(str(Path(__file__).with_name('observe-map-asset-links.py')))['observe_map_assets']
        map_assets = observe_map_assets(fixture,variant)
        if (not map_assets['scope']['referenceLinksFixed'] or map_assets['boundaries'] or
                not map_assets['mapSkinContext'] or not map_assets['mapSkinContext']['originalConstructorCompleted']):
            raise ValueError('Complete supplied typed Map graph and original skin context required')
    scripts,script_vm,spell_preload,graphics = None,None,None,None
    preload_requests = []
    script_registry = None
    module_providers = None
    effect_preload = None
    effect_requests = []
    resource_archives = []
    shared_graphics = None
    asset_queue,completion_dispatcher = None,None
    binary_cache,catalog,postload_tls = None,None,None
    shared_constant_types,shared_constants = None,None
    animation_repository,animation_resources,appearance_factory = None,None,None
    n.animation_graph_preparations = []
    if args.installation:
        try:
            if args.shared_constants:shared_constant_types = initialize_shared_constant_types(n)
            scripts = prepare_scripts(fixture,args.installation)
            for archive in args.resource_archive:
                resource_archives.append(register_resource_archive(fixture,args.installation,archive))
            if args.script_runtime:script_vm = n.initialize_character_script_vm()
            for archive in resource_archives:
                path = Path(archive['path'])
                archive['subchunks'] = load_installed_subchunks(fixture,args.installation,path,
                                                               archive['archive'],fixture.raw(path))
            if args.spell_preload:
                spell_preload = n.initialize_spell_preload_manager()
                preload_requests = observe_preloads(n)
            if args.script_registry:script_registry = load_manifest(fixture,scripts)
            if args.module_providers:module_providers = n.initialize_module_providers()
            if args.graphics:
                for name in ['libEGL.dll','libGLESv2.dll']:fixture.raw(args.graphics/name)
                if args.asset_work_queue:
                    for path in [Image.__file__,Image.core.__file__]:fixture.raw(Path(path))
                graphics = n.initialize_character_graphics(args.graphics)
            if args.shared_shaders:
                shared_graphics = initialize_shared_graphics_registries(n,args.shared_shaders)
            if args.effect_preload:
                effect_preload = n.initialize_effect_preload_components(args.effect_quality,bool(args.effect_graphics34b))
                effect_requests = observe_effect_preloads(n)
            if args.asset_work_queue:
                asset_queue = n.initialize_asset_work_queue()
                completion_dispatcher = n.initialize_asset_completion_dispatcher(1)
            if installed_runtime:
                binary_cache = initialize_binary_resource_cache(n)
                postload_tls = initialize_binary_postload_tls(n)
            if args.champion_catalog:
                catalog = initialize_champion_catalog(n)
                if any(n.q(row['cell'])!=row['initialValue'] for row in postload_tls['variables']):
                    raise ValueError('Original champion catalog did not restore its post-load thread variables')
            if args.shared_constants:shared_constants = initialize_shared_constant_inputs(n)
            if args.animation_graphs:
                animation_repository = initialize_animation_repository(n)
                animation_roots = [case for case in graph['cases'] if case['typeHash']==name_hash('AnimationGraphData')]
                if not 0<len(animation_roots)<=256:raise ValueError('Bounded supplied animation graph roots required')
                for case in animation_roots:
                    if case['identity'] not in postload['completedRoots']:
                        raise ValueError('Original animation graph preparation requires completed supplied root post-load')
                    prepare_animation_graph(n,case['loaded']['object'])
        except Exception:
            n.close_files()
            if args.graphics:n.close_graphics()
            raise
    actor = effects['actors'][args.actor]
    character_identity = name_hash('Characters/'+actor['character']+'/CharacterRecords/Root')
    skin_identity = name_hash('Characters/'+actor['character']+'/Skins/Skin'+str(actor['skinId']))
    by_id = {case['identity']:case for case in graph['cases']}
    character,skin = by_id[character_identity]['loaded'],by_id[skin_identity]['loaded']
    resolver_identity = int(actor['resourceResolverId'][1:-1],16)
    resolver = by_id[resolver_identity]['loaded']
    if resolver['typeHash'] != 0xef3a0f33 or resolver_identity not in postload['completedRoots']:
        raise ValueError('The exact actor resource map must have completed original post-load')
    if (character['typeHash'] != 0x23ea1915 or skin['typeHash'] != 0x9b67e9f6 or
            character_identity not in postload['completedRoots'] or skin_identity not in postload['completedRoots']):
        raise ValueError('Exact named character/skin roots must have completed original post-load')
    audio_facade,ui_prefix = None,None
    audio_emitter_service,audio_emitter_registry = None,None
    if args.unit_kind == 'client':
        audio_facade = n.initialize_audio_facade()
        if args.audio_emitter_service:audio_emitter_service=initialize_audio_emitter_service(n)
        ui_prefix = n.initialize_ui_data_prefix()
        unit = n.allocate(0x4100)
        n.u.mem_write(unit+0x4000,bytes([0xa5])*0x100)
        n.call(0xea3c0,{r.UC_X86_REG_RDI:unit})
        if n.q(unit)-n.base != 0x22ef3d0 or n.q(unit+0xb20)-n.base != 0x22f0918:
            raise ValueError('Original client AI interfaces differ')
        fixture.check_guard(unit)
    else:
        unit = fixture.construct_ai()
    context = n.character_context(actor['character'],actor['skinId'])
    resource_path = 'Characters/'+actor['character']+'/Skins/Skin'+str(actor['skinId'])+'/Resources'
    # Context registry IDs and resource-entry hashes are distinct identities.
    if name_hash(resource_path) != resolver_identity:
        raise ValueError('Original resource-path identity differs from the authored resolver')
    # Explicit prepared-context input. The full library loader/readiness path is
    # not bypassed or claimed; only the typed resolver pointer is supplied.
    n.put(context['object']+0x60,'Q',resolver['object'])
    cache_object = n.prepare_cache([{'name':actor['character'],'namespace':'','skinId':actor['skinId'],
                                    'keyFlags':0,'context':context['object']}])[0]['object']
    # These two prepared-cache inputs are original typed objects, not supplied
    # ready flags. Their complete graph and post-load provenance stays explicit.
    n.put(cache_object+0x28,'Q',character['object'])
    n.put(cache_object+0x40,'Q',skin['object'])
    fixture.initialize_default_storage(unit,actor['character'],actor['skinId'])
    trace = []
    addresses = {slot:n.q(n.q(unit+0xb28)+slot)-n.base for slot in [0x10,0x18,0x20,0x28,0x30,0x38,0x40,0x50]}
    for slot,address in addresses.items():
        if not 0 <= address < 0x1fef000:
            raise ValueError('Original unit callback is abstract or outside matching code')
        def observe(engine,at,size,user,slot=slot):
            receiver,argument = engine.reg_read(r.UC_X86_REG_RDI),engine.reg_read(r.UC_X86_REG_RSI)
            if receiver != unit+0xb28:
                raise ValueError('Appearance callback selected another receiver')
            trace.append({'slot':slot,'instructionRva':at-n.base,'argument':argument,
                          'argumentHex':bytes(n.u.mem_read(argument,8)).hex() if n.library_pointer(argument,8) else None})
        n.u.hook_add(unicorn.UC_HOOK_CODE,observe,begin=n.base+address,end=n.base+address)
        n.u.ctl_remove_cache(n.base+address,n.base+address+64)
    n.u.ctl_remove_cache(n.base+0x668c0,n.base+0xcc200)
    if args.appearance_factory:appearance_factory=initialize_appearance_factory(n,world_runtime=args.appearance_world_runtime)
    unit_registration=register_control(n,appearance_factory['worldRegistry']['object'],unit) if args.register_control_unit else None
    fixture.check_guard(unit)
    before=bytes(n.u.mem_read(unit,0x4000))
    last_blocks = []
    def remember_block(engine,address,size,user):
        last_blocks.append({'rva':address-n.base,'size':size})
        if len(last_blocks) > 64:
            del last_blocks[0]
    n.u.hook_add(unicorn.UC_HOOK_BLOCK,remember_block,begin=n.base,end=n.base+len(n.image)-1)
    boundary,phase = None,'projection'
    print(json.dumps({'phase':'projection-start','output':str(output)}),flush=True)
    try:
        projection_driver=project_appearance_with_asset_dispatch if args.cooperative_assets else project_appearance
        projection_driver(n,unit+0x35e0,lambda:{
            'appearanceCallbacks':len(trace),'spellPreloads':len(preload_requests),
            'effectRequests':len(effect_requests),'formatCalls':len(n.character_format_calls),
            'fileCalls':len(getattr(n,'file_calls',[])),
            'legacyPlatformCalls':len(getattr(n,'legacy_platform_calls',[]))})
        print(json.dumps({'phase':'projection-returned','completed':n.projection_execution['completed']}),flush=True)
        if args.asset_work_queue:
            phase = 'resource-dispatch'
            n.drain_asset_read_jobs()
        if args.animation_graphs:
            phase = 'animation-resource-inspection'
            animation_resources = inspect_animation_repository(n)
    except Exception as exception:
        boundary = {'kind':type(exception).__name__,'message':str(exception),'phase':phase,
                    'instructionAddress':n.u.reg_read(r.UC_X86_REG_RIP),
                    'instructionRva':n.u.reg_read(r.UC_X86_REG_RIP)-n.base if n.base <= n.u.reg_read(r.UC_X86_REG_RIP) < n.base+len(n.image) else None,
                    'registers':{name:n.u.reg_read(getattr(r,'UC_X86_REG_'+name.upper()))
                                 for name in ['rax','rbx','rcx','rdx','rdi','rsi','r8','r9','r10','r11','r12','r13','r14','r15','rbp','rsp']}}
        boundary['stackHex'] = bytes(n.u.mem_read(boundary['registers']['rsp'],256)).hex()
        boundary['lastBlocks'] = list(last_blocks)
        boundary['importName'] = n.source.imports.get(boundary['instructionRva'])
    finally:
        if args.installation:n.close_files()
        if args.shared_shaders and n.shader_catalog is not None:
            for path,digest in n.shader_catalog.inputs.items():
                if sha(fixture.raw(Path(path))) != digest:raise ValueError('Shared shader input changed')
        if args.graphics:n.close_graphics()
    if audio_emitter_service:audio_emitter_registry=inspect_audio_emitter_registry(n,audio_emitter_service['service'])
    if runtime_name_initialization:runtime_name_registry=inspect_runtime_name_registry(n,runtime_name_initialization)
    fixture.check_guard(unit)
    after = bytes(n.u.mem_read(unit,0x4000))
    changed = [offset for offset,(a,b) in enumerate(zip(before,after)) if a != b]
    # Read the state already written by the completed 0x30 callback. These
    # read-only resolver probes do not resume the failed appearance transition.
    n.call(0x377260,{r.UC_X86_REG_RDI:unit+0x10})
    group = n.u.reg_read(r.UC_X86_REG_RAX)
    if (n.allocations.get(group) != 0x30 or n.q(unit+0x110) != context['object'] or
            n.q(group+0x10) != resolver['object']):
        raise ValueError('Original base-context callback did not install the supplied typed resolver')
    n.unit_resources = {unit:group}
    rows,rows_at = n.u32(resolver['object']+0x10),n.q(resolver['object']+8)
    if rows > 65536 or rows and not n.library_pointer(rows_at,rows*16):
        raise ValueError('Original typed resolver rows escaped owned memory')
    resource_probes = []
    root_pointers = {case['loaded']['object']:case for case in graph['cases']}
    for key in sorted({n.u32(rows_at+i*16) for i in range(rows)}):
        resolved = NativeUnitResources.resolve(n,key,[unit],[])
        if resolved['owner'] != resolver['object']:
            raise ValueError('Original unit resolution selected another owner')
        if resolved['value'] and (resolved['value'] not in root_pointers or
                                  root_pointers[resolved['value']]['typeHash'] != 0x45cd899f):
            raise ValueError('Original unit resource points outside the typed VFX graph')
        resource_probes.append({'key':key,**resolved})
    paths = {Path(__file__),Path(inspect.getfile(NativeAIUnitFixture)),Path(__file__).with_name('character_graph_snapshot.py'),
             Path(inspect.getfile(NativeEffectContexts)),
             Path(inspect.getfile(NativeUnitResources)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    if args.installation:paths.add(Path(inspect.getfile(prepare_scripts)))
    if args.spell_preload:paths.add(Path(inspect.getfile(observe_preloads)))
    if args.script_registry:paths.add(Path(inspect.getfile(load_manifest)))
    if args.effect_preload:
        paths.update({Path(inspect.getfile(c)) for c in [NativeVfxObjects,NativeVfxResourceContext]})
        paths.add(Path(inspect.getfile(observe_effect_preloads)))
    if args.resource_archive:
        paths.add(Path(inspect.getfile(register_resource_archive)))
        paths.add(Path(inspect.getfile(load_installed_subchunks)))
    paths.add(Path(inspect.getfile(project_appearance)))
    if args.animation_graphs:paths.add(Path(inspect.getfile(prepare_animation_graph)))
    if args.animation_graphs:paths.add(Path(inspect.getfile(inspect_animation_repository)))
    if args.appearance_factory:paths.add(Path(inspect.getfile(initialize_appearance_factory)))
    if args.register_control_unit:paths.add(Path(inspect.getfile(register_control)))
    if args.product:paths.add(Path(inspect.getfile(initialize_product_configuration)))
    if args.audio_emitter_service:paths.add(Path(inspect.getfile(initialize_audio_emitter_service)))
    if args.cooperative_assets:paths.update({Path(inspect.getfile(project_appearance_with_asset_dispatch)),Path(inspect.getfile(NativeAssetWaitDispatch)),Path(inspect.getfile(observe_serialized_asset_progress))})
    if variant:paths.add(Path(__file__).with_name('observe-map-asset-links.py'))
    if args.recorded_map_variant:paths.add(Path(inspect.getfile(recover_startup_map_skin)))
    if args.recorded_participants:paths.add(Path(inspect.getfile(initialize_recorded_participants)))
    if args.runtime_name_registry:paths.add(Path(inspect.getfile(initialize_runtime_name_registry)))
    if args.shared_shaders:
        paths.update({Path(inspect.getfile(c)) for c in [GraphicsShaderCatalog,GraphicsPipelineDevice,GraphicsMaterialBindings,NativeVfxPipelineContext]})
        paths.add(Path(inspect.getfile(initialize_shared_graphics_registries)))
    if args.asset_work_queue:
        paths.update({Path(__file__).with_name(name) for name in ['graphics_block_texture_device.py','native_block_texture_upload.py']})
    if installed_runtime:paths.add(Path(inspect.getfile(initialize_champion_catalog)))
    if args.shared_constants:paths.add(Path(inspect.getfile(initialize_shared_constant_inputs)))
    if args.graphics:
        paths.update({Path(inspect.getfile(c)) for c in [GraphicsTextureDevice,GraphicsMeshDevice,NativeVfxGraphicsContext,NativeVfxMeshContext]})
        paths.update({Path(__file__).with_name(name) for name in ['render-particle-shader.py','observe-shader-angle.py']})
        paths.add(Path(inspect.getfile(assign_c_string)))
    result = {'schema':1,'kind':'original-ai-typed-character-callback-observations','actorKey':args.actor,
              'build':n.profile['clientVersion'],'protocol':n.profile['protocolDigest'],'decoderImageSha256':sha(n.image),
              'inputs':fixture.inputs,'sources':{path.name:sha(path.read_bytes()) for path in sorted(paths)},
              'originalBlocks':list(n.blocks.values()),'unit':unit,'unitKind':args.unit_kind,
              'audioFacade':audio_facade,'uiDataPrefix':ui_prefix,'suppliedCacheObject':cache_object,
              'audioEmitterService':audio_emitter_service,'audioEmitterRegistry':audio_emitter_registry,
              'recordedParticipants':recorded_participants,
              'runtimeNameRegistryInitialization':runtime_name_initialization,'runtimeNameRegistry':runtime_name_registry,
              'asciiCaseCompareCalls':getattr(n,'ascii_case_compare_calls',[]),
              'textureMathCalls':getattr(n,'texture_math_calls',[]),
              'shaderPreparation':shader_preparation,'shaderPreparationBatches':getattr(n,'shader_preparation_batches',[]),
              'contextIdentity':context['identity'],'resourcePath':resource_path,'resolverIdentity':resolver_identity,
              'suppliedTypedObjects':{'character':character['object'],'skin':skin['object'],
                                     'context':context['object'],'resolver':resolver['object']},
              'beforeUnitHex':before.hex(),'afterUnitHex':after.hex(),'changedByteOffsets':changed,
              'callbackTrace':trace,'boundary':boundary,
              'projectionExecution':n.projection_execution,
              'assetWaitDispatch':getattr(n,'asset_wait_dispatch_observations',None),
              'installedScripts':scripts,
              'installedResourceArchives':resource_archives,'mapAssets':map_assets,
              'recordedMapInput':startup_map_input,
              'sharedGraphicsRegistries':shared_graphics,
              'binaryResourceCache':binary_cache,'championCatalog':catalog,'binaryPostloadThreadVariables':postload_tls,
              'sharedConstantTypes':shared_constant_types,'sharedConstantInputs':shared_constants,
              'animationRepository':animation_repository,'animationGraphPreparations':n.animation_graph_preparations,
              'animationResources':animation_resources,
              'appearanceFactory':appearance_factory,
              'controlUnitRegistration':unit_registration,
              'productConfiguration':product_configuration,
              'assetArena':getattr(n,'asset_arena',None),
              'alignedMemoryCalls':n.asset_aligned_calls if installed_runtime else [],
              'libcppConcatenationCalls':n.cpp_concat_calls if installed_runtime else [],
              'libcppSharedOwnershipCalls':n.shared_calls if installed_runtime else [],
              'libcSprintfCalls':n.libc_sprintf_calls if installed_runtime else [],
              'assetQueue':asset_queue,'assetCompletionDispatcher':completion_dispatcher,
              'assetQueueState':n.asset_queue_state() if args.asset_work_queue else None,
              'assetQueueJobs':n.asset_queue_jobs if args.asset_work_queue else [],
              'assetCompletionRuns':n.asset_completion_runs if args.asset_work_queue else [],
              'assetCallbackRuns':n.asset_callback_runs if args.asset_work_queue else [],
              'assetQueuePlatformCalls':n.asset_queue_platform_calls if args.asset_work_queue else [],
              'legacyPlatformCalls':n.legacy_platform_calls if args.resource_archive else [],
              'legacyThreadExitCallbacks':n.legacy_thread_exit_callbacks if args.resource_archive else [],
              'scriptVm':script_vm,
              'spellPreloadManager':spell_preload,
              'spellPreloadRequests':preload_requests,
              'scriptFileRegistry':script_registry,
              'moduleProviders':module_providers,
              'modulePlatformCalls':n.module_platform_calls if args.module_providers else [],
              'effectPreloadComponents':effect_preload,
              'effectPreloadRequests':effect_requests,
              'nativeGraphics':{'initialization':graphics,'fileRequests':n.file_requests,
                                'textures':n.gpu_records,'buffers':list(n.native_mesh_buffers.values()),
                                'indexBuffers':list(getattr(n,'native_index_buffers',{}).values()),
                                'libraryStringCalls':n.libcpp_string_calls,
                                'shaderRequests':n.shader_catalog.requests if args.shared_shaders else [],
                                'programs':list(n.native_programs.values()) if args.shared_shaders else [],
                                'pipelines':list(n.native_pipelines.values()) if args.shared_shaders else [],
                                'bindings':list(n.native_bindings.values()) if args.shared_shaders else [],
                                'materialBindingRequests':n.material_binding_requests if args.shared_shaders else [],
                                'sharedParameterQueries':n.shared_parameter_queries if args.shared_shaders else []} if args.graphics else None,
              'scriptDependencyState':{'spellPreloadManager':{'globalRva':0x2472910,'pointer':n.q(n.base+0x2472910)}} if args.script_runtime else None,
              'fileLookups':n.file_lookups if args.installation else [],
              'fileCalls':n.file_calls if args.installation else [],
              'installedBaseResolver':{'component':group,'resolver':n.q(group+0x10),'probes':resource_probes},
              'counts':{'callbacksEntered':len(trace),'unitBytesChanged':len(changed),
                        'originalUnitResolverLookups':len(resource_probes),'boundaries':int(boundary is not None)},
              'scope':{'originalAiBaseConstructorExecuted':True,'originalProjectionAndCallbackPrefixesExecuted':True,
                       'originalAiClientConstructorExecuted':args.unit_kind == 'client',
                       'suppliedControlLocallyRegistered':unit_registration is not None,
                       'fullUiBootstrapExecuted':False,
                       'completeProjectionCall':n.projection_execution['completed'],'callerSuppliedTypedCacheObjects':True,
                       'readinessBitsSupplied':False,'assetReadinessVerified':False,'baseContextSupplied':True,
                       'liveWorldRoutingVerified':False,'acceptedMatchAppearanceVerified':False,'mainViewerExpanded':False}}
    print(json.dumps({'phase':'observation-complete','completeProjectionCall':n.projection_execution['completed'],
                      'boundary':boundary and {key:boundary[key] for key in ['kind','message','phase','instructionRva']}}),flush=True)
    output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'counts':result['counts'],'trace':trace,'boundary':boundary}),flush=True)


if __name__ == '__main__':
    main()
