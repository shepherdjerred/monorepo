"""Reject host and original guest accesses straddling omitted log queues."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from local_controller_native import guard_local_controller_log_queues
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_local_log_guard_dependencies', entry)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, runtime.Control)
    n = fixture.native
    paths = runtime.producer_paths(n) | {Path(__file__)}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    controller = n.allocate(0x640)
    read, write = n.u.mem_read, n.u.mem_write
    original = bytes([0xa5]) * 0x640
    write(controller, original)
    guard = guard_local_controller_log_queues(n, controller)
    begin, end = guard['begin'], guard['endExclusive']
    controls = []

    def rejected(label, operation):
        write(controller, original)
        try:
            operation()
        except ValueError as error:
            if 'controller disk-log queues without post-init' not in str(error):
                raise
        else:
            raise ValueError('Omitted log queue access was admitted: ' + label)
        access = n.local_controller_log_accesses[-1]
        controls.append({'label': label, 'rejected': True, 'access': access})

    for address, amount in [(begin, 1), (begin - 1, 8), (end - 1, 8)]:
        rejected('host-read-overlap', lambda a=address, s=amount: n.u.mem_read(a, s))
        rejected('host-write-overlap', lambda a=address, s=amount: n.u.mem_write(a, bytes(s)))
        rejected('original-guest-read-overlap', lambda a=address:
            n.call(0x142b810, {r.UC_X86_REG_RDI: a}))
        # Original setter's first instruction writes the supplied low32 word.
        rejected('original-guest-write-overlap', lambda a=address:
            n.call(0x367f70, {r.UC_X86_REG_RDI: a - 0x19c, r.UC_X86_REG_RSI: 0}))
    write(controller, original)
    for address, amount in [(begin - 8, 8), (end, 8), (controller + 0x44b, 1)]:
        if bytes(n.u.mem_read(address, amount)) != bytes([0xa5]) * amount:
            raise ValueError('Guard changed a disjoint constructor field')
        n.u.mem_write(address, bytes([0xa5]) * amount)
        controls.append({'label': 'disjoint-host-access', 'address': address, 'bytes': amount})
    if bytes(read(controller, 0x640)) != original:
        raise ValueError('Guard controls left supplied controller bytes changed')
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Local log guard producer changed during execution')
    output = fixture.cache / 'research/local-log-queue-guard-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'sources': sources, 'inputs': fixture.inputs,
        'originalBlocks': list(n.blocks.values()), 'guard': guard, 'controls': controls,
        'scope': {'suppliedOwnedControllerStorage': True, 'originalControllerConstructorExecuted': False,
                  'originalReadWriteInstructionsExecuted': True, 'gameReadinessClaimed': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls)}))


if __name__ == '__main__':
    main()
