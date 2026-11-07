"""Original semaphore wrappers over owned platform counters, never fake waits."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from mach_semaphores_native import NativeMachSemaphores, CREATE, DESTROY, SIGNAL, TIMEDWAIT, WAIT
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_mach_semaphore_dependencies', entry)
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
    before = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    platform = n.initialize_mach_semaphore_platform()
    cell = n.allocate(16)
    n.u.mem_write(cell, bytes([0xa5]) * 16)
    controls, rejections = [], []
    n.call(0x142b6e0, {r.UC_X86_REG_RDI: cell, r.UC_X86_REG_RSI: 2})
    port = n.u32(cell)
    if n.u.reg_read(r.UC_X86_REG_RAX) or n.mach_semaphores[port]['count'] != 2 or bytes(n.u.mem_read(cell + 4, 12)) != bytes([0xa5]) * 12:
        raise ValueError('Original semaphore creation wrapper output/count differs')
    controls.append({'operation': 'original-create', 'count': 2, 'adjacentBytesPreserved': True})
    n.call(0x142b720, {r.UC_X86_REG_RDI: cell})
    if n.u.reg_read(r.UC_X86_REG_RAX) or n.mach_semaphores[port]['count'] != 1:
        raise ValueError('Original positive-count semaphore wait differs')
    controls.append({'operation': 'original-wait', 'count': 1})
    n.call(TIMEDWAIT, {r.UC_X86_REG_RDI: port, r.UC_X86_REG_RSI: 0})
    if n.u.reg_read(r.UC_X86_REG_RAX) or n.mach_semaphores[port]['count']:
        raise ValueError('Zero-timeout wait failed to acquire available count')
    controls.append({'operation': 'timedwait-acquire', 'count': 0})
    n.call(TIMEDWAIT, {r.UC_X86_REG_RDI: port, r.UC_X86_REG_RSI: 0})
    if n.u.reg_read(r.UC_X86_REG_RAX) != 49 or n.mach_semaphores[port]['count']:
        raise ValueError('Actual nonblocking Mach timeout result differs')
    controls.append({'operation': 'timedwait-zero-timeout', 'result': 49, 'count': 0})
    for at, second in [(WAIT, 0), (TIMEDWAIT, 1), (TIMEDWAIT, 1000000000 << 32)]:
        try:
            n.call(at, {r.UC_X86_REG_RDI: port, r.UC_X86_REG_RSI: second})
        except ValueError as error:
            rejections.append(str(error))
        else:
            raise ValueError('Blocking wait or malformed timeout was silently admitted')
        if n.mach_semaphores[port]['count']:
            raise ValueError('Rejected semaphore wait changed available count')
    n.call(SIGNAL, {r.UC_X86_REG_RDI: port})
    if n.mach_semaphores[port]['count'] != 1:
        raise ValueError('Mach semaphore signal counter differs')
    controls.append({'operation': 'signal', 'count': 1})
    n.call(0x142b700, {r.UC_X86_REG_RDI: cell})
    if n.u.reg_read(r.UC_X86_REG_RAX) or not n.mach_semaphores[port]['destroyed']:
        raise ValueError('Original semaphore destroy wrapper differs')
    controls.append({'operation': 'original-destroy', 'destroyed': True})
    for at, first, second in [(SIGNAL, port, 0), (DESTROY, n.mach_task_port, port),
                               (CREATE, n.mach_task_port + 1, cell)]:
        try:
            n.call(at, {r.UC_X86_REG_RDI: first, r.UC_X86_REG_RSI: second,
                        r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: 0})
        except ValueError as error:
            rejections.append(str(error))
        else:
            raise ValueError('Unowned task or destroyed semaphore was admitted')
    after = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    if before != after:
        raise ValueError('Mach semaphore producer changed during controls')
    output = fixture.cache / 'research/mach-semaphores-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'platform': platform, 'controls': controls, 'rejections': rejections,
        'semaphores': n.mach_semaphore_summary(), 'platformCalls': n.mach_semaphore_calls,
        'sources': after, 'inputs': fixture.inputs, 'originalBlocks': list(n.blocks.values()),
        'platformAbiReferences': [
            'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/kern/sync_sema.c',
            'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/mach/clock_types.h',
            'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/mach/kern_return.h'],
        'scope': {'originalCreateWaitDestroyWrappersExecuted': True, 'platformAbiModeled': True,
            'actualKernelSemaphoresCreated': False, 'blockingWaitsFaked': False,
            'nonzeroTimeoutClockModeled': False, 'gameWorkerOrJobReadinessClaimed': False,
            'sourceFingerprintsVerifiedBeforeAndAfter': True}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'rejections': len(rejections)}))


if __name__ == '__main__':
    main()
