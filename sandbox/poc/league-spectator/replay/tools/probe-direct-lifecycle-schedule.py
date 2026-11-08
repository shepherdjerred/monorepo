"""Whole original emitter stop/tail schedules at supplied canonical 60Hz.

The original parent scheduler is deliberately not substituted for the direct
clock. Parent retirement requests and final single-emitter completion/collector
execute unchanged; whole-match sibling closure and audio remain outside scope.
"""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A, sha


class LifecycleQuad(NativeVfxRetirement):
    def __init__(self, *args):
        super().__init__(*args)
        self.tracing = False
        self.trace = []
        for at in [0x1757f10, 0x175b1e0, 0x175b361]:
            self.u.hook_add(unicorn.UC_HOOK_CODE, self.capture, begin=self.base + at, end=self.base + at)

    def capture(self, uc, address, size, user):
        if not self.tracing:
            return
        at = address - self.base
        actor = self.u.reg_read(r.UC_X86_REG_RDI) if at != 0x175b361 else self.u.reg_read(r.UC_X86_REG_R14)
        if actor != A['actor']:
            raise ValueError('Unowned lifecycle actor')
        pool = self.q(A['actor'] + 0xa0)
        count = struct.unpack('<H', self.u.mem_read(pool + 0x10, 2))[0]
        if count > 1024:
            raise ValueError('Owned lifecycle particle bound')
        life = self.q(pool + 8)
        if count and not 0x10400000 <= life <= self.next_heap - count * 8:
            raise ValueError('Owned lifecycle particle input')
        param = self.u.reg_read(r.UC_X86_REG_RDX) if at == 0x175b1e0 else None
        self.trace.append({'rva': at, 'actorHex': bytes(self.u.mem_read(A['actor'], 0x128)).hex(),
            'parentFlags': struct.unpack('<H', self.u.mem_read(A['system'] + 0x2a9, 2))[0],
            'linkControllerCount': struct.unpack('<I', self.u.mem_read(A['link'] + 0x80, 4))[0],
            'linkTimersHex': bytes(self.u.mem_read(A['link'] + 0x90, 8)).hex(),
            'time': struct.unpack('<f', struct.pack('<I', self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0] if at == 0x1757f10 else
                    struct.unpack('<f', self.u.mem_read(param + 0x18, 4))[0] if param else None,
            'stopRequested': bool(self.u.reg_read(r.UC_X86_REG_RSI) & 255) if param else None,
            'particlesHex': bytes(self.u.mem_read(life, count * 8)).hex() if count else '', 'count': count})


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    decoder = cache / 'public/decoder-16.21-macos'
    inputs = {}
    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    n = LifecycleQuad(decoder, args.client)
    bound = n.checked_json('vfx-bound-quads.json', 'vfxBoundQuadsSha256')
    system = n.checked_json('vfx-system.json', 'vfxSystemSha256')
    metadata = {kind: read(decoder / f'vfx-{kind}-quads.json') for kind in ['camera', 'loaded']}
    manifest = read(cache / 'public/latest-effects/manifest.json')
    profile = read(decoder / 'profile.json')
    for kind, key in [('camera', 'vfxCameraQuadsSha256'), ('loaded', 'vfxLoadedQuadsSha256')]:
        if inputs[str((decoder / f'vfx-{kind}-quads.json').resolve())] != profile[key]:
            raise ValueError('Exact prepared original quad metadata required')
    cases = []
    for kind, identity, index in [('camera', 'champions/ornn/0/aec06c7c', 0), ('loaded', 'champions/ornn/0/b4161d97', 7)]:
        matches = [v for v in metadata[kind]['templates'] if v['effectId'] == identity and v['emitterIndex'] == index]
        if len(matches) != 1:
            raise ValueError('Exact current component graph required')
        ref = matches[0]
        graph_raw = raw(decoder / ref['file'])
        if sha(graph_raw) != ref['sha256']:
            raise ValueError('Original graph changed')
        source = raw(cache / 'public/latest-effects' / manifest['definitions'][identity]['file'])
        if sha(source) != ref['sourceDefinitionSha256']:
            raise ValueError('Original authored definition changed')
        graph = json.loads(graph_raw)
        for seed in [1, 0x12345]:
            for mode in ['running', 'mode-false', 'mode-true']:
                n.tracing = False
                n.reset_parent(graph, seed, 0, bound, system)
                # Supplied runtime word, matching a separately observed complete
                # factory. This does not execute full factory/placement here.
                n.put(A['system'] + 0x2a9, 'H', 0x8000)
                initial = n.lifecycle()
                frames = []
                previous = [0, 0, 0]
                deferred = None
                request_tick = 6 if kind == 'loaded' else 30
                for tick in range(145):
                    time = tick / 60
                    requested = mode != 'running' and tick in [request_tick, request_tick + 1] and deferred is None
                    after_request = n.retire(mode == 'mode-true') if requested else None
                    frame = {'time': time, 'previous': previous, 'current': [time * 130, time * 3, time * 70],
                        'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                        'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0],
                        'viewAxis': [0, 0, 1], 'multTexturePresent': False}
                    n.trace = []
                    if deferred is None:
                        n.tracing = True
                        output = n.frame_bound(frame)
                        n.tracing = False
                        # Original aggregation for precisely this owned actor;
                        # omitted source siblings are not claimed complete.
                        n.fragment(0x17638f3, 0x1763a3d, {r.UC_X86_REG_RBX: A['system'],
                            r.UC_X86_REG_EAX: struct.unpack('<H', n.u.mem_read(A['system'] + 0x2a9, 2))[0]})
                        collected = n.collect()
                        if collected['lists']['deferred']['count']:
                            deferred = tick
                    else:
                        output, collected = None, n.lifecycle()
                    frames.append({'input': frame, 'retirementRequested': requested, 'afterRequest': after_request,
                        'output': output, 'trace': list(n.trace), 'collected': collected})
                    previous = frame['current']
                if mode != 'running' and deferred is None:
                    raise ValueError('Bounded original retirement did not reach deferred queue')
                cases.append({'effectId': identity, 'emitterIndex': index, 'primitiveKind': kind, 'ref': ref,
                    'seedHex': f'{seed:016x}', 'schedule': mode, 'initial': initial, 'deferredTick': deferred,
                    'requestTick': request_tick, 'frames': frames})
                print(json.dumps({'effect': identity, 'seed': seed, 'mode': mode, 'deferredTick': deferred}), flush=True)
    sources = {str(Path(__file__).resolve()): sha(Path(__file__).read_bytes())}
    for cls in type(n).__mro__:
        if cls is not object:
            path = Path(inspect.getfile(cls))
            sources[str(path.resolve())] = sha(path.read_bytes())
    for name in ['vfx-system.json', 'vfx-bound-quads.json']:
        raw(decoder / name)
    result = {'schema': 1, 'kind': 'native-direct-emitter-lifecycle-schedule', 'build': bound['build'],
        'protocol': bound['protocol'], 'inputs': inputs, 'sources': sources, 'originalBlocks': list(n.blocks.values()),
        'cases': cases, 'scope': {'clockHz': 60, 'originalParentSchedulerExecuted': False,
            'runtimeParentFlagWordSupplied': 0x8000, 'originalRetirementRequest': True,
            'completeSingleEmitterGraphRetained': True, 'sourceSiblingClosureRecovered': False,
            'audioAbsent': True, 'destructorExecuted': False, 'nativeWorldAcceptance': False}}
    output = cache / 'research/direct-lifecycle-schedule-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(v['frames']) for v in cases)}))


if __name__ == '__main__':
    main()
