"""Verify shared task binding and separate asset/component semaphore ownership."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from mach_semaphores_native import SIGNAL
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_mach_asset_interop_dependencies', entry)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    controls = []
    for generic_first in [True, False]:
        fixture = NativeAIUnitFixture(args.cache, args.client, runtime.Control)
        n = fixture.native
        paths = runtime.producer_paths(n) | {Path(__file__)}
        sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
        n.initialize_asset_arena(64)
        if generic_first:
            platform = n.initialize_mach_semaphore_platform()
        queue = n.initialize_asset_work_queue()
        completion = n.initialize_asset_completion_dispatcher(1)
        if not generic_first:
            platform = n.initialize_mach_semaphore_platform()
        cell = n.allocate(4)
        n.call(0x142b6e0, {r.UC_X86_REG_RDI: cell, r.UC_X86_REG_RSI: 1})
        if len(n.asset_semaphores) != 3 or len(n.mach_semaphores) != 1:
            raise ValueError('Asset/component semaphore ownership overlapped')
        for token in n.asset_semaphores:
            n.call(SIGNAL, {r.UC_X86_REG_RDI: token})
        n.consume_asset_wakeups()
        n.call(0x142b720, {r.UC_X86_REG_RDI: cell})
        if any(state['count'] for state in [*n.asset_semaphores.values(), *n.mach_semaphores.values()]):
            raise ValueError('Independent semaphore counters were not consumed')
        if n.q(n.base + 0x22e03f8) != platform['taskPortCell']:
            raise ValueError('Original asset initialization changed shared task binding')
        for path, digest in sources.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Mach/asset interoperability producer changed')
        controls.append({'genericPlatformFirst': generic_first, 'platform': platform,
            'assetQueue': queue, 'completionDispatcher': completion,
            'assetSemaphoreCounters': list(n.asset_semaphores.values()),
            'componentSemaphores': n.mach_semaphore_summary(), 'sources': sources,
            'inputs': fixture.inputs, 'originalBlocks': list(n.blocks.values())})
    output = args.cache / 'research/mach-asset-queue-interop-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'controls': controls,
        'scope': {'originalQueueDataInitializationExecuted': True,
                  'assetOrComponentWorkerCreated': False, 'jobReadinessSupplied': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'initializationOrders': len(controls),
                      'independentSemaphoresPerOrder': 4}))


if __name__ == '__main__':
    main()
