"""Execute the original SDK attributed-thread wrapper and guarded CPU callback."""
import argparse
import ctypes
import importlib.util
import json
import sys
import time
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import sha
from original_sdk_memory_statics_native import initialize_original_sdk_memory_statics


driver = Path(__file__).with_name('probe-original-vfx-manager-startup.py')
spec = importlib.util.spec_from_file_location('sdk_thread_original_control', driver)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['assets', 'client', 'source', 'types', 'public', 'implementation', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--sdk-clock-source', type=Path)
    parser.add_argument('--sdk-clock-types-source', type=Path)
    args = parser.parse_args()
    if bool(args.sdk_clock_source) != bool(args.sdk_clock_types_source):
        parser.error('SDK clock reference sources must be selected together')
    if any(args.output.resolve().is_relative_to(root.resolve()) for root in [args.assets, args.client.parent]):
        raise ValueError('SDK control output must remain outside approved source roots')
    tools = Path(__file__).resolve().parent
    sources = {}
    for module in list(sys.modules.values()):
        file = getattr(module, '__file__', None)
        if file and Path(file).resolve().is_relative_to(tools) and Path(file).suffix == '.py':
            source = Path(file).resolve()
            sources[str(source)] = sha(source.read_bytes())
    inputs = {str(path.resolve()): sha(path.read_bytes()) for path in [args.client,
        args.assets/'image.bin', args.assets/'profile.json', args.source, args.types, args.public, args.implementation]}
    for path in [args.sdk_clock_source, args.sdk_clock_types_source]:
        if path:
            inputs[str(path.resolve())] = sha(path.read_bytes())
    n = runtime.Control(args.assets, args.client)
    def source_call(entry, registers, end):
        # The full-wrapper control may already have translated a block that
        # starts at this return address. Stop at the exact observed instruction
        # rather than letting Unicorn's cached block execute its continuation.
        def stop(engine, address, size, user):
            engine.emu_stop()
        hook = n.u.hook_add(unicorn.UC_HOOK_CODE, stop, begin=n.base+end, end=n.base+end)
        try:
            n.call(entry, registers, end=end)
        finally:
            n.u.hook_del(hook)
    n.configure_scheduler_queries(args.source.read_bytes(), default_user_priority=31)
    threads = n.configure_sdk_threads(args.source.read_bytes(), args.types.read_bytes(),
        args.public.read_bytes(), args.implementation.read_bytes())
    clocks = (n.configure_sdk_host_clock(args.sdk_clock_source.read_bytes(), args.sdk_clock_types_source.read_bytes())
              if args.sdk_clock_source else None)
    module = initialize_original_sdk_memory_statics(n, {})
    try:
        initialize_original_sdk_memory_statics(n, {})
    except ValueError as error:
        if 'Cold registered original SDK memory-module initializer required' not in str(error):
            raise
    else:
        raise ValueError('Original SDK module ownership was initialized twice')
    description, argument, output = n.allocate(0x48), n.allocate(0x40), n.allocate(8)
    n.call(0x1caf470, {r.UC_X86_REG_RDI: description})
    n.call(0x1c1dbb0, {r.UC_X86_REG_RDI: n.base+0x2e1aa0, r.UC_X86_REG_RSI: argument,
        r.UC_X86_REG_RDX: description+0x20, r.UC_X86_REG_RCX: output})
    handle = n.q(output)
    state = n.cooperative_threads[handle]
    actual = state['platformAttributes']
    if ({key: actual[key] for key in ['stackBytes', 'detached', 'inherit', 'policy', 'priority', 'quantum']} !=
            {'stackBytes': 0x20000, 'detached': 1, 'inherit': 2, 'policy': 4, 'priority': 47, 'quantum': 10} or
            state['stackHigh']-state['stackLow'] != 0x20000 or state['runs'] or state['completed'] or
            any(attr['live'] for attr in threads['attributes'].values())):
        raise ValueError('Original SDK wrapper changed its admitted attributes or fabricated execution')
    parent = [n.u.reg_read(at) for at in [r.UC_X86_REG_RIP, r.UC_X86_REG_RSP, r.UC_X86_REG_RAX]]
    dispatched = n.run_cooperative_thread(handle)
    if not dispatched['completed'] or dispatched['result'] or parent != [n.u.reg_read(at)
            for at in [r.UC_X86_REG_RIP, r.UC_X86_REG_RSP, r.UC_X86_REG_RAX]]:
        raise ValueError('SDK-owned original callback did not preserve its parent context')
    descriptions = n.allocate(0x70)
    n.u.mem_write(descriptions, b'\xa5'*0x70)
    n.call(0x1c034b0, {r.UC_X86_REG_RDI: descriptions})
    if ([n.u32(descriptions+offset) for offset in [0, 0x18, 0x30, 0x48]] != [47, 47, 31, 47] or
            any(n.q(descriptions+offset+8) != 0x20000 or n.u32(descriptions+offset+16) != 4
                for offset in [0, 0x18, 0x30, 0x48]) or
            bytes(n.u.mem_read(descriptions+0x60, 16)) != b'\xa5'*16):
        raise ValueError('Original SDK multi-thread description constructor differs')
    attr = n.allocate(80)
    n.u.mem_write(attr, b'\xa5'*80)
    source_call(0x1c1dbe3, {r.UC_X86_REG_RDI: attr}, 0x1c1dbe8)
    if bytes(n.u.mem_read(attr+64, 16)) != b'\xa5'*16:
        raise ValueError('SDK attribute initialization changed its storage guard')
    source_call(0x1c1dbf0, {r.UC_X86_REG_RDI: attr, r.UC_X86_REG_RSI: 123}, 0x1c1dbf5)
    if n.u.reg_read(r.UC_X86_REG_RAX) != 22 or n._sdk_attribute(attr)['stackBytes']:
        raise ValueError('Invalid SDK stack size did not retain source EINVAL/no-mutation semantics')
    rejection = []
    for label, entry in [('unowned-caller', 0x1feeb70), ('changed-attribute', 0x1c1dbf0)]:
        if label == 'changed-attribute':
            n.put(attr+56, 'Q', 1)
        try:
            if label == 'changed-attribute':
                source_call(entry, {r.UC_X86_REG_RDI: attr, r.UC_X86_REG_RSI: 0x20000}, 0x1c1dbf5)
            else:
                n.call(entry, {r.UC_X86_REG_RDI: attr, r.UC_X86_REG_RSI: 0x20000})
        except ValueError as error:
            expected = 'Unowned original SDK pthread caller' if label == 'unowned-caller' else 'Owned live unchanged SDK pthread attribute'
            if expected not in str(error):
                raise
            rejection.append(label)
        else:
            raise ValueError('Invalid SDK thread boundary was silently accepted: '+label)
    storage = n.base+0x2554ee0
    neighbors = [bytes(n.u.mem_read(storage-16, 16)), bytes(n.u.mem_read(storage+0x120, 16))]
    # Deliberate component input in this VM's original SDK-owned static region;
    # no approved source bytes or game readiness fields are edited.
    n.u.mem_write(storage, b'\xa5'*0x120)
    source_call(0x1bc3328, {}, 0x1bc332d)
    if (bytes(n.u.mem_read(storage, 0x120)) != bytes(0x120) or
            neighbors != [bytes(n.u.mem_read(storage-16, 16)), bytes(n.u.mem_read(storage+0x120, 16))]):
        raise ValueError('Original SDK bzero changed its source-owned extent or adjacent bytes')
    try:
        n.call(0x1be8520, {})
    except ValueError as error:
        if 'Exact original SDK static bzero caller/extent required' not in str(error):
            raise
    else:
        raise ValueError('SDK static bzero accepted an unowned caller')
    copy_target, copy_source = n.base+0x25704f0, n.allocate(0xb0)
    data = bytes(range(0xb0))
    n.u.mem_write(copy_source, data)
    neighbors = [bytes(n.u.mem_read(copy_target-16, 16)), bytes(n.u.mem_read(copy_target+0xb0, 16))]
    source_call(0x1bc338a, {r.UC_X86_REG_RDI: copy_target, r.UC_X86_REG_RSI: copy_source,
        r.UC_X86_REG_RDX: 0xb0}, 0x1bc338f)
    if (bytes(n.u.mem_read(copy_target, 0xb0)) != data or
            neighbors != [bytes(n.u.mem_read(copy_target-16, 16)), bytes(n.u.mem_read(copy_target+0xb0, 16))]):
        raise ValueError('Original SDK configuration copy changed bytes or adjacent storage')
    before = bytes(n.u.mem_read(copy_target, 0xb0))
    try:
        source_call(0x1bc338a, {r.UC_X86_REG_RDI: copy_target, r.UC_X86_REG_RSI: copy_source,
            r.UC_X86_REG_RDX: 0xb1}, 0x1bc338f)
    except ValueError as error:
        if 'Exact original SDK configuration memcpy caller/extent required' not in str(error):
            raise
    else:
        raise ValueError('SDK static copy accepted an unknown extent')
    if bytes(n.u.mem_read(copy_target, 0xb0)) != before:
        raise ValueError('Rejected SDK configuration copy changed its destination')
    source_call(0x1c65450, {r.UC_X86_REG_RDI: n.base+0x2488340}, 0x1c65452)
    main_cell = n.u.reg_read(r.UC_X86_REG_RAX)
    if n.q(main_cell):
        raise ValueError('Original main SDK TLS template is not cold')
    # This scalar is an isolated platform-TLS persistence control, not an SDK
    # object, worker readiness flag, or caller-supplied game resource pointer.
    n.put(main_cell, 'Q', 0x1234)
    source_call(0x1c65464, {r.UC_X86_REG_RDI: n.base+0x2488328}, 0x1c65466)
    if main_cell-n.u.reg_read(r.UC_X86_REG_RAX) != 64:
        raise ValueError('Original SDK descriptors did not share their source template offsets')
    n.call(0x1c1dbb0, {r.UC_X86_REG_RDI: n.base+0x2e1aa0, r.UC_X86_REG_RSI: argument,
        r.UC_X86_REG_RDX: description+0x20, r.UC_X86_REG_RCX: output})
    other = n.q(output)
    # Explicit logical-context selection tests the platform port without
    # claiming that the real sound SDK worker or its scheduler has executed.
    n.cooperative_active_thread = other
    try:
        source_call(0x1c65450, {r.UC_X86_REG_RDI: n.base+0x2488340}, 0x1c65452)
        other_cell = n.u.reg_read(r.UC_X86_REG_RAX)
        if other_cell == main_cell or n.q(other_cell):
            raise ValueError('SDK TLS reused the parent cell or inherited its mutation')
        source_call(0x1c0066d, {}, 0x1c00672)
        if n.u.reg_read(r.UC_X86_REG_RAX) != other:
            raise ValueError('SDK pthread_self did not preserve its created context identity')
    finally:
        n.cooperative_active_thread = None
    source_call(0x1c65450, {r.UC_X86_REG_RDI: n.base+0x2488340}, 0x1c65452)
    if n.u.reg_read(r.UC_X86_REG_RAX) != main_cell or n.q(main_cell) != 0x1234:
        raise ValueError('SDK TLS context selection changed the parent value')
    source_call(0x1c0066d, {}, 0x1c00672)
    if n.u.reg_read(r.UC_X86_REG_RAX) != threads['mainThread'] or threads['mainThread'] == other:
        raise ValueError('SDK main pthread_self identity changed across context selection')
    try:
        n.call(n.sdk_thread_local['callback']-n.base, {r.UC_X86_REG_RDI: n.base+0x2488340})
    except ValueError as error:
        if 'Owned original SDK TLS descriptor/caller/context required' not in str(error):
            raise
    else:
        raise ValueError('SDK TLS accepted an unowned caller')
    before_time = int(time.time())
    source_call(0x1bc372d, {r.UC_X86_REG_RDI: 0}, 0x1bc3732)
    clock_value = n.u.reg_read(r.UC_X86_REG_RAX)
    if not before_time <= clock_value <= int(time.time()):
        raise ValueError('Original SDK time boundary differs from the actual host wall clock')
    if clocks is not None:
        output_clock = n.allocate(32)
        n.u.mem_write(output_clock, b'\xa5'*32)
        tick_count = ctypes.WinDLL('kernel32').GetTickCount64
        tick_count.argtypes, tick_count.restype = [], ctypes.c_uint64
        before_tick = tick_count()
        source_call(0x1bc7a43, {r.UC_X86_REG_RDI: 6, r.UC_X86_REG_RSI: output_clock}, 0x1bc7a48)
        after_tick = tick_count()
        elapsed = n.q(output_clock)*1_000_000_000+n.q(output_clock+8)
        if (not before_tick*1_000_000 <= elapsed <= (after_tick+32)*1_000_000 or
                n.q(output_clock+8) >= 1_000_000_000 or
                bytes(n.u.mem_read(output_clock+16, 16)) != b'\xa5'*16):
            raise ValueError('SDK timespec differs from independent host boot-clock bounds/extent')
        before = bytes(n.u.mem_read(output_clock, 32))
        try:
            source_call(0x1bc7a43, {r.UC_X86_REG_RDI: 7, r.UC_X86_REG_RSI: output_clock}, 0x1bc7a48)
        except ValueError as error:
            if 'Exact original SDK CLOCK_MONOTONIC caller/storage required' not in str(error):
                raise
        else:
            raise ValueError('Unknown Darwin SDK clock ID was silently accepted')
        if bytes(n.u.mem_read(output_clock, 32)) != before:
            raise ValueError('Rejected SDK clock query changed its output')
        clocks['independentHostBootClockAndUnknownIdControls'] = True
    for path, digest in {**sources, **inputs}.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('SDK thread control source changed: '+path)
    args.output.write_text(json.dumps({'schema': 1, 'kind': 'original-sdk-thread-component-controls',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'sources': sources, 'inputs': inputs, 'threads': threads, 'dispatch': dispatched,
        'cooperativeThreads': n.cooperative_thread_summary(), 'rejectedBoundaries': rejection,
        'originalMemoryModule': module, 'duplicateMemoryModuleRejected': True,
        'originalMultiThreadDescriptionsHex': bytes(n.u.mem_read(descriptions, 0x60)).hex(),
        'sdkStaticZeroExactExtentAndUnownedCallerControls': True,
        'sdkStaticCopyExactBytesAndRejectedExtentControls': True,
        'sdkTlsTemplateAliasPersistenceAndContextIsolationControls': True,
        'sdkThreadSelfStableIdentityControls': True,
        'sdkHostTimeMatchesIndependentWallClock': True,
        'sdkHostClock': clocks,
        'invalidStackSizeReturnsEINVAL': True, 'originalBlocks': list(n.blocks.values()),
        'scope': {'nativeWrapperExecuted': True, 'nativeCallbackExecuted': True,
            'osThreadOrRealtimeSchedulingAdmitted': False, 'sdkAudioWorkerReadinessAdmitted': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'nativeWrapperExecuted': True,
        'stackBytes': actual['stackBytes'], 'priority': actual['priority'], 'callbackCompleted': dispatched['completed']}))


if __name__ == '__main__':
    main()
