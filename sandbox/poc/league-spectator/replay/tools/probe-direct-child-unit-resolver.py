"""Original child lookup/enqueue through an actual typed unit resolver owner.

The complete installed resolver/system library is explicit static input. Unit
acceptance, appearance-cache loading and child scheduler activation are omitted.
No resolver entry, source context pointer or lookup result is overwritten.
"""
import argparse
import inspect
import json
from pathlib import Path
import runpy
import unicorn
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from replay_descriptor_native import NativeReplayWorldDescriptors, ReplayDescriptorLibraries
from unit_resource_native import NativeUnitResources
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import ADDRESSES as A, sha

child_source = Path(__file__).with_name('probe-direct-child-parent.py')
ChildParentControl = runpy.run_path(str(child_source))['ChildParentControl']


class Control(ChildParentControl, NativeReplayWorldDescriptors):
    create_unit = NativeUnitResources.create_unit
    def __init__(self, *args, **kwargs):
        self.unit_resources = {}
        super().__init__(*args, **kwargs)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        p.add_argument(name, type=Path)
    p.add_argument('--effect', default='champions/jinx/2/3b1dfaaf')
    p.add_argument('--frames', type=int, default=3)
    args = p.parse_args()
    if not 1 <= args.frames <= 61:
        raise ValueError('Explicit bounded child frame count required')
    fixture = NativeVfxFixture(args.cache)
    libraries = ReplayDescriptorLibraries(fixture)
    actor_key = args.effect.rsplit('/', 1)[0]
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
        # Preserve the exact prepared root and all its postload pointers. Other
        # roots and every resolver row come from the unchanged installed BIN.
        prepared = bytes(n.u.mem_read(A['definition'], n.system_size))
        root = n.allocate(n.system_size)
        n.call(0x1786e80, {r.UC_X86_REG_RDI: root})
        n.u.mem_write(root, prepared)
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
            frames.append({'time': frame['time'], 'state': frame['state'],
                           'managerParentCount': n.u32(A['manager']+0x188)})
        if not lookup_successes or len(factories) < 2:
            raise ValueError('No original successful child lookup/enqueue observed')
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
        result = {'schema': 1, 'kind': 'original-child-through-typed-unit-resolver-control',
            'effectId': args.effect, 'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
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
                'nativeReplayAcceptance': None, 'productionAdmissionChanged': False}}
        out = fixture.cache/'research'/('direct-child-unit-resolver-'+args.effect.replace('/', '-')+'-native.json')
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
