"""Compare cached host block evidence with unchanged native particle execution.

This is an offline observer optimization control, not a browser effects runtime
or a measurement of the complete hero/bootstrap setup.
"""
import argparse
import inspect
import json
from pathlib import Path
import statistics
import time
from types import SimpleNamespace

from pristine_block_cache_native import NativePristineBlockCache
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import NativeSpawn, SERVICES, sha


class CachedLoaded(NativeLoadedQuad, NativePristineBlockCache, NativeSpawn):
    pass


class EvidenceObserver:
    def check_block(self, engine, address, size, user):
        if self.exclude:
            return
        super().check_block(engine, address, size, user)
        if self.record and address - self.base in self.blocks:
            self.phase_records[address - self.base] = self.blocks[address - self.base]


class CacheCarrier(EvidenceObserver, NativePristineBlockCache, NativeSpawn):
    pass


class WrongOrder(NativePristineBlockCache, EvidenceObserver, NativeSpawn):
    pass


def carrier(reference, prepared=None, cls=CacheCarrier):
    # Host-only guard tests use the real NativeSpawn.check_block implementation;
    # deliberately corrupt code bytes are never executed by Unicorn.
    n = object.__new__(cls)
    n.base = reference.base
    n.image = reference.image if prepared is None else prepared
    n.source = SimpleNamespace(image=reference.source.image, imports=reference.source.imports)
    n.blocks, n.phase_records = {}, {}
    n.record, n.exclude = False, False
    n.pristine_block_cache = None
    n.initialize_pristine_block_cache()
    return n


def must_reject(callback, message):
    try:
        callback()
    except ValueError as error:
        if message not in str(error):
            raise AssertionError('Unexpected guard failure: ' + str(error)) from error
        return
    raise AssertionError('Expected guard rejection: ' + message)


def guard_controls(reference):
    at = 0x1757f10
    n = carrier(reference)
    for size in [4, 7, 4]:
        n.check_block(None, n.base + at, size, None)
        if n.blocks[at] != {'rva': at, 'size': size, 'sha256': sha(n.image[at:at + size])}:
            raise AssertionError('Changed-size block evidence differs')
    if len(n.pristine_block_cache) != 2 or n.pristine_block_cache_hits != 1:
        raise AssertionError('Cache must identify block start and size independently')
    n.record = True
    n.check_block(None, n.base + at, 4, None)
    if n.phase_records[at] != n.blocks[at]:
        raise AssertionError('A cache hit bypassed the outer observer evidence')
    hits = n.pristine_block_cache_hits
    n.exclude = True
    n.check_block(None, n.base + at, 4, None)
    if n.pristine_block_cache_hits != hits:
        raise AssertionError('A cache hit bypassed an outer observer exclusion')
    n.exclude = False
    for boundary in [SERVICES[0], next(iter(n.source.imports))]:
        n.check_block(None, n.base + boundary, 4, None)
        if (boundary, 4) in n.pristine_block_cache:
            raise AssertionError('An excluded platform boundary became original evidence')
    changed = bytearray(reference.image)
    changed[at] ^= 1
    corrupt = carrier(reference, bytes(changed))
    must_reject(lambda: NativeSpawn.check_block(corrupt, None, corrupt.base + at, 4, None),
                'differs from pristine')
    must_reject(lambda: corrupt.check_block(None, corrupt.base + at, 4, None),
                'differs from pristine')
    if corrupt.pristine_block_cache:
        raise AssertionError('A rejected block was cached')
    for field, mutable in [('image', False), ('source', False), ('source', True)]:
        replaced = carrier(reference)
        replaced.check_block(None, replaced.base + at, 4, None)
        if field == 'image':
            replaced.image = bytes(bytearray(replaced.image))
        else:
            replaced.source.image = bytearray(replaced.source.image)
            if not mutable:
                replaced.source.image = bytes(replaced.source.image)
        must_reject(lambda: replaced.check_block(None, replaced.base + at, 4, None),
                    'images changed after freezing')
    must_reject(lambda: carrier(reference, bytearray(reference.image)), 'immutable bytes')
    must_reject(lambda: carrier(reference, cls=WrongOrder), 'immediately precede NativeSpawn')
    return {'changedBlockSizes': [4, 7, 4], 'pristineMismatchRejected': True,
            'sourceReplacementRejected': True, 'mutablePreparedImageRejected': True,
            'outerObserverEvidencePreserved': True, 'outerBoundaryExclusionPreserved': True,
            'platformBoundariesUncached': True, 'incorrectMroRejected': True,
            'corruptGuestInstructionsExecuted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    package = cache / 'public/decoder-16.21-macos'
    inputs = {}

    def raw(path):
        path = Path(path).resolve()
        encoded = path.read_bytes()
        digest = sha(encoded)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Input changed during native block-cache control: ' + str(path))
        inputs[str(path)] = digest
        return encoded

    reference = json.loads(raw(cache / 'research/direct-loaded-schedule-native.json'))
    metadata = json.loads(raw(package / 'vfx-loaded-quads.json'))
    if sha(raw(package / 'vfx-loaded-quads.json')) != reference['quadPackageSha256']:
        raise ValueError('Native component package differs')
    # Choose the heaviest observed geometry cohorts without champion branches.
    selected = sorted(reference['cases'], key=lambda case:
        sum(len(frame['output']['geometry']['verticesHex']) for frame in case['frames']), reverse=True)[:3]
    graphs = []
    for case in selected:
        rows = [row for row in metadata['templates'] if row['effectId'] == case['effectId'] and
                row['emitterIndex'] == case['emitterIndex']]
        if len(rows) != 1:
            raise ValueError('Unique native graph required')
        encoded = raw(package / rows[0]['file'])
        if sha(encoded) != case['graphSha256'] or sha(encoded) != rows[0]['sha256']:
            raise ValueError('Native graph input changed')
        graphs.append((case, json.loads(encoded)))
    source_paths = {Path(__file__), Path(inspect.getfile(NativePristineBlockCache)),
                    *[Path(inspect.getfile(cls)) for cls in CachedLoaded.__mro__
                      if cls is not object]}
    for path in source_paths:
        raw(path)
    runs = []
    proofs = []
    guards = None
    for label, cls in [('baseline-before', NativeLoadedQuad), ('cached', CachedLoaded),
                       ('baseline-after', NativeLoadedQuad)]:
        n = cls(package, args.client)
        if n.profile['decoderImageSha256'] != reference['decoderImageSha256']:
            raise ValueError('Exact native image required')
        if guards is None:
            guards = guard_controls(n)
        samples, results = [], []
        for case, graph in graphs:
            for seed in [0x12345, 0xabcdef01]:
                n.reset_quad(graph, seed, 0)
                previous = [0, 0, 0]
                for tick in range(121):
                    clock = tick / 60
                    current = [clock * 130, clock * 3, clock * 70]
                    value = {'time': clock, 'previous': previous, 'current': current,
                             'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                             'viewPosition': [0, 1000, 0]}
                    started = time.perf_counter()
                    result = n.frame_quad(value)
                    samples.append((time.perf_counter() - started) * 1000)
                    results.append({'effectId': case['effectId'], 'emitterIndex': case['emitterIndex'],
                                    'seedHex': f'{seed:016x}', 'tick': tick, 'output': result})
                    previous = current
        proof = {'framesSha256': sha(json.dumps(results, sort_keys=True, separators=(',', ':')).encode()),
                 'blocks': sorted(n.blocks.values(), key=lambda row: row['rva'])}
        proofs.append(proof)
        run = {'label': label, 'frames': len(samples), 'frameMsTotal': sum(samples),
               'frameMsMedian': statistics.median(samples),
               'frameMsP95': sorted(samples)[(len(samples) * 95 + 99) // 100 - 1],
               'framesSha256': proof['framesSha256'], 'originalBlockCount': len(proof['blocks']),
               'cache': n.pristine_block_cache_statistics() if label == 'cached' else None}
        runs.append(run)
        print(json.dumps(run), flush=True)
    if any(proof != proofs[0] for proof in proofs[1:]):
        raise AssertionError('Native states, RNG, geometry or executed original block evidence differ')
    for path in list(inputs):
        raw(path)
    result = {'schema': 1, 'kind': 'native-pristine-block-evidence-cache-control',
              'build': reference['build'], 'protocol': reference['protocol'], 'inputs': inputs,
              'runs': runs, 'guards': guards,
              'sameOriginalStatesRngGeometryAndBlockEvidence': True,
              'cachedTotalVsBaselineMean': runs[1]['frameMsTotal'] /
                  statistics.mean([runs[0]['frameMsTotal'], runs[2]['frameMsTotal']]),
              'scope': {'realUnicornExecution': True, 'suppliedClockPoseAndSeeds': True,
                        'originalInstructionsReplaced': False, 'wholeProcessSnapshotRestored': False,
                        'completeHeroBootstrapTiming': False, 'browserEffectsPerformance': False}}
    output = cache / 'research/pristine-block-cache-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'sameEvidence': True,
                      'cachedTotalVsBaselineMean': result['cachedTotalVsBaselineMean']}), flush=True)


if __name__ == '__main__':
    main()
