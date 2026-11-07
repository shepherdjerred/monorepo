"""DEV-only out-of-order prerequisite experiments at original instruction boundaries.

Never attach this to an arbitrary Unicorn/host exception. A code hook stops
BEFORE an explicitly pinned scalar instruction executes. Only the CPU and the
declared owned stack are restored; initializer heap/global side effects persist.
Successful continuation is debug evidence, requiring a separate cold run before
any resource or replay acceptance claim. This module is not wired into main.
"""
import inspect
import json
from pathlib import Path
import capstone
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import sha


class NativePrerequisiteContinuation:
    def __init__(self, native, *, boundary, stack_start, stack_size, initializer,
                 source_pins, proof_path, proof_sha256, required_zero_globals):
        self.n, self.initializer = native, initializer
        self.source_pins = dict(source_pins)
        self.proof_path, self.proof_sha256 = Path(proof_path), proof_sha256
        self.boundary = dict(boundary)
        self.state, self.hook, self.record = 'new', None, None
        self.stack_start, self.stack_size = stack_start, stack_size
        self.zero_globals = tuple(required_zero_globals)
        if (native.profile['clientVersion'] != '16.21.829.8620' or
                native.profile['protocolDigest'] != '20e09df23c66b85e' or
                not callable(initializer) or type(stack_start) is not int or
                type(stack_size) is not int or not 0 < stack_size <= 0x20000 or
                not 0x10001000 <= stack_start < stack_start + stack_size <= 0x10020000 or
                not self.zero_globals or any(type(at) is not int or
                    not 0x1fef000 <= at <= len(native.image)-8 for at in self.zero_globals)):
            raise ValueError('Explicit bounded DEV continuation inputs required')
        needed = {str(Path(__file__).resolve()), str(Path(inspect.getfile(initializer)).resolve())}
        if not needed <= self.source_pins.keys():
            raise ValueError('Initializer and continuation source pins required')
        self._verify_pins()
        self._verify_boundary()
        if any(native.q(native.base+at) for at in self.zero_globals):
            raise ValueError('Declared missing prerequisite is not cold')
        native.u.mem_read(stack_start, stack_size)
        self.state = 'armed'
        self.hook = native.u.hook_add(unicorn.UC_HOOK_CODE, self._pause,
            begin=native.base+boundary['rva'], end=native.base+boundary['rva'])

    def _verify_pins(self):
        for path, digest in self.source_pins.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('DEV continuation source changed: ' + path)
        data = self.proof_path.read_bytes()
        if sha(data) != self.proof_sha256:
            raise ValueError('Independent initializer proof changed')
        proof = json.loads(data)
        if (proof.get('build') != self.n.profile['clientVersion'] or
                proof.get('decoderImageSha256') != self.n.profile['decoderImageSha256']):
            raise ValueError('Exact-build independent initializer proof required')
        for group in ['inputs', 'sources']:
            pins = proof.get(group)
            if not isinstance(pins, dict) or not pins:
                raise ValueError('Independent initializer provenance required')
            for filename, digest in pins.items():
                path = Path(filename)
                if not path.is_absolute():
                    path = Path(inspect.getfile(self.initializer)).resolve().parent / path
                if sha(path.read_bytes()) != digest:
                    raise ValueError('Independent initializer input/source changed: ' + str(path))

    def _verify_boundary(self):
        at, size = self.boundary.get('rva'), self.boundary.get('size')
        if type(at) is not int or type(size) is not int or not 1 <= size <= 15 or not 0 <= at <= 0x1fef000-size:
            raise ValueError('Pinned original scalar instruction required')
        original = bytes(self.n.source.image[at:at+size])
        decoded = list(capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64).disasm(original, at))
        if (len(decoded) != 1 or decoded[0].size != size or
                decoded[0].mnemonic not in ['mov', 'movzx', 'movsxd', 'cmp', 'test'] or
                sha(original) != self.boundary.get('sha256') or
                bytes(self.n.u.mem_read(self.n.base+at, size)) != original):
            raise ValueError('Pinned pristine scalar boundary differs')

    def _pause(self, engine, address, size, user):
        if self.state != 'armed' or size != self.boundary['size']:
            raise ValueError('DEV continuation boundary state differs')
        self.state = 'paused-before-instruction'
        engine.emu_stop()

    def initialize(self):
        if self.state != 'paused-before-instruction' or self.n.u.reg_read(r.UC_X86_REG_RIP) != self.n.base+self.boundary['rva']:
            raise ValueError('Deliberate pre-instruction pause required; fault recovery is forbidden')
        self._verify_pins()
        self._verify_boundary()
        if any(self.n.q(self.n.base+at) for at in self.zero_globals):
            raise ValueError('Declared missing prerequisite changed before pause')
        sp = self.n.u.reg_read(r.UC_X86_REG_RSP)
        if not self.stack_start+128 <= sp <= self.stack_start+self.stack_size-8:
            raise ValueError('Paused CPU stack/red-zone escapes declared owned stack')
        cpu = self.n.u.context_save()
        cpu_bytes = bytes(cpu)
        register_ids = [getattr(r, 'UC_X86_REG_'+name) for name in
            ['RAX','RBX','RCX','RDX','RSI','RDI','RBP','RSP','RIP','R8','R9','R10','R11','R12','R13','R14','R15',
             'EFLAGS','CS','DS','ES','FS','GS','SS','FS_BASE','GS_BASE','MXCSR','FPCW','FPSW','FPTAG',
             *['XMM'+str(i) for i in range(16)], *['YMM'+str(i) for i in range(16)],
             *['FP'+str(i) for i in range(8)]]]
        before_registers = [cpu.reg_read(register) for register in register_ids]
        stack = bytes(self.n.u.mem_read(self.stack_start, self.stack_size))
        heap_before = self.n.next_heap
        self.close()
        self.state = 'initializing-out-of-order'
        try:
            result = self.initializer(self.n)
            self._verify_pins()
            self._verify_boundary()
            if any(not self.n.q(self.n.base+at) for at in self.zero_globals):
                raise ValueError('Original initializer did not publish every declared prerequisite')
        except BaseException:
            self.state = 'tainted-initializer-failure'
            raise
        finally:
            # No heap/global rollback is performed, even on failure.
            self.n.u.mem_write(self.stack_start, stack)
            self.n.u.context_restore(cpu)
            restored = self.n.u.context_save()
            # UcContext byte blobs include nonarchitectural engine bookkeeping;
            # retain their hashes but verify architectural registers separately.
            if ([restored.reg_read(register) for register in register_ids] != before_registers or
                    bytes(self.n.u.mem_read(self.stack_start, self.stack_size)) != stack):
                self.state = 'tainted-restoration-failure'
                raise ValueError('DEV continuation CPU/owned-stack restoration differs')
        self.state = 'ready-to-resume'
        self.record = {'boundary': self.boundary, 'initializer': result,
            'cpuBytesSha256': sha(cpu_bytes), 'stackBytesSha256': sha(stack),
            'architecturalRegistersVerified':len(register_ids),
            'opaqueContextByteEqualAfterRestore':bytes(restored)==cpu_bytes,
            'stackAddress': self.stack_start, 'stackBytes': self.stack_size,
            'heapBefore': heap_before, 'heapAfter': self.n.next_heap,
            'outOfOrderDebugEvidence': True, 'requiresFinalColdRun': True,
            'heapOrProcessSnapshotRestored': False, 'callbackOrInstructionReplaced': False,
            'resourceOrReplayAcceptanceEstablished': False}
        return self.record

    def resume(self, until, instructions=5000000):
        if (self.state != 'ready-to-resume' or type(instructions) is not int or
                not 1 <= instructions <= 5000000 or type(until) is not int or
                self.n.u.reg_read(r.UC_X86_REG_RIP) != self.n.base+self.boundary['rva']):
            raise ValueError('One owned bounded DEV continuation required')
        self._verify_pins()
        self._verify_boundary()
        self.state = 'resumed-debug-only'
        try:
            self.n.u.emu_start(self.n.base+self.boundary['rva'], until, count=instructions)
        except BaseException:
            self.state = 'tainted-resume-failure'
            raise
        self.record.update(stop=self.n.u.reg_read(r.UC_X86_REG_RIP), expectedStop=until)
        return self.record

    def close(self):
        if self.hook is not None:
            self.n.u.hook_del(self.hook)
            self.hook = None
