"""Paired original parent control with only typed child declarations nulled.

The complete installed resolver/system library is explicit static input. Unit
acceptance, appearance-cache loading and child scheduler activation are omitted.
No resolver entry, source context pointer or lookup result is overwritten.
"""
import argparse
import inspect
import json
from pathlib import Path
import runpy
import struct
import sys
import unicorn
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from replay_descriptor_native import NativeReplayWorldDescriptors, ReplayDescriptorLibraries
from unit_resource_native import NativeUnitResources
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import ADDRESSES as A, name_hash, sha
from vfx_asset_native import CONTEXT, CACHE, WRAPPER

child_source = Path(__file__).with_name('probe-direct-child-parent.py')
ChildParentControl = runpy.run_path(str(child_source))['ChildParentControl']


class Control(ChildParentControl, NativeReplayWorldDescriptors):
    create_unit = NativeUnitResources.create_unit
    def __init__(self, *args, **kwargs):
        self.unit_resources = {}
        self.render_indices = None
        super().__init__(*args, **kwargs)

    def parent_state(self):
        state = super().parent_state()
        if self.render_indices is not None:
            state['actors'] = [actor for actor in state['actors']
                               if actor.get('emitterIndex') in self.render_indices]
        return state

    def render_siblings(self, indices):
        if self.render_indices is not None:
            raise ValueError('Sibling rendering cannot nest')
        self.render_indices = set(indices)
        try:
            draws = self.render_parent({'position': [500, 700, 900],
                'right': [1, 0, 0], 'up': [0, 0.6, -0.8], 'axis': [0, 0.8, 0.6]})
            if sorted(row['emitterIndex'] for row in draws) != sorted(indices):
                raise ValueError('Every selected installed sibling requires an original writer')
            return draws
        finally:
            self.render_indices = None


def clear_child_declarations(n, root):
    field = next(p for p in n.type_catalog['45cd899f']['properties']
                 if p['hash'] == name_hash('complexEmitterDefinitionData'))
    child = next(p for p in n.type_catalog['09cde442']['properties']
                 if p['hash'] == name_hash('childParticleSetDefinition'))
    if child['offset'] != 0x3c8:
        raise ValueError('Original typed child field layout differs')
    controls = []
    for index, row in enumerate(n.vector(root+field['offset'], 8, 4096)):
        definition = n.q(row)
        original = n.q(definition+child['offset'])
        if not original:
            continue
        payload = struct.pack('<IBI', child['hash'], 0x82, 0)
        n.input, n.cursor = payload, 0
        n.put(CACHE, 'Q', 0)
        n.loading = True
        try:
            n.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT,
                r.UC_X86_REG_RSI: definition, r.UC_X86_REG_RDX: n.types[0x09cde442],
                r.UC_X86_REG_RCX: WRAPPER, r.UC_X86_REG_R8: CACHE})
        finally:
            n.loading = False
        if n.cursor != len(payload) or n.q(definition+child['offset']):
            raise ValueError('Original typed field reader did not null child declaration')
        controls.append({'emitterIndex': index, 'definition': definition,
            'originalChild': original, 'fieldReaderRva': 0x14bc830, 'fieldHex': payload.hex()})
    if not controls:
        raise ValueError('Paired child control requires authored children')
    return controls


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        p.add_argument(name, type=Path)
    p.add_argument('--effect', default='champions/jinx/2/3b1dfaaf')
    p.add_argument('--frames', type=int, default=3)
    p.add_argument('--variant', choices=['authored', 'typed-child-null'], default='authored')
    p.add_argument('--siblings', required=True, help='Explicit comma-separated compiled sibling emitter indices')
    args = p.parse_args()
    if not 1 <= args.frames <= 61:
        raise ValueError('Explicit bounded child frame count required')
    fixture = NativeVfxFixture(args.cache)
    libraries = ReplayDescriptorLibraries(fixture)
    actor_key = args.effect.rsplit('/', 1)[0]
    sibling_indices = [int(value) for value in args.siblings.split(',')]
    if (not sibling_indices or len(set(sibling_indices)) != len(sibling_indices)
            or any(index < 0 or index > 4095 for index in sibling_indices)):
        raise ValueError('Unique bounded sibling indices required')
    actor = libraries.effects['actors'][actor_key]
    parent_keys = [int(key, 16) for key, value in actor['resources'].items()
                   if value.get('effectId') == args.effect]
    if len(parent_keys) != 1:
        raise ValueError('A unique installed parent resource key is required')
    device = GraphicsTextureDevice(args.angle)
    n = shader = None
    stage, boundary, frames, factories, lookup_successes = 'construct', None, [], [], []
    details = {}
    try:
        n = Control(fixture.assets/'decoder-16.21-macos', args.client, device=device)
        shader = GraphicsShaderCatalog(fixture.assets/'latest-shaders', device)
        n.shader_catalog = shader
        stage = 'warm-root'
        warm = fixture.activate(n, args.effect, 12345,
            {'ticks': [1000000000]*3, 'mode': 0, 'timebase': [1, 1]}, 0, False)
        n.own_parent(warm['object'])
        n.suspend_parent(True)
        stage = 'typed-unit-resolver'
        n.initialize_context_reflection()
        # Both branches deserialize/postload the complete root in the same live
        # arena. The frozen prepared heap has no individual allocator ownership,
        # so an original destructor must not be run over its copied pointers.
        loaded_root = n.load_live_system(libraries.system_fields(fixture.systems['systems'][args.effect]))
        root = loaded_root['object']
        if args.variant == 'typed-child-null':
            details['typedChildControls'] = clear_child_declarations(n, root)
        # own_parent's diagnostic index map reads this fixed root alias. The
        # factory itself selects the original live root through the resolver.
        n.u.mem_write(A['definition'], bytes(n.u.mem_read(root, n.system_size)))
        details['liveRoot'] = loaded_root
        identities = sorted({value['effectId'] for value in actor['resources'].values()
                             if value['status'] == 'prepared-definition'})
        roots, entries = {}, []
        for effect_id in identities:
            loaded = ({'object': root, 'typeRva': n.system_type-n.base}
                      if effect_id == args.effect else
                      n.load_live_system(libraries.system_fields(fixture.systems['systems'][effect_id])))
            roots[effect_id] = loaded['object']
            entries.append({'identity': int(effect_id.rsplit('/', 1)[1], 16), **loaded})
        resolver = n.read_resolver_fields(libraries.map_fields(actor_key))
        if resolver['rows'] != libraries.resolver_cases[actor_key]['loaded']['rows']:
            raise ValueError('Complete installed resolver rows differ')
        fixed = n.fix_resolver_links(resolver, sorted(entries, key=lambda row: row['identity']))
        if fixed['status'] != 'typed-local-links-resolved':
            raise ValueError('Complete installed unit resolver still requires global links')
        unit = n.create_unit(resolver['object'])
        stage = 'original-unit-world-factory'
        details.update(unit=unit, resolver=resolver, fixups=fixed, roots=roots,
                       world=n.initialize_world_factory())
        vector, unit_array, auxiliary, position, output = (n.allocate(24), n.allocate(8),
            n.allocate(24), n.allocate(12), n.allocate(16))
        n.put(unit_array, 'Q', unit['object'])
        n.put(vector, 'QQQ', unit_array, unit_array+8, unit_array+8)
        n.put(position, 'fff', 100, 40, 200)
        def factory(uc, address, size, user):
            obj = uc.reg_read(r.UC_X86_REG_RBX)
            factories.append({'object': obj, 'definition': n.q(obj+0x48),
                              'resourceOwner': n.q(obj+0x50)})
        def success(uc, address, size, user):
            frame = uc.reg_read(r.UC_X86_REG_RBP)
            lookup_successes.append({'definition': n.q(frame-0x38),
                'resourceOwner': uc.reg_read(r.UC_X86_REG_R14),
                'sourceObject': uc.reg_read(r.UC_X86_REG_R15)})
        n.u.hook_add(unicorn.UC_HOOK_CODE, factory,
                     begin=n.base+0x174b797, end=n.base+0x174b797)
        n.u.hook_add(unicorn.UC_HOOK_CODE, success,
                     begin=n.base+0x17558c5, end=n.base+0x17558c5)
        n.call(0x377550, {r.UC_X86_REG_RDI: output, r.UC_X86_REG_RSI: parent_keys[0],
            r.UC_X86_REG_RDX: vector, r.UC_X86_REG_RCX: auxiliary,
            r.UC_X86_REG_R8: 0, r.UC_X86_REG_R9: position})
        wrapper = n.q(n.q(output))
        obj = n.q(wrapper+0x178)
        if n.q(obj+0x48) != root or n.q(obj+0x50) != resolver['object']:
            raise ValueError('Original unit selection did not propagate its exact resolver owner')
        n.object_addresses.append(obj)
        n.observe_objects()
        n.call(0x1765960, {r.UC_X86_REG_RDI: obj})
        ownership = n.own_parent(obj)
        n.synchronize_placement(obj)
        details.update(wrapper=wrapper, object=obj, ownership=ownership)
        stage = 'original-child-tick'
        n.child_calls.clear()
        for tick in range(args.frames):
            n.apply_placement(obj, {'position': [100+tick*2, 40, 200+tick]})
            n.synchronize_placement(obj)
            frame = n.tick_parent(ownership['initialTime']+tick/60, 20)
            before_render_rng = bytes(n.u.mem_read(A['stream']+8, 12)).hex()
            draws = n.render_siblings(sibling_indices)
            if bytes(n.u.mem_read(A['stream']+8, 12)).hex() != before_render_rng:
                raise ValueError('Original sibling geometry unexpectedly consumed RNG')
            frames.append({'time': frame['time'], 'state': frame['state'],
                           'substeps': frame['substeps'], 'siblingDraws': draws,
                           'managerParentCount': n.u32(A['manager']+0x188)})
        if args.variant == 'authored' and (not lookup_successes or len(factories) < 2):
            raise ValueError('Authored control must execute original successful child lookup/enqueue')
        if args.variant == 'typed-child-null' and (lookup_successes or len(factories) != 1):
            raise ValueError('Typed-null control unexpectedly enqueued child objects')
        if any(row['resourceOwner'] != resolver['object'] for row in lookup_successes+factories):
            raise ValueError('Child lookup or factory changed the selected resolver identity')
        stage = 'complete'
    except Exception as error:
        boundary = {'stage': stage, 'kind': type(error).__name__, 'message': str(error)}
        if n:
            boundary['rva'] = n.u.reg_read(r.UC_X86_REG_RIP)-n.base
    finally:
        paths = {Path(__file__), child_source, Path(inspect.getfile(NativeVfxFixture)),
                 Path(inspect.getfile(ReplayDescriptorLibraries)), Path(inspect.getfile(NativeUnitResources)),
                 Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog))}
        if n:
            for cls in type(n).__mro__:
                if cls is object or cls.__module__ == '<run_path>': continue
                paths.add(Path(inspect.getfile(cls)))
        for module in list(sys.modules.values()):
            source = getattr(module, '__file__', None)
            if source and Path(source).suffix == '.py' and Path(source).resolve().parent == Path(__file__).resolve().parent:
                paths.add(Path(source))
        if shader:
            for path, digest in shader.inputs.items():
                if sha(fixture.raw(Path(path))) != digest:
                    raise ValueError('Shader input drift during paired child control')
        result = {'schema': 1, 'kind': 'original-child-free-sibling-independence-control',
            'effectId': args.effect, 'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
            'variant': args.variant, 'siblingIndices': sibling_indices, 'requestedFrames': args.frames,
            'completed': stage == 'complete', 'boundary': boundary, 'details': details,
            'frames': frames, 'factories': factories, 'lookupSuccesses': lookup_successes,
            'childCalls': n.child_calls if n else [], 'inputs': fixture.inputs,
            'sources': {str(path.resolve()): sha(path.read_bytes()) for path in paths},
            'originalBlocks': list(n.blocks.values()) if n else [],
            'scope': {'completeInstalledResolverAndSystems': bool(details.get('fixups')),
                'originalUnitResourceGroup': bool(details.get('unit')),
                'originalParentResourceSelectionAndOwnerPropagation': stage == 'complete',
                'forcedLookupSuccess': False, 'sourceContextFieldOverwritten': False,
                'childGlobalSchedulerActivationRecovered': False, 'appearanceCacheAcquisitionRecovered': False,
                'onlyTypedChildNullCounterfactual': args.variant == 'typed-child-null',
                'parentSchedulerOrRngReplaced': False, 'gpuSubmitted': False,
                'nativeReplayAcceptance': None, 'productionAdmissionChanged': False}}
        out = fixture.cache/'research'/('direct-child-siblings-'+args.effect.replace('/', '-')+'-'+args.variant+'-native.json')
        out.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(out), 'stage': stage, 'boundary': boundary,
                          'successfulLookups': len(lookup_successes), 'factories': len(factories)}))
        if n:
            if n.material_backend: n.material_backend.close()
            if n.mesh_backend: n.mesh_backend.close()
        if shader: shader.close()
        device.close()
    if boundary: raise ValueError('Original child producer reached an explicit boundary')


if __name__ == '__main__':
    main()
