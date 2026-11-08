"""Original complete factory with supplied horizontal descriptor directions.

The entry hook supplies only descriptor input bytes. Original factory, setters,
activation and parent synchronization execute unchanged. The static Maokai root
is a control definition, not a substitute for a replay's selected definition.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from world_descriptor_native import NativeWorldDescriptors, DESCRIPTOR, OUTPUT
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    fixture = NativeVfxFixture(args.cache)
    effect_id = 'champions/maokai/3/8e47e7e3'
    effects = fixture.read(fixture.assets/'latest-effects/manifest.json')
    # Select raw decoded inputs independently of the changing admission frontier.
    # This export is a diagnostic, never a per-match runtime asset package.
    exported = fixture.read(fixture.cache/'research/viewer-root-reconstruction.json')
    if exported['kind'] != 'verified-ordinary-reconstruction-diagnostic-export' or exported['runtimePlaybackInput'] is not False:
        raise ValueError('Ordinary decoded diagnostic inputs required')
    replay = exported['report']
    if replay['build'] != effects['build'] or replay['protocol'] != effects['protocol']:
        raise ValueError('Decoded direction fixture build differs')
    owner = next(hero for hero in replay['heroes'] if hero['champion'] == 'Ornn' and hero['skinId'] == 0)
    resources = effects['actors']['champions/ornn/0']['resources']
    selected_definitions = {'champions/ornn/0/5dcd8300', 'champions/ornn/0/aec06c7c'}
    controls = []
    for d in replay['effectDescriptors']:
        resource = resources.get(f"{d['resourceKey']:08x}", {})
        if not (69 <= d['time'] <= 99 and d['resourceContextEntityId'] == owner['entityId']
                and resource.get('effectId') in selected_definitions):
            continue
        if (any(d[field] for field in ['attachmentEntityId', 'lookup14EntityId', 'lookupA8EntityId',
                                      'attachmentKey4c', 'attachmentKey50', 'field8c']) or
                d['byteFields']['field98'] or d['flags'] != 0x30 or d['vector6c'][1] != 0):
            raise ValueError('Selected decoded direction requires an unproven provider')
        if struct.pack('<3f', *d['vector6c']) != struct.pack('<3I', *d['vector6cBits']):
            raise ValueError('Decoded direction float32 bits differ')
        controls.append({'sourceEventId': f"network-effect:{d['entityId']}:{d['creationSequence']}",
            'definitionId': resource['effectId'], 'vector6c': d['vector6c'],
            'primaryPacketPosition': d['primaryPacketPosition'], 'flags': d['flags']})
    if len(controls) != 6 or len({row['sourceEventId'] for row in controls}) != 6:
        raise ValueError('Expected six unique horizontal provider-free replay direction controls')
    catalog = fixture.read(fixture.assets/'latest-parent-frame-caches/package.json')
    ref = next(row for row in catalog['caches'] if row['effectId'] == effect_id)
    actor = effects['actors']['/'.join(effect_id.split('/')[:3])]
    key = next(int(k, 16) for k, v in actor['resources'].items() if v.get('effectId') == effect_id)
    reference = fixture.read(fixture.cache/'research/world-descriptors-native.json')
    device = GraphicsTextureDevice(args.angle)
    n = NativeWorldDescriptors(fixture.assets/'decoder-16.21-macos', args.client, device=device)
    cases = []
    try:
        for row in controls:
            shader = GraphicsShaderCatalog(fixture.assets/'latest-shaders', device)
            n.shader_catalog = shader
            try:
                warm = fixture.activate(n, effect_id, 12345,
                    {'ticks': [1000000000]*3, 'mode': 0, 'timebase': [1, 1]}, 0, False)
                n.own_parent(warm['object'])
                n.render_parent(reference['camera'])
                n.suspend_parent(True)
                cache_meta = fixture.read(fixture.assets/'latest-parent-frame-caches'/ref['file'])
                if n.next_heap != cache_meta['nextHeap'] or [list(v) for v in sorted(n.allocations.items())] != cache_meta['allocations']:
                    raise ValueError('Native factory warm allocation history differs')
                n.initialize_descriptor_factory()
                n.supply_clock_inputs([2000000000]*3, 0, [1, 1])
                n.set_random_seed(9876)
                injected = []

                def supply(uc, address, size, user):
                    if injected or uc.reg_read(r.UC_X86_REG_RDI) != OUTPUT or uc.reg_read(r.UC_X86_REG_RSI) != DESCRIPTOR:
                        raise ValueError('Unexpected complete factory entry')
                    before = bytes(uc.mem_read(DESCRIPTOR, 0xc0))
                    if before[0x6c:0x78] != bytes(12):
                        raise ValueError('Fixture already supplied a direction')
                    uc.mem_write(DESCRIPTOR+0x6c, struct.pack('<3f', *row['vector6c']))
                    after = bytes(uc.mem_read(DESCRIPTOR, 0xc0))
                    if before[:0x6c] != after[:0x6c] or before[0x78:] != after[0x78:]:
                        raise ValueError('Direction input supply altered other descriptor fields')
                    injected.append(after.hex())

                hook = n.u.hook_add(unicorn.UC_HOOK_CODE, supply,
                    begin=n.base+0x83ddc0, end=n.base+0x83ddc0)
                try:
                    creation = n.create_supplied_descriptor(name=actor['character'], skin=actor['skinId'],
                        key=key, position=row['primaryPacketPosition'], scale=1, rate=1, flags=row['flags'])
                finally:
                    n.u.hook_del(hook)
                if len(injected) != 1:
                    raise ValueError('Original complete factory entry not observed exactly once')
                creation['preEntryDescriptorHex'] = creation['descriptorHex']
                creation['descriptorHex'] = injected[0]
                matrices = [bytes.fromhex(creation['objectHex'])[0x120:0x160],
                    bytes.fromhex(creation['synchronization']['objectHex'])[0x120:0x160],
                    bytes.fromhex(creation['initialState']['parentHex'])[0x1e0:0x220]]
                if len(set(matrices)) != 1:
                    raise ValueError('Original direction matrix changed during activation/synchronization')
                cases.append({'sourceEventId': row['sourceEventId'], 'selectedReplayDefinitionId': row['definitionId'],
                    'controlDefinitionId': effect_id, 'direction': row['vector6c'], 'creation': creation,
                    'matrixHex': matrices[0].hex()})
                print(json.dumps({'sourceEventId': row['sourceEventId'], 'completeFactoryReturned': True}), flush=True)
            finally:
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                for path, digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('Native factory shader input changed')
                shader.close()
        sources = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
            Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog)),
            *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
        report = {'schema': 1, 'kind': 'original-provider-free-direction-factory-controls',
            'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
            'decoderImageSha256': sha(n.image), 'cases': cases, 'inputs': fixture.inputs,
            'sources': {str(p.resolve()): sha(p.read_bytes()) for p in sources},
            'originalBlocks': list(n.blocks.values()),
            'scope': {'completeOriginalDescriptorFactory': True, 'suppliedDirectionInputOnly': True,
                'originalActivationAndParentSynchronization': True, 'staticControlDefinition': effect_id,
                'selectedReplayDefinitionsExecuted': False, 'replayWorldStateRecovered': False,
                'nativeMatchAcceptanceEstablished': False, 'browserExecuted': False}}
        output = fixture.cache/'research/provider-free-direction-native.json'
        output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(output), 'completeFactoryControls': len(cases)}))
    finally:
        device.close()


if __name__ == '__main__':
    main()
