"""Bounded BSD strlcpy platform operation; no game callbacks are replaced."""
from unicorn import x86_const as r


class NativeBsdStringCopy:
    def __init__(self, *args, **kwargs):
        self.bsd_string_copy_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(0x1feede6) != '_strlcpy':
            raise ValueError('Original BSD strlcpy platform import differs')

    def imported(self, engine, address, size, user):
        if address - self.base != 0x1feede6:
            return super().imported(engine, address, size, user)
        target, source, capacity = [engine.reg_read(register) for register in
                                  [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX]]
        if capacity > 0x10000 or capacity and not self.writable_file_memory(target, capacity):
            raise ValueError('BSD string copy escaped bounded owned destination')
        data = self.cstring(source)
        if len(data) > 0x10000:
            raise ValueError('BSD string copy escaped bounded source')
        copied = min(len(data), max(0, capacity - 1))
        if capacity:
            engine.mem_write(target, data[:copied] + b'\0')
        self.bsd_string_copy_calls.append({'sourceBytes': len(data), 'capacity': capacity,
                                          'copiedBytes': copied, 'platformLibraryBoundary': True})
        engine.reg_write(r.UC_X86_REG_RAX, len(data))
        self.ret()
