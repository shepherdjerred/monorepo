"""Original lazy form producer on installed Akshan gear data and an AI unit.

The static resource cache is explicitly supplied, not a replay acquisition.
This controls the no-render-component branch without substituting callbacks.
"""
import argparse
import inspect
import importlib.metadata
import io
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from character_asset_native import NativeCharacterAssets
from ai_hero_stack_native import NativeHeroStackProbe
from ai_client_native import NativeAIClientInputs
from libcpp_shared_native import NativeLibcppSharedOwnership
from ai_hero_type_native import initialize_hero_client_types
from mode_dependency_types_native import initialize_mode_dependency_types
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import ADDRESSES, sha


class Control(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeAIClientInputs):
    pass


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    p.add_argument('--render-constructor-prefix', action='store_true')
    p.add_argument('--hero-constructor', action='store_true')
    args = p.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n, cache = fixture.native, fixture.cache
    source_paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
                    *[Path(inspect.getfile(f)) for f in [initialize_hero_client_types,
                       initialize_mode_dependency_types, initialize_product_configuration]],
                    *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in source_paths}
    effects = fixture.read(cache/'public/latest-effects/manifest.json')
    package = fixture.read(cache/'public/latest-effects/package.json')
    actor = 'champions/akshan/20'
    import cdtb.binfile as binfile
    distribution = importlib.metadata.distribution('cdtb')
    if json.loads(distribution.read_text('direct_url.json'))['vcs_info']['commit_id'] != effects['toolchain']['cdtbRevision']:
        raise ValueError('Pinned original BIN parser required')
    # Only numeric identities/serialized spans are consumed by this control.
    for dictionary in [binfile.hashfile_binfields, binfile.hashfile_bintypes,
                       binfile.hashfile_binentries, binfile.hashfile_binhashes,
                       binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}
    class Reader(binfile.BinReader):
        def __init__(self, *a):
            super().__init__(*a)
            self.spans = {}
        def read_field(self, kind):
            start = self.f.tell()
            field = super().read_field(kind)
            self.spans[id(field)] = (start, self.f.tell())
            return field
    entries = {}
    for source in package['actors'][actor]['sourceBins']:
        stem = source['sourceSha256']+'-'+effects['toolchain']['parserIdentity'][:16]
        raw = fixture.raw(cache/'research/latest-effects/bins'/(stem+'.bin'))
        if sha(raw) != source['sourceSha256'] or raw[:4] != b'PROP':
            raise ValueError('Installed actor BIN changed')
        stream = io.BytesIO(raw)
        stream.read(4)
        reader = Reader(stream)
        _, _, types = reader.read_binfile_header()
        for entry in [reader.read_binfile_entry(t) for t in types]:
            fields = [raw[a:z] for a, z in [reader.spans[id(f)] for f in entry.fields]]
            entries[entry.path.h] = (entry.type.h, fields)
    skin_roots = [(key, fields) for key, (kind, fields) in entries.items() if kind == 0x9b67e9f6]
    if len(skin_roots) != 1:
        raise ValueError('One installed skin root required')
    n.initialize_character_types()
    skin_fields = [f for f in skin_roots[0][1] if int.from_bytes(f[:4], 'little') == 0x68f2b69c]
    if len(skin_fields) != 1:
        raise ValueError('One original skinUpgradeData field required')
    skin = n.observe_actor_fields(0x9b67e9f6, skin_fields)
    if skin['originalSkippedFields']:
        raise ValueError('Skin upgrade field was not consumed')
    gears = {}
    for link in skin['pendingReferences']:
        kind, fields = entries[link['identity']]
        if kind != 0x27dd6361:
            raise ValueError('Skin upgrade references a non-gear root')
        loaded = n.observe_actor_fields(kind, fields)
        if loaded['originalSkippedFields'] or loaded['pendingReferences']:
            raise ValueError('Actual gear needs additional unresolved dependencies')
        gears[link['identity']] = loaded
    if len(gears) != 2:
        raise ValueError('Actual installed Akshan skin20 gear count differs')
    library, table, queue, context = n.allocate(0x48), n.allocate(48), n.allocate(32), n.allocate(24)
    for i, (key, obj) in enumerate(sorted(gears.items())):
        n.put(table+i*24, 'QQII', obj['object'], n.types[0x27dd6361], key, 0)
    n.put(library+0x10, 'QII', table, 2, 2)
    for i, link in enumerate(skin['pendingReferences']):
        n.put(queue+i*16, 'QQ', link['destination'], link['expectedType'])
    n.put(context, 'QQII', library, queue, 2, 2)
    n.call(0x14bbf40, {r.UC_X86_REG_RDI: context})
    if n.u32(context+0x10):
        raise ValueError('Original typed gear link fixup incomplete')
    if n.q(n.base+0x24712c8):
        raise ValueError('Expected cold original resource-group manager')
    n.call(0x665f24, {}, 0x665f51)
    group_manager = n.q(n.base+0x24712c8)
    if n.allocations.get(group_manager) != 0x20 or not n.q(group_manager+0x18):
        raise ValueError('Original resource-group startup did not complete')
    if args.hero_constructor:
        n.initialize_audio_facade()
        n.initialize_ui_data_prefix()
        initialize_product_configuration(n, 'LoL')
        initialize_mode_dependency_types(n)
        initialize_hero_client_types(n, reuse_existing=True)
        unit = n.allocate(0x4aa0)
        n.u.mem_write(unit+0x49a0, b'\xa5'*0x100)
        try:
            n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
        except Exception:
            print(json.dumps({'heroConstructorBoundary': {
                'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                'callerRva': n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base,
                'rax': n.u.reg_read(r.UC_X86_REG_RAX)}}), flush=True)
            raise
        storage_key = n.allocate(0x28)
        for offset, value in [(0, 'Akshan'), (0x10, '')]:
            n.call(0x14c2d60, {r.UC_X86_REG_RDI: storage_key+offset,
                              r.UC_X86_REG_RSI: n.allocate_text(value)})
        n.put(storage_key+0x20, 'II', 20, 0)
        fixture.run_to(0x67c20, 0x67c57, {r.UC_X86_REG_RDI: unit+0x35e0,
                                        r.UC_X86_REG_RSI: storage_key})
    else:
        unit = fixture.construct_ai()
        fixture.initialize_default_storage(unit, 'Akshan', 20)
    resource = n.prepare_cache([{'name': 'Akshan', 'namespace': '', 'skinId': 20,
                                'keyFlags': 0, 'context': 0}])[0]['object']
    character_context = n.character_context('Akshan', 20)
    n.call(0x2a69b3, {r.UC_X86_REG_RBX: resource,
                      r.UC_X86_REG_RAX: character_context['object']}, 0x2a69b7)
    n.call(0x2a766f, {r.UC_X86_REG_RAX: skin['object'], r.UC_X86_REG_RBX: resource}, 0x2a7677)
    render_prefix = None
    if args.render_constructor_prefix:
        component, handle = n.allocate(0x1a8), n.allocate(8)
        n.put(handle, 'Q', resource)
        fixture.run_to(0x76bb40, 0x76bc8c, {r.UC_X86_REG_RDI: component,
            r.UC_X86_REG_RSI: unit, r.UC_X86_REG_RDX: unit+0x40,
            r.UC_X86_REG_RCX: handle})
        frame = ADDRESSES['stack']+0x100
        n.call(0x1303dd, {r.UC_X86_REG_RBP: frame}, 0x1303e8)
        n.call(0x130428, {r.UC_X86_REG_RBX: component, r.UC_X86_REG_RBP: frame,
                         r.UC_X86_REG_R14: unit+0x118}, 0x130469)
        if n.q(frame-0x38) != n.base+0x2566c00:
            raise ValueError('Original registration key escaped its factory frame')
        render_prefix = {'object': component, 'constructorRange': [0x76bb40, 0x76bc8c],
                         'registrationRange': [0x130428, 0x130469],
                         'secondaryInterfaceVtable': n.q(component+0x10),
                         'meshAcquisitionExecuted': False, 'renderReadiness': None}
    n.call(0x37f7d0, {r.UC_X86_REG_RDI: unit+0x118})
    group = n.u.reg_read(r.UC_X86_REG_RAX)
    n.call(0x548bf0, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: character_context['object']})
    # Distinct originally constructed resolver handles test preservation of
    # nonempty supplied state. These handles are not replay-selected assets.
    control_resolvers = [n.allocate(24), n.allocate(24)]
    for resolver in control_resolvers:
        n.call(0x16659b0, {r.UC_X86_REG_RDI: resolver})
    n.call(0x377380, {r.UC_X86_REG_RDI: group, r.UC_X86_REG_RSI: control_resolvers[0]})
    for resolver in [control_resolvers[1], 0]:
        n.call(0x377390, {r.UC_X86_REG_RDI: group, r.UC_X86_REG_RSI: resolver})
    before = bytes(n.u.mem_read(group, 0x30)).hex()
    before_context = n.q(unit+0x110)
    before_appearance = bytes(n.u.mem_read(unit+0x35e0, 0x130)).hex()
    before_render = bytes(n.u.mem_read(render_prefix['object'], 0x1a8)).hex() if render_prefix else None
    component_reads = []
    selected_render_components = []
    visits = []
    watched = [0xfdd00, 0xbf8b0, 0xd7b90, 0x30d220, 0x30d510, 0x30d642, 0x30e30c, 0x30ed00,
               0x15ef6c0, 0x30e249, 0x30ea50, 0x377380, 0x377390, 0x3774f0, 0x548bf0]
    def observe(uc, address, size, user):
        at = address-n.base
        visits.append(at)
        if at in [0x377380, 0x377390, 0x3774f0, 0x548bf0]:
            raise ValueError('Lazy gear construction invoked resource mutation')
    hooks = [n.u.hook_add(unicorn.UC_HOOK_CODE, observe, begin=n.base+at, end=n.base+at) for at in watched]
    hooks.append(n.u.hook_add(unicorn.UC_HOOK_CODE,
        lambda uc, address, size, user: selected_render_components.append(uc.reg_read(r.UC_X86_REG_RAX)),
        begin=n.base+0x30d5bf, end=n.base+0x30d5bf))
    if render_prefix:
        def render_read(uc, access, address, size, value, user):
            component_reads.append({'offset': address-render_prefix['object'], 'bytes': size,
                                    'instructionRva': uc.reg_read(r.UC_X86_REG_RIP)-n.base})
        hooks.append(n.u.hook_add(unicorn.UC_HOOK_MEM_READ, render_read,
            begin=render_prefix['object'], end=render_prefix['object']+0x1a7))
        n.u.ctl_remove_cache(n.base+0x30d510, n.base+0x30d670)
        n.call(0x30d5bf, {r.UC_X86_REG_RAX: render_prefix['object']}, 0x30d5c6)
        if component_reads != [{'offset': 0x10, 'bytes': 8, 'instructionRva': 0x30d5bf}]:
            raise ValueError('Animation component read observer failed positive control')
        component_reads.clear()
        selected_render_components.clear()
    form_package = fixture.read(cache/'public/latest-unit-form-inputs/package.json')
    if (form_package['build'] != n.profile['clientVersion'] or
            form_package['decoderImageSha256'] != sha(n.image)):
        raise ValueError('Exact original form codec required')
    packet_bytes = bytearray(form_package['objectSize'])
    packet_bytes[0x10] = form_package['decode']['index'].index(255)
    packet_bytes[0x11] = form_package['decode']['nativeFlag'].index(False)
    packet = n.allocate(len(packet_bytes))
    n.u.mem_write(packet, bytes(packet_bytes))
    boundary = None
    try:
        n.call(0xfdd00, {r.UC_X86_REG_RDI: unit, r.UC_X86_REG_RSI: packet})
        if n.u.reg_read(r.UC_X86_REG_RAX)&255 != 1:
            raise ValueError('Original129 listener did not return true')
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'rva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                    'registers': {name: n.u.reg_read(getattr(r, 'UC_X86_REG_'+name))
                                  for name in ['RDI', 'RSI', 'RAX', 'RBX']}}
    finally:
        for hook in hooks:
            n.u.hook_del(hook)
    after = bytes(n.u.mem_read(group, 0x30)).hex()
    if args.hero_constructor:
        if bytes(n.u.mem_read(unit+0x49a0, 0x100)) != b'\xa5'*0x100:
            raise ValueError('Original Hero escaped its guard')
    else:
        fixture.check_guard(unit)
    if after != before:
        raise ValueError('Lazy gear construction changed resource group')
    if (n.q(unit+0x110) != before_context or
            bytes(n.u.mem_read(unit+0x35e0, 0x130)).hex() != before_appearance or
            render_prefix and bytes(n.u.mem_read(render_prefix['object'], 0x1a8)).hex() != before_render):
        raise ValueError('Lazy gear construction changed appearance/animation component identity')
    # Registry record+0x10 points to the first list node, not the component.
    # Node+0x10 is the component pointer; the object itself is not consumed.
    if render_prefix and (component_reads or len(selected_render_components) != 1 or
            n.allocations.get(selected_render_components[0]) != 0x18 or
            n.q(selected_render_components[0]+0x10) != render_prefix['object']):
        raise ValueError('Lazy producer consumed more than original registry presence: '+repr((component_reads,
            [(at, n.allocations.get(at), n.q(at+0x10)) for at in selected_render_components])))
    if boundary is None and args.render_constructor_prefix and (
            0x30e30c not in visits or 0x30ea50 in visits or 0x30ed00 not in visits or
            args.hero_constructor and 0x30e249 not in visits):
        raise ValueError('Expected full original render/callback/negative leaf path was not executed')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Lazy producer source changed')
    result = {'schema': 1, 'kind': 'original-lazy-form-component-static-input-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs, 'sources': sources,
              'originalBlocks': list(n.blocks.values()), 'actorKey': actor, 'unit': unit,
              'skinUpgradeFields': [{'sha256': sha(f), 'bytes': len(f)} for f in skin_fields],
              'gearIdentities': list(gears), 'renderConstructorPrefix': render_prefix,
              'gearPrograms': [{'identity': key, 'object': value['object'],
                   'gearData': n.q(value['object']+8),
                   'gearDataHex': bytes(n.u.mem_read(n.q(value['object']+8), 0x1c8)).hex(),
                   'resolver': n.q(n.q(value['object']+8)+0x158),
                   'resolverRowCount': n.u32(n.q(n.q(value['object']+8)+0x158)+0x10),
                   'fieldHashes': [sha(f) for f in entries[key][1]]}
                  for key, value in gears.items()],
              'heroConstructor': args.hero_constructor,
              'packet': {'bytesHex': packet_bytes.hex(), 'index': 255, 'nativeFlag': False},
              'animationComponentReads': component_reads,
              'renderRegistryHeaders': selected_render_components,
              'renderRegistryPresenceOnly': bool(render_prefix),
              'appearanceStorageUnchanged': True, 'animationComponentUnchanged': True,
              'visits': visits, 'boundary': boundary,
              'resourceGroupBefore': before, 'resourceGroupAfter': after,
              'resourceContextBefore': before_context, 'resourceContextAfter': n.q(unit+0x110),
              'suppliedResolverHandles': control_resolvers,
              'scope': {'originalLazyProducerCompleted': boundary is None,
                        'completeOriginal129ListenerExecuted': boundary is None,
                        'originalCallbackRegistrationExecuted': 0x30e249 in visits,
                        'registeredCallbackExecuted': 0x30ea50 in visits,
                        'animationComponentFieldsConsumed': False,
                        'onlyOriginalRegistryPresenceConsumed': bool(render_prefix),
                        'actualInstalledGearTableLoadedAndLinked': True,
                        'suppliedStaticAppearanceCache': True,
                        'resourceIdentityUnchangedInObservedExecution': True,
                        'renderComponentPreparationEstablished': False,
                        'actualReplayStateRecovered': False, 'productionEligibilityChanged': False}}
    output = cache/'research'/('negative-form-lazy-hero-prefix-native.json' if args.hero_constructor and args.render_constructor_prefix
                              else 'negative-form-lazy-hero-no-render-native.json' if args.hero_constructor
                              else 'negative-form-lazy-render-prefix-native.json' if args.render_constructor_prefix
                              else 'negative-form-lazy-producer-native.json')
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'visits': visits, 'boundary': boundary}))
    if boundary:
        raise ValueError('Original lazy form producer reached explicit boundary')


if __name__ == '__main__':
    main()
