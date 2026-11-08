"""Owned platform threads with explicit cooperative native-code execution.

Creation queues a runnable context; it never reports a game job ready. Contexts
have independent guarded stacks and TLS values. Unsupported blocking/exit work
fails normally. No OS thread is created and no game callback is substituted.
"""
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


class NativeCooperativeThreads:
    def __init__(self, *args, **kwargs):
        self.cooperative_threads = {}
        self.cooperative_thread_structs = {}
        self.cooperative_thread_calls = []
        self.cooperative_active_thread = None
        self.cooperative_return = None
        super().__init__(*args, **kwargs)
        expected = {0x1fee480: '__ZNSt3__115__thread_structC1Ev',
                    0x1fee486: '__ZNSt3__115__thread_structD1Ev',
                    0x1fee576: '__ZNSt3__16threadD1Ev', 0x1feebc4: '_pthread_create'}
        if any(self.source.imports.get(at) != name for at, name in expected.items()):
            raise ValueError('Original cooperative thread platform imports differ')

    def imported(self, engine, address, size, user):
        at = address - self.base
        name = self.source.imports.get(at)
        if self.cooperative_active_thread is not None and name == '___error':
            raise ValueError('Cooperative worker errno requires an isolated platform provider')
        if self.cooperative_active_thread is not None and name in [
                '_pthread_mutex_lock', '_pthread_mutex_unlock', '_pthread_mutex_destroy',
                '_pthread_rwlock_rdlock', '_pthread_rwlock_wrlock',
                '_pthread_rwlock_unlock', '_pthread_rwlock_destroy']:
            raise ValueError('Cooperative worker lock ownership requires an original scheduling model')
        if name == '_pthread_key_delete':
            key = engine.reg_read(r.UC_X86_REG_RDI)
            result = super().imported(engine, address, size, user)
            # POSIX deletion affects the process-wide key and does not invoke
            # destructors. A later reused key starts empty in every thread.
            for state in self.cooperative_threads.values():
                state['tls'].pop(key, None)
            return result
        if at == 0x1fee480:
            target = engine.reg_read(r.UC_X86_REG_RDI)
            if self.allocations.get(target) != 8 or target in self.cooperative_thread_structs:
                raise ValueError('Owned cold libc++ thread-private object required')
            # The private implementation belongs entirely to this platform
            # provider; game code only owns its one opaque pointer.
            private = self.allocate(8)
            self.put(private, 'Q', 0)
            self.put(target, 'Q', private)
            self.cooperative_thread_structs[target] = {'private': private, 'destroyed': False}
        elif at == 0x1fee486:
            target = engine.reg_read(r.UC_X86_REG_RDI)
            state = self.cooperative_thread_structs.get(target)
            if state is None or state['destroyed'] or self.q(target) != state['private']:
                raise ValueError('Owned live libc++ thread-private object required')
            state['destroyed'] = True
        elif at == 0x1fee576:
            target = engine.reg_read(r.UC_X86_REG_RDI)
            if not self.writable_file_memory(target, 8) or self.q(target):
                raise ValueError('Joinable std::thread destruction requires original termination handling')
        elif at == 0x1feebc4:
            output, attributes, start, argument = [engine.reg_read(register) for register in
                [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX]]
            if (attributes or not self.writable_file_memory(output, 8) or
                    not self.base <= start < self.base + 0x1fef000 or len(self.cooperative_threads) >= 8):
                raise ValueError('Bounded owned default-attribute native thread creation required')
            if self.cooperative_return is None:
                self.cooperative_return = self.allocate_native_callback('cooperative-thread-return', self._thread_returned)
            handle, storage = self.allocate(8), self.allocate(0x10200)
            low, high = storage + 0x100, storage + 0x10100
            engine.mem_write(storage, bytes([0xa5]) * 0x100)
            engine.mem_write(high, bytes([0xa5]) * 0x100)
            self.put(high - 8, 'Q', self.cooperative_return)
            parent = engine.context_save()
            engine.context_restore(self.initial)
            for register, value in [(r.UC_X86_REG_RIP, start), (r.UC_X86_REG_RDI, argument),
                                    (r.UC_X86_REG_RSP, high - 8)]:
                engine.reg_write(register, value)
            context = engine.context_save()
            engine.context_restore(parent)
            self.cooperative_threads[handle] = {'handle': handle, 'startRva': start - self.base,
                'argument': argument, 'storage': storage, 'stackLow': low, 'stackHigh': high,
                'context': context, 'tls': {}, 'runs': 0, 'completed': False, 'result': None, 'failed': False}
            self.put(output, 'Q', handle)
            self.cooperative_thread_calls.append({'handle': handle, 'startRva': start - self.base,
                'argument': argument, 'runnableContextCreated': True, 'nativeCodeExecutedAtCreation': False})
        else:
            if self.cooperative_active_thread is not None and name in ['_pthread_getspecific', '_pthread_setspecific']:
                key = engine.reg_read(r.UC_X86_REG_RDI)
                if key not in self.file_keys:
                    raise ValueError('Cooperative thread TLS key is not owned')
                state = self.cooperative_threads[self.cooperative_active_thread]
                if name == '_pthread_setspecific':
                    state['tls'][key] = engine.reg_read(r.UC_X86_REG_RSI)
                    result = 0
                else:
                    result = state['tls'].get(key, 0)
                engine.reg_write(r.UC_X86_REG_RAX, result)
                self.ret()
                return
            return super().imported(engine, address, size, user)
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()

    def tls(self, engine, address, size, user):
        if self.cooperative_active_thread is not None:
            raise ValueError('Cooperative worker Mach-O TLV requires isolated original descriptor initialization')
        return super().tls(engine, address, size, user)

    def _thread_returned(self, engine, address, size, user):
        state = self.cooperative_threads.get(self.cooperative_active_thread)
        if state is None or state['completed'] or engine.reg_read(r.UC_X86_REG_RSP) != state['stackHigh']:
            raise ValueError('Cooperative thread returned outside its owned context')
        if any(value and self.file_keys[key]['destructor'] for key, value in state['tls'].items()):
            raise ValueError('Cooperative thread exit requires unresolved original TLS destructors')
        state['result'] = engine.reg_read(r.UC_X86_REG_RAX)
        state['completed'] = True
        engine.emu_stop()

    def run_cooperative_thread(self, handle, instruction_bound=100000):
        if (self.cooperative_active_thread is not None or handle not in self.cooperative_threads or
                type(instruction_bound) is not int or not 0 < instruction_bound <= 5000000):
            raise ValueError('Explicit bounded non-reentrant cooperative thread dispatch required')
        state = self.cooperative_threads[handle]
        if state['completed'] or state['failed']:
            raise ValueError('Completed or failed cooperative thread cannot execute again')
        parent = self.u.context_save()
        parent_errno = self.file_errno
        parent_errno_bytes = bytes(self.u.mem_read(parent_errno, 4)) if parent_errno is not None else None
        main_begin, main_end = ADDRESSES['stack'] - 0x10000, ADDRESSES['stack'] + 8
        main_stack = bytes(self.u.mem_read(main_begin, main_end - main_begin))
        def reject_parent(engine, access, address, size, value, user):
            raise ValueError('Cooperative thread accessed the suspended parent stack')
        def check_stack(engine, address, size, user):
            if not state['stackLow'] <= engine.reg_read(r.UC_X86_REG_RSP) <= state['stackHigh']:
                raise ValueError('Cooperative thread escaped its owned stack')
        hooks = [self.u.hook_add(mode, reject_parent, begin=main_begin, end=main_end-1)
                 for mode in [unicorn.UC_HOOK_MEM_READ, unicorn.UC_HOOK_MEM_WRITE]]
        hooks.append(self.u.hook_add(unicorn.UC_HOOK_BLOCK, check_stack))
        self.cooperative_active_thread = handle
        try:
            self.u.context_restore(state['context'])
            state['runs'] += 1
            self.u.emu_start(self.u.reg_read(r.UC_X86_REG_RIP), 0, count=instruction_bound)
            state['context'] = self.u.context_save()
            if bytes(self.u.mem_read(state['storage'], 0x100)) != bytes([0xa5]) * 0x100 or bytes(self.u.mem_read(state['stackHigh'], 0x100)) != bytes([0xa5]) * 0x100:
                raise ValueError('Cooperative thread changed its stack guards')
        except Exception:
            state['failed'] = True
            state['completed'] = False
            state['result'] = None
            raise
        finally:
            for hook in hooks:
                self.u.hook_del(hook)
            self.cooperative_active_thread = None
            self.u.context_restore(parent)
            violations = []
            if bytes(self.u.mem_read(main_begin, main_end - main_begin)) != main_stack:
                # Host ABI writes do not trigger guest memory hooks. Keep the
                # diagnostic failure from corrupting the suspended caller.
                self.u.mem_write(main_begin, main_stack)
                violations.append('suspended parent stack')
            if (self.file_errno != parent_errno or parent_errno is not None and
                    bytes(self.u.mem_read(parent_errno, 4)) != parent_errno_bytes):
                if parent_errno is not None:
                    self.u.mem_write(parent_errno, parent_errno_bytes)
                self.file_errno = parent_errno
                violations.append('suspended parent errno')
            if violations:
                state['failed'] = True
                state['completed'] = False
                state['result'] = None
                raise ValueError('Cooperative dispatch changed the ' + ' and '.join(violations))
        return {'handle': handle, 'runs': state['runs'], 'completed': state['completed'],
                'result': state['result'], 'parentContextRestored': True}

    def cooperative_thread_summary(self):
        return [{key: value for key, value in state.items() if key not in ['context', 'tls']}
                for state in self.cooperative_threads.values()]
