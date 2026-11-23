"""Source-scoped four-integer C-locale scan through the existing UCRT port.

No version value is supplied. Original caller initialization, source bytes,
conversion count and failure branches remain unchanged.
"""
import ctypes as C
import struct
from unicorn import x86_const as r


class NativeClientVersionScan:
    def imported(self, engine, address, size, user):
        name = self.source.imports[address-self.base]
        if name != '_vsscanf':
            return super().imported(engine, address, size, user)
        format_at = engine.reg_read(r.UC_X86_REG_RSI)
        if self.cstring(format_at) != b'%i.%i.%i.%i':
            return super().imported(engine, address, size, user)
        if (self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base != 0x144c209 or
                self.q(engine.reg_read(r.UC_X86_REG_RBP)+8)-self.base != 0x14dc77f or
                self.image[0x14dc73f:0x14dc784] != self.source.image[0x14dc73f:0x14dc784] or
                self.image[0x144c180:0x144c222] != self.source.image[0x144c180:0x144c222]):
            raise ValueError('Unowned original client-version integer scan caller')
        data = self.cstring(engine.reg_read(r.UC_X86_REG_RDI))
        args_at = engine.reg_read(r.UC_X86_REG_RDX)
        if len(data) > 64 or any(byte > 127 for byte in data) or not self.library_pointer(args_at, 24):
            raise ValueError('Original version scan escaped ASCII/va_list bounds')
        gp, fp = self.u32(args_at), self.u32(args_at+4)
        saved = self.q(args_at+16)
        if gp != 16 or fp != 48 or not self.library_pointer(saved+gp, 32):
            raise ValueError('Original version scan SysV register-save ABI differs')
        destinations = [self.q(saved+gp+i*8) for i in range(4)]
        if any(not self.writable_file_memory(at, 4) for at in destinations):
            raise ValueError('Original version scan destination escaped owned writable memory')
        values = (C.c_int32*4)()
        pointers = (C.c_void_p*4)(*[C.addressof(values)+i*4 for i in range(4)])
        locale = self.legacy_locale(0, b'C')
        if not locale:
            raise ValueError('Original version scan C-locale platform initialization failed')
        try:
            result = self.legacy_scan(0, data, len(data), b'%i.%i.%i.%i', locale, pointers)
        finally:
            self.legacy_free_locale(locale)
        if not -1 <= result <= 4:
            raise ValueError('Original version scan assignment count is invalid')
        for index in range(max(0, result)):
            engine.mem_write(destinations[index], struct.pack('<i', values[index]))
        calls = getattr(self, 'client_version_scan_calls', [])
        if len(calls) >= 4096:
            raise ValueError('Original version scan call quota exceeded')
        calls.append({'inputHex': data.hex(), 'assigned': result,
                      'values': list(values)[:max(0, result)], 'callerRva': 0x14dc77f})
        self.client_version_scan_calls = calls
        engine.reg_write(r.UC_X86_REG_RAX, result & 0xffffffffffffffff)
        self.ret()
