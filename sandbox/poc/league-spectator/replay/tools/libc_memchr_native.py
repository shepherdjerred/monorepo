"""Bounded C memchr ABI over owned original inputs, including embedded NULs.

https://github.com/apple-oss-distributions/Libc/blob/main/string/FreeBSD/memchr.3
The search byte is converted to unsigned char; the explicit count, rather than
a C-string terminator, determines the searched span. No game method is replaced.
"""
import hashlib
from unicorn import x86_const as r


class NativeBoundedMemchr:
    def imported(self, engine, address, size, user):
        if self.source.imports[address-self.base] != '_memchr':
            return super().imported(engine, address, size, user)
        pointer, value, count = [engine.reg_read(register) for register in
                                 [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX]]
        if count > 16*1024*1024 or count and not self.library_pointer(pointer, count):
            raise ValueError('C memchr span escaped owned input or explicit byte bound')
        calls = getattr(self, 'memchr_calls', None)
        if calls is None:
            self.memchr_calls = calls = []
        if len(calls) >= 65536:
            raise ValueError('C memchr call inventory exceeds explicit bound')
        data = bytes(engine.mem_read(pointer, count)) if count else b''
        index = data.find(bytes([value & 255]))
        result = pointer+index if index >= 0 else 0
        calls.append({'pointer': pointer, 'count': count, 'unsignedByte': value & 255,
                      'inputSha256': hashlib.sha256(data).hexdigest(), 'firstMatchOffset': index,
                      'returned': result})
        engine.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()
