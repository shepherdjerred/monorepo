"""Explicit read-only filesystem policy for offline client startup controls.

This rejects directory writes with Darwin EROFS. It does not invent successful
creation, read personal game settings, or change the host installation.
"""
from unicorn import x86_const as r


class NativeReadOnlyClientDirectories:
    def __init__(self, *args, **kwargs):
        self.read_only_directory_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(0x1feea5c) != '_mkdir' or self.file_errors[30] != 'Read-only file system':
            raise ValueError('Original Darwin mkdir/EROFS platform contract differs')
        if self.source.imports.get(0x1fee6cc) != '_access':
            raise ValueError('Original Darwin access platform contract differs')

    def imported(self, engine, address, size, user):
        at = address - self.base
        if at not in [0x1feea5c, 0x1fee6cc]:
            return super().imported(engine, address, size, user)
        pointer, mode = engine.reg_read(r.UC_X86_REG_RDI), engine.reg_read(r.UC_X86_REG_RSI)
        path = self.cstring(pointer)
        if not path or len(path) > 4096 or b'\0' in path or (mode != 2 if at == 0x1fee6cc else mode & ~0o777):
            raise ValueError('Bounded POSIX directory request required')
        if self.file_errno is None:
            self.file_errno = self.allocate(4)
        self.put(self.file_errno, 'I', 30)
        self.read_only_directory_calls.append({'operation': '_access' if at == 0x1fee6cc else '_mkdir', 'pathHex': path.hex(), 'mode': mode, 'result': -1,
            'darwinErrno': 30, 'policy': 'offline-read-only-filesystem', 'hostWriteExecuted': False})
        engine.reg_write(r.UC_X86_REG_RAX, 0xffffffffffffffff)
        self.ret()
