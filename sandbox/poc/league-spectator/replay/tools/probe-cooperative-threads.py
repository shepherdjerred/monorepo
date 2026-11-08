"""Verify queued native threads, guarded execution and isolated platform TLS."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from cooperative_threads_native import NativeCooperativeThreads
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_cooperative_thread_dependencies', entry)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class Control(runtime.Control):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    paths = runtime.producer_paths(n) | {Path(__file__)}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    n.initialize_asset_arena(64)
    tls = {name: at for at, name in n.source.imports.items() if name in
           ['_pthread_key_create', '_pthread_getspecific', '_pthread_setspecific']}
    key_cell = n.allocate(8)
    n.call(tls['_pthread_key_create'], {r.UC_X86_REG_RDI: key_cell, r.UC_X86_REG_RSI: 0})
    key = n.q(key_cell)
    n.call(tls['_pthread_setspecific'], {r.UC_X86_REG_RDI: key, r.UC_X86_REG_RSI: 42})
    controls = []
    for start, argument, expected in [(0x2e1aa0, n.allocate(0x40), 0),
            (tls['_pthread_getspecific'], key, 0), (tls['_pthread_setspecific'], key, 0)]:
        output = n.allocate(8)
        n.call(0x1feebc4, {r.UC_X86_REG_RDI: output, r.UC_X86_REG_RSI: 0,
                           r.UC_X86_REG_RDX: n.base + start, r.UC_X86_REG_RCX: argument})
        handle = n.q(output)
        state = n.cooperative_threads[handle]
        if n.u.reg_read(r.UC_X86_REG_RAX) or state['completed'] or state['runs']:
            raise ValueError('Thread creation substituted executed/completed work')
        parent_context = n.u.context_save()
        parent_registers = [n.u.reg_read(register) for register in [r.UC_X86_REG_RIP, r.UC_X86_REG_RSP, r.UC_X86_REG_RAX]]
        result = n.run_cooperative_thread(handle)
        if not result['completed'] or result['result'] != expected or state['runs'] != 1:
            raise ValueError('Original native thread callback result differs')
        if [n.u.reg_read(register) for register in [r.UC_X86_REG_RIP, r.UC_X86_REG_RSP, r.UC_X86_REG_RAX]] != parent_registers:
            raise ValueError('Cooperative thread changed the parent context')
        n.u.context_restore(parent_context)
        n.call(tls['_pthread_getspecific'], {r.UC_X86_REG_RDI: key})
        if n.u.reg_read(r.UC_X86_REG_RAX) != 42:
            raise ValueError('Worker TLS changed the parent TLS value')
        controls.append(result)
    obj = n.allocate(8)
    n.call(0x1fee480, {r.UC_X86_REG_RDI: obj})
    if not n.q(obj) or n.cooperative_thread_structs[obj]['destroyed']:
        raise ValueError('Owned thread-private constructor differs')
    n.call(0x1fee486, {r.UC_X86_REG_RDI: obj})
    if not n.cooperative_thread_structs[obj]['destroyed']:
        raise ValueError('Owned thread-private destructor differs')
    rejections = 0
    for operation in [lambda: n.run_cooperative_thread(controls[0]['handle']),
                      lambda: n.call(0x1fee576, {r.UC_X86_REG_RDI: obj}),
                      lambda: n.call(0x1feebc4, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: 1,
                                               r.UC_X86_REG_RDX: n.base + 0x2e1aa0, r.UC_X86_REG_RCX: obj})]:
        try:
            operation()
        except ValueError:
            rejections += 1
    if rejections != 3:
        raise ValueError('Cooperative thread boundary guard differs')
    def queued(start, argument, extra=None):
        output = n.allocate(8)
        n.call(0x1feebc4, {r.UC_X86_REG_RDI: output, r.UC_X86_REG_RSI: 0,
                           r.UC_X86_REG_RDX: n.base + start, r.UC_X86_REG_RCX: argument})
        state = n.cooperative_threads[n.q(output)]
        if extra:
            parent = n.u.context_save()
            n.u.context_restore(state['context'])
            for register, value in extra.items():
                n.u.reg_write(register, value)
            state['context'] = n.u.context_save()
            n.u.context_restore(parent)
        return state

    # Pause an actual platform TLS setter before its return continuation, then
    # delete the process-wide key while that worker remains resumable.
    pending = queued(tls['_pthread_setspecific'], key, {r.UC_X86_REG_RSI: 99})
    yielded = n.run_cooperative_thread(pending['handle'], instruction_bound=1)
    if yielded['completed'] or pending['tls'].get(key) != 99:
        raise ValueError('TLS deletion control did not retain a paused worker value')
    delete = next(at for at, name in n.source.imports.items() if name == '_pthread_key_delete')
    n.call(delete, {r.UC_X86_REG_RDI: key})
    if key in n.file_keys or any(key in state['tls'] for state in n.cooperative_threads.values()):
        raise ValueError('Deleted process TLS key retained cooperative thread values')
    completed = n.run_cooperative_thread(pending['handle'])
    if not completed['completed']:
        raise ValueError('Worker could not return after its TLS key was deleted')
    n.call(tls['_pthread_key_create'], {r.UC_X86_REG_RDI: key_cell, r.UC_X86_REG_RSI: 0})
    if n.q(key_cell) != key:
        raise ValueError('Explicit TLS key reuse control differs')
    n.call(tls['_pthread_getspecific'], {r.UC_X86_REG_RDI: key})
    if n.u.reg_read(r.UC_X86_REG_RAX):
        raise ValueError('Reused TLS key retained the deleted parent value')
    deletion_control = {'pausedNonzeroWorkerValue': 99, 'deletedKey': key,
        'allWorkerValuesPurged': True, 'workerReturnedAfterDeletion': True,
        'reusedKeyStartsEmpty': True}

    errno = next(at for at, name in n.source.imports.items() if name == '___error')
    memcpy = next(at for at, name in n.source.imports.items() if name == '_memcpy')
    copy_source = n.allocate(8)
    n.put(copy_source, 'Q', 0x1122334455667788)
    mutex_imports = {name: at for at, name in n.source.imports.items() if name in
                     ['_pthread_mutex_init', '_pthread_mutex_lock', '_pthread_mutex_unlock']}
    parent_mutex = n.allocate(64)
    n.call(mutex_imports['_pthread_mutex_init'], {r.UC_X86_REG_RDI: parent_mutex, r.UC_X86_REG_RSI: 0})
    n.call(mutex_imports['_pthread_mutex_lock'], {r.UC_X86_REG_RDI: parent_mutex})
    failure_controls = []
    registers = [r.UC_X86_REG_RIP, r.UC_X86_REG_RSP, r.UC_X86_REG_RAX, r.UC_X86_REG_RBX,
                 r.UC_X86_REG_RBP, r.UC_X86_REG_RCX, r.UC_X86_REG_RDX, r.UC_X86_REG_RSI,
                 r.UC_X86_REG_RDI, r.UC_X86_REG_XMM0, r.UC_X86_REG_EFLAGS]
    for start, argument, extra, expected in [
            (0x1490eb0, 0, None, 'Mach-O TLV'),
            (errno, 0, None, 'worker errno'),
            (memcpy, 0x1000fff8, {r.UC_X86_REG_RSI: copy_source, r.UC_X86_REG_RDX: 8},
             'suspended parent stack'),
            (mutex_imports['_pthread_mutex_lock'], parent_mutex, None, 'worker lock ownership')]:
        state = queued(start, argument, extra)
        before = [n.u.reg_read(register) for register in registers]
        parent_stack = bytes(n.u.mem_read(0x10000008, 0x10008))
        slots = {pointer: bytes(n.u.mem_read(pointer, 64)) for pointer in n.slots.values()}
        parent_errno = n.file_errno
        try:
            n.run_cooperative_thread(state['handle'])
        except ValueError as error:
            if expected not in str(error):
                raise
        else:
            raise ValueError('Unsupported cooperative worker operation was silently admitted')
        if (not state['failed'] or state['completed'] or state['result'] is not None or
                n.cooperative_active_thread is not None or
                [n.u.reg_read(register) for register in registers] != before or
                bytes(n.u.mem_read(0x10000008, 0x10008)) != parent_stack or n.file_errno != parent_errno or
                any(bytes(n.u.mem_read(pointer, 64)) != data for pointer, data in slots.items())):
            raise ValueError('Rejected cooperative dispatch changed parent context, stack, TLS or errno')
        failure_controls.append({'startRva': start, 'expectedFailure': expected,
            'workerFailed': True, 'parentRegistersRestored': True, 'parentStackRestored': True,
            'workerCompleted': False, 'workerResult': None,
            'parentMachOTlvUnchanged': True, 'parentErrnoUnchanged': True})
    n.call(mutex_imports['_pthread_mutex_unlock'], {r.UC_X86_REG_RDI: parent_mutex})
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Thread platform source changed during execution: ' + path)
    output = fixture.cache / 'research/cooperative-threads-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'controls': controls, 'boundaryRejections': rejections, 'threads': n.cooperative_thread_summary(),
        'tlsKeyDeletionControl': deletion_control, 'failedWorkerControls': failure_controls,
        'sources': sources, 'inputs': fixture.inputs, 'decoderImageSha256': sha(n.image),
        'originalBlocks': list(n.blocks.values()),
        'scope': {'originalCodeExecutedWhenDispatched': True, 'osThreadsCreated': False,
                  'gameJobReadinessSubstituted': False, 'generalThreadSchedulingEstablished': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'boundaryRejections': rejections,
                      'failedWorkerControls': len(failure_controls), 'tlsKeyDeletionControl': deletion_control}))


if __name__ == '__main__':
    main()
