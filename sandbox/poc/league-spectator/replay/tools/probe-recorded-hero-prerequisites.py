"""Focused current-main MRO, original startup and cold-Hero interoperability.

No recorded packet is dispatched and no unit/resource acceptance is implied.
"""
import argparse
import importlib.util
import inspect
import json
from pathlib import Path
import sys
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import NativeSpawn, sha
from skinned_vertex_buffer_native import NativeSkinnedVertexBuffers
from material_shader_defines_native import NativeMaterialShaderDefines
from material_uniform_update_native import NativeMaterialUniformUpdates

path = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('current_recorded_hero_prerequisite_subject', path)
subject = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = subject
spec.loader.exec_module(subject)


class Baseline(subject.NativeRecordedHeroInputs, NativeSpawn):
    pass


def run(args, cls):
    fixture = NativeAIUnitFixture(args.cache, args.client, cls)
    n = fixture.native
    publication_trace = subject.install_resource_publication_trace(n)
    corpus = fixture.read(fixture.cache / 'research/structural-corpus.json')
    observations = fixture.read(fixture.cache / 'research/structural-corpus-native.json')
    semantics = fixture.read(fixture.cache / 'research/latest-semantics-effects.json')
    codecs = fixture.read(fixture.cache / 'public/decoder-16.21-macos/field-codecs.json')
    selected = [(key, row) for key, row in corpus['packets'].items()
                if row['opcode'] == 1049 and row['time'] == 0]
    if len(selected) != 1:
        raise ValueError('One actual initial recorded hero candidate required')
    key, sample = selected[0]
    observation = observations['observations'][key]
    if observation['status'] != 'complete' or observation['payloadSha256'] != sha(bytes.fromhex(sample['payloadHex'])):
        raise ValueError('Actual initial recorded hero observation differs')
    packet = bytes.fromhex(observation['object'])
    columns = codecs['codecs']['heroNetworkId']['decode']
    entity = int.from_bytes(bytes(columns[lane][packet[56 + lane]] for lane in range(4)), 'little')
    heroes = [hero for hero in semantics['heroes'] if hero['entityId'] == entity]
    if len(heroes) != 1:
        raise ValueError('Recorded packet does not select one canonical roster object')
    hero = heroes[0]
    n.initialize_asset_arena(128)
    setup = {'audio': n.initialize_audio_facade(), 'ui': n.initialize_ui_data_prefix(),
             'product': subject.initialize_product_configuration(n, 'LoL'),
             'characterTypes': n.initialize_character_types(),
             'modeTypes': subject.initialize_mode_dependency_types(n),
             'aiMaterialOwner': subject.initialize_ai_material_owner_type(n),
             'heroTypes': subject.initialize_hero_client_types(n, reuse_existing=True),
             'unitCollection': subject.initialize_unit_collection(n),
             'visibilityRegistry': subject.initialize_visibility_component_registry(n),
             'staticSkin': subject.configure_installed_skin_vertices(
                 fixture, args.installation, hero)}
    rejected = []
    for bad in [{key:value for key,value in hero.items() if key != 'skinId'} | {'skin': hero['skinId']},
                {**hero, 'skinId': -1}, {**hero, 'skinId': str(hero['skinId'])}]:
        try:
            subject.configure_installed_skin_vertices(fixture, args.installation, bad)
        except ValueError:
            rejected.append(True)
        else:
            raise ValueError('Noncanonical decoded appearance input was admitted')
    setup['staticSkinInputRejectControls'] = len(rejected)
    setup['actualRecordedHeroInput'] = hero
    if (n.buffer_create.__func__ is not NativeSkinnedVertexBuffers.buffer_create or
            n.shader_call.__func__ is not NativeMaterialShaderDefines.shader_call or
            n.material_uniform_update.__func__ is not NativeMaterialUniformUpdates.material_uniform_update):
        raise ValueError('Current main MRO does not select the verified shared platform methods')
    if (setup['staticSkin']['staticShape']['vertexBytes'] != 368420 or
            setup['staticSkin']['admittedLargeInputs']):
        raise ValueError('Actual installed Jinx2 shape incorrectly admitted a larger SKN request')
    unit = n.allocate(0x4aa0)
    n.u.mem_write(unit + 0x49a0, b'\xa5' * 0x100)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    setup['heroClientCast'] = subject.verify_hero_client_cast(n, unit)
    n.call(0x14b6410, {r.UC_X86_REG_RDI: n.base + 0x2531558,
                      r.UC_X86_REG_RSI: unit + 8, r.UC_X86_REG_RDX: n.base + 0x25464d0})
    if n.u.reg_read(r.UC_X86_REG_RAX) != unit + 0x18:
        raise ValueError('Current main cold-Hero material owner-interface cast differs')
    n.call(0x549b60, {r.UC_X86_REG_RDI: unit + 0x18})
    if n.u.reg_read(r.UC_X86_REG_RAX) & 255:
        raise ValueError('Current main cold-Hero original material predicate differs')
    if bytes(n.u.mem_read(unit + 0x49a0, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Current main cold-Hero guard changed')
    sources = {str(p.resolve()): sha(p.read_bytes()) for p in subject.producer_paths(n)}
    sources[str(Path(__file__).resolve())] = sha(Path(__file__).read_bytes())
    publication_snapshot = publication_trace.snapshot()
    publication_trace.close()
    return {'setup': setup, 'unit': unit, 'unitHex': bytes(n.u.mem_read(unit, 0x49a0)).hex(),
            'resourcePublicationTrace': publication_snapshot,
            'nextHeap': n.next_heap, 'heapHighWater': n.heap_high_water,
            'allocations': n.allocations, 'blocks': list(n.blocks.values()),
            'inputs': fixture.inputs, 'sources': sources,
            'methodChains': {name: [inspect.getfile(c) for c in cls.__mro__ if name in vars(c)]
                             for name in ['buffer_create', 'shader_call', 'vector']},
            'pristineCache': n.pristine_block_cache_statistics() if hasattr(n, 'pristine_block_cache_statistics') else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'installation']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    baseline, current = run(args, Baseline), run(args, subject.Control)
    for key in ['unit', 'unitHex', 'nextHeap', 'heapHighWater', 'allocations', 'blocks']:
        if baseline[key] != current[key]:
            raise ValueError('Current pristine-cache MRO changed original initialization: ' + key)
    inputs = {}
    for row in [baseline, current]:
        for key in ['inputs', 'sources']:
            for path, digest in row[key].items():
                if sha(Path(path).read_bytes()) != digest:
                    raise ValueError('Prerequisite producer changed: ' + path)
                if path in inputs and inputs[path] != digest:
                    raise ValueError('Prerequisite input changed between current/baseline controls')
                inputs[path] = digest
    packages = [args.cache / 'public' / name / 'package.json' for name in
                ['latest-shared-shaders', 'latest-shared-shaders-p1-837a61']]
    manifests = []
    for path in packages:
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        manifests.append(json.loads(data))
    base, superset = manifests
    for key in ['schema', 'kind', 'build', 'executableSha256', 'archive', 'archiveSha256', 'compiler']:
        if base[key] != superset[key]:
            raise ValueError('Cached shader package changes its original build/compiler contract')
    for field, key in [('stages', lambda row: (row['stage'], row['file'])),
                       ('translations', lambda row: (row['stage'], row['dxbcSha256'])),
                       ('bundles', lambda row: row['path'])]:
        index = {key(row): row for row in superset[field]}
        if len(index) != len(superset[field]) or any(index.get(key(row)) != row for row in base[field]):
            raise ValueError('Cached shader package changed or omitted an original ' + field)
    result = {'schema': 1, 'kind': 'current-recorded-hero-prerequisite-mro-control',
              'build': '16.21.829.8620', 'baseline': baseline, 'current': current, 'inputs': inputs,
              'identicalOriginalUnitAndAllocationAndBlocks': True,
              'cachedShaderSuperset': {'path': str(packages[1].parent.resolve()),
                                      'baseStages': len(base['stages']), 'stages': len(superset['stages']),
                                      'baseTranslations': len(base['translations']),
                                      'translations': len(superset['translations']),
                                      'originalStageAndTranslationAndBundleEntriesUnchanged': True},
              'scope': {'originalColdHeroConstructor': True, 'originalOwnerInterfaceCast': True,
                        'originalUnitCollectionAndVisibilityStartup': True,
                        'staticInstalledSkinShapeValidated': True, 'fullRecordedHandlerExecuted': False,
                        'acceptedReplayEntities': False, 'resourceSelectionRecovered': False,
                        'gpuUniformCallsiteExecuted': False}}
    output = args.cache / 'research/recorded-hero-prerequisites-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'fingerprints': len(inputs),
                      'identicalOriginalUnitAndAllocationAndBlocks': True}))


if __name__ == '__main__':
    main()
