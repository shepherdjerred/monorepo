"""Observe exact-build retirement under default parent settings and full emitters."""
import argparse
import json
from pathlib import Path
import struct

from vfx_retirement_native import NativeVfxRetirement, LINK_TIMERS, RETIRE, COLLECT, PARENT_TICK, MUTEX_IMPORTS
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    decoder = args.cache / 'public/decoder-16.21-macos'
    n = NativeVfxRetirement(decoder, args.client)
    bound = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    system = n.checked_json('vfx-system.json', 'vfxSystemSha256')
    sources = {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
               ['prepare-vfx-retirement.py', 'vfx_retirement_native.py']}
    for name, expected in {**bound['compilerSources'], **system['compilerSources']}.items():
        if sha(Path(__file__).with_name(name).read_bytes()) != expected:
            raise ValueError(f'Native retirement dependency changed: {name}')
    previous_path = args.cache / 'research/vfx-control-native.json'
    previous_raw = previous_path.read_bytes()
    previous = json.loads(previous_raw)
    if previous['quadPackageSha256'] != n.profile['vfxBoundQuadsSha256']:
        raise ValueError('Retirement source cohort package differs')
    selected = [case for case in previous['cases'] if case['schedule'] == 'running']
    inputs = {str(previous_path.resolve()): sha(previous_raw)}
    first_raw = (decoder / selected[0]['ref']['file']).read_bytes()
    n.reset_parent(json.loads(first_raw), 1, 0, bound, system)
    flags = []
    # Every lower flag byte under four upper-bit patterns, both supplied modes.
    for upper in [0, 0x4000, 0x8000, 0xff00]:
        for low in range(256):
            for mode in [False, True]:
                initial = upper | low
                n.put(A['system'] + 0x2a9, 'H', initial)
                n.put(A['manager'] + 0x1d8, 'I', 0)
                before = n.snapshot()
                life = n.retire(mode)
                after = n.snapshot()
                expected = initial if initial & 0x80 else ((initial & 0xff5c) | 0x82) if mode else (initial | 0xa0) & 0xfffe
                if (life['flags'] != expected or any(before[k] != after[k] for k in ['vectors', 'rngHex', 'actorHex', 'poolHex']) or
                        life['lists']['retiring']['count'] != int(not initial & 0x80)):
                    raise ValueError(f'Original retirement flags, idempotence or particle preservation differs: {initial:x}/{mode}/{life["flags"]:x}/{expected:x}')
                flags.append({'initial': initial, 'mode': mode, 'after': life['flags'],
                              'queued': life['lists']['retiring']['count']})
    cases = []
    for item in selected:
        ref = item['ref']
        path = decoder / ref['file']
        raw = path.read_bytes()
        if sha(raw) != ref['sha256']:
            raise ValueError('Retirement full graph differs')
        inputs[str(path.resolve())] = sha(raw)
        for schedule in ['running', 'mode-false', 'mode-true']:
            n.reset_parent(json.loads(raw), 1, 0, bound, system)
            initial = n.lifecycle()
            initial_os = list(n.os_calls)
            frames = []
            retired, deferred_tick = False, None
            for tick in range(181):
                n.os_calls.clear()
                value = {**item['frames'][0]['input'], 'time': tick / 30, 'maxSubsteps': 20}
                # Repeated request at the next tick must not enqueue twice.
                request = schedule != 'running' and tick in [30, 31] and deferred_tick is None
                before_request = n.lifecycle() if request else None
                if request:
                    n.retire(schedule == 'mode-true')
                    retired = True
                after_request = n.lifecycle() if request else None
                if deferred_tick is None:
                    output = n.tick_parent(value)
                    library = list(n.library_inputs)
                    collected = n.collect()
                    if collected['lists']['deferred']['count']:
                        deferred_tick = tick
                else:
                    output, library, collected = None, [], n.lifecycle()
                frames.append({'input': value, 'retirementRequested': request, 'beforeRequest': before_request,
                               'afterRequest': after_request, 'output': output, 'libraryInputs': library,
                               'collected': collected, 'osCalls': list(n.os_calls)})
            if schedule != 'running' and (not retired or deferred_tick is None):
                raise ValueError('Controlled retirement did not reach deferred disposal')
            if schedule == 'running' and deferred_tick is not None:
                raise ValueError('Unqueued running system entered disposal')
            cases.append({'ref': ref, 'schedule': schedule, 'seedHex': '0000000000000001', 'quality': 0,
                          'createdAt': 0, 'initial': initial, 'initialOsCalls': initial_os,
                          'deferredTick': deferred_tick, 'frames': frames})
            print(json.dumps({'effect': ref['effectId'], 'schedule': schedule, 'deferredTick': deferred_tick}), flush=True)
    ranges = [(RETIRE, 0x1761c0a), (COLLECT, 0x174c63f), LINK_TIMERS, (PARENT_TICK, 0x1763b3b),
              (0x14da350, 0x14da35a), (0x14da360, 0x14da36a)]
    ranges += [(b['startRva'], b['endRva']) for b in system['sourceBlocks']]
    for start, end in ranges:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Retirement original instructions changed')
    meta = {'schema': 1, 'kind': 'native-system-retirement', 'build': bound['build'], 'protocol': bound['protocol'],
            'sliceSha256': bound['sliceSha256'], 'decoderImageSha256': bound['decoderImageSha256'],
            'runtimeSha256': bound['runtimeSha256'], 'quadPackageSha256': n.profile['vfxBoundQuadsSha256'],
            'systemPackageSha256': n.profile['vfxSystemSha256'], 'retireRva': RETIRE, 'collectorRva': COLLECT,
            'parentTickRva': PARENT_TICK, 'linkTimerBlock': list(LINK_TIMERS), 'mutexImports': MUTEX_IMPORTS,
            'rootConstructorRva': system['rootConstructorRva'], 'basisRva': system['basisRva'],
            'initializers': system['initializers'], 'nativeQualityMultipliersHex': system['nativeQualityMultipliersHex'],
            'sourceBlocks': [{'startRva': a, 'endRva': b, 'sha256': sha(n.image[a:b])} for a, b in dict.fromkeys(ranges)],
            'compilerSources': sources, 'scope': {'complexEmitters': 1, 'simpleEmitters': 0, 'meshSiblings': 0,
                'defaultParentDefinition': True, 'authoredEmitterBytesUnchanged': True, 'singleThreadMutexModel': True,
                'audioIdsAbsent': True, 'deferredDisposalOnly': True, 'destructorExecuted': False,
                'replayEventMapping': False, 'mainViewerIntegrated': False}}
    package_raw = json.dumps(meta, indent=2).encode()
    output = args.cache / 'public/latest-vfx-retirement/package.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(package_raw)
    result = {'schema': 1, 'kind': 'native-system-retirement-observations', 'build': bound['build'], 'protocol': bound['protocol'],
              'packageSha256': sha(package_raw), 'sources': sources, 'inputs': inputs, 'originalBlocks': list(n.blocks.values()),
              'flags': flags, 'cases': cases,
              'counts': {'flagProbes': len(flags), 'graphs': len(selected), 'cases': len(cases),
                         'frames': sum(len(c['frames']) for c in cases),
                         'executedTicks': sum(f['output'] is not None for c in cases for f in c['frames']),
                         'deferredCases': sum(c['deferredTick'] is not None for c in cases)},
              'scope': {**meta['scope'], 'suppliedSeed': 1, 'suppliedQuality': 0, 'clockHz': 30,
                        'originalDarwinMath': False, 'browserRun': False, 'leagueReferenceCompared': False}}
    (args.cache / 'research/vfx-retirement-native.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'packageSha256': sha(package_raw), 'counts': result['counts']}))


if __name__ == '__main__':
    main()
