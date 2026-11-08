"""Observe original effect-object creation and scalar inputs on complete roots.

The manager's independent initialization blocks execute. Its platform worker
pool and complete constructor do not. Unknown bytes retain allocator poison.
"""
import argparse
import json
from pathlib import Path
import struct

from vfx_object_native import NativeVfxObjects, MANAGER, OWNED_MANAGER_BLOCKS, TAG_STARTUP
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']: parser.add_argument(name, type=Path)
    args = parser.parse_args(); cache = args.cache.resolve(); decoder = cache / 'public/decoder-16.21-macos'
    inputs = {}
    def read(path):
        raw = path.read_bytes(); inputs[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    systems_path = cache / 'public/latest-vfx-system-assets/package.json'; systems = read(systems_path)
    descriptors = read(cache / 'research/effect-descriptor-comparison.json')
    bindings = read(cache / 'research/effect-creation-comparison.json')
    n = NativeVfxObjects(decoder, args.client)
    if systems['build'] != n.profile['clientVersion'] or systems['protocol'] != n.profile['protocolDigest']:
        raise ValueError('Object factory asset build differs')
    schedule = [{'effectId': effect_id, 'kind': 'prepared-root', 'sourceSequence': None, 'firstBits': 0x3f800000,
        'secondBits': 0x3f800000, 'objects': 1} for effect_id in sorted(systems['systems'])]
    for binding in bindings['bindings']:
        if binding['status'] != 'prepared-context-resource': continue
        descriptor = descriptors['records'][binding['creationSequence']]
        if descriptor['entityId'] != binding['entityId']: raise ValueError('Object descriptor binding differs')
        schedule.append({'effectId': binding['effectId'], 'kind': 'recorded-scalar-inputs', 'sourceSequence': binding['creationSequence'],
            'firstBits': descriptor['scalarBits']['scalar78'], 'secondBits': descriptor['scalarBits']['scalar7c'], 'objects': 1})
    schedule.append({'effectId': schedule[0]['effectId'], 'kind': 'pending-queue-growth', 'sourceSequence': None,
        'firstBits': 0x3fc00000, 'secondBits': 0x41000000, 'objects': 17})
    cases, quality = [], None
    for index, case in enumerate(schedule):
        ref = systems['systems'][case['effectId']]; graph = read(cache / 'public/latest-vfx-system-assets' / ref['file'])
        if inputs[str((cache / 'public/latest-vfx-system-assets' / ref['file']).resolve())] != ref['sha256']:
            raise ValueError('Object root graph changed')
        n.load_prepared_system(graph); n.initialize_owned_manager(0, False)
        values = list(struct.unpack('<ffffff', n.u.mem_read(MANAGER + 0x284, 24)))
        if values != [1.0] * 6: raise ValueError('Original pattern fill did not initialize six one multipliers')
        quality = values
        observations = []
        for ordinal in range(case['objects']):
            address = n.create_object(); initial = bytes(n.u.mem_read(address, 0x238)).hex()
            n.set_scalars(address, case['firstBits'], case['secondBits']); configured = bytes(n.u.mem_read(address, 0x238)).hex()
            n.mark_ready(address); ready = bytes(n.u.mem_read(address, 0x238)).hex()
            observations.append({'address': address, 'initialHex': initial, 'configuredHex': configured, 'readyHex': ready})
        state = n.observe_objects()
        if bytes(n.u.mem_read(0x10020000, 0x160)).hex() != graph['objectHex'] or bytes(n.u.mem_read(graph['heapStart'], ref['heapBytes'])).hex() != graph['heapHex']:
            raise ValueError('Object creation mutated authored system asset')
        cases.append({**case, 'case': index, 'graphSha256': ref['sha256'], 'observations': observations, 'state': state})
        if index % 400 == 0: print(json.dumps({'cases': index + 1, 'total': len(schedule)}), flush=True)
    ranges = [*OWNED_MANAGER_BLOCKS, TAG_STARTUP, (0x174b760, 0x174b928), (0x17652c0, 0x1765550),
        (0x1767120, 0x1767132), (0x1755ea0, 0x1755eb2), (0x1765950, 0x176595a),
        (0x14b7be0, 0x14b7c63), (0x18115b0, 0x1811627), (0x1811440, 0x18115a8), (0x20ca070, 0x20ca080)]
    for a,b in ranges:
        if n.image[a:b] != n.source.image[a:b]: raise ValueError('Object code differs from pristine client')
    names = ['prepare-vfx-objects.py', 'vfx_object_native.py', 'vfx_system_asset_native.py', 'vfx_retirement_native.py']
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in names}
    package = {'schema': 1, 'kind': 'native-vfx-object-creation', 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': n.profile['decoderImageSha256'], 'sliceSha256': n.profile['sliceSha256'],
        'systemsPackageSha256': inputs[str(systems_path.resolve())], 'spawnPackageSha256': n.profile['vfxSpawnSha256'],
        'managerAddress': MANAGER, 'managerBytes': 0x3a8, 'rootAddress': 0x10020000, 'objectBytes': 0x238,
        'managerBlocks': [list(block) for block in OWNED_MANAGER_BLOCKS], 'tagStartupBlock': list(TAG_STARTUP),
        'factoryRva': 0x174b760, 'constructorRva': 0x17652c0, 'firstScalarRva': 0x1767120, 'secondScalarRva': 0x1755ea0,
        'readyRva': 0x1765950, 'qualityMultiplierBytesHex': struct.pack('<ffffff', *quality).hex(),
        'mutexOffsets': [0x190, 0x1e0, 0x240], 'imports': {'_memset_pattern16': 0x1feea56, '_pthread_mutexattr_destroy': 0x1feec0c,
            '_pthread_mutexattr_init': 0x1feec12, '_pthread_mutexattr_settype': 0x1feec18,
            '_pthread_mutex_init': 0x1feebf4, '_pthread_mutex_lock': 0x1feebfa, '_pthread_mutex_unlock': 0x1feec06},
        'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a,b in ranges], 'compilerSources': sources,
        'scope': {'independentManagerInitializersExecuted': True, 'originalObjectFactoryExecuted': True,
            'completeManagerConstructorExecuted': False, 'workerPoolExecuted': False, 'parentActivationExecuted': False,
            'resourceAcquisitionExecuted': False, 'worldRegistryExecuted': False, 'mainViewerIntegrated': False}}
    raw = json.dumps(package, indent=2).encode(); out = cache / 'public/latest-vfx-objects/package.json'
    out.parent.mkdir(exist_ok=True); out.write_bytes(raw)
    counts = {'cases': len(cases), 'preparedRoots': len(systems['systems']), 'recordedInputs': sum(case['kind'] == 'recorded-scalar-inputs' for case in cases),
        'objects': sum(case['objects'] for case in cases), 'objectStageBytes': sum(case['objects'] for case in cases) * 0x238 * 3,
        'queueGrowthObjects': 17}
    evidence = {'schema': 1, 'kind': 'native-vfx-object-observations', 'build': package['build'], 'protocol': package['protocol'],
        'packageSha256': sha(raw), 'inputs': inputs, 'sources': sources, 'originalBlocks': list(n.blocks.values()),
        'qualityMultipliers': quality, 'cases': cases, 'counts': counts, 'scope': package['scope']}
    (cache / 'research/vfx-objects-native.json').write_text(json.dumps(evidence, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(raw), 'counts': counts, 'qualityMultipliers': quality}), flush=True)


if __name__ == '__main__':
    main()
