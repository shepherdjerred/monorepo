"""Exact SDK C-library boundaries; generic allocation/clock guards stay strict."""
import ctypes
from unicorn import x86_const as r
from vfx_spawn_native import sha


class NativeDarwinSdkStorage:
    def service(self, engine, address, size, user):
        state = getattr(self, 'darwin_sdk_threads', None)
        at = engine.reg_read(r.UC_X86_REG_RDI)
        if state is None or address-self.base != 0x1feea44 or at != self.base+0x25704f0:
            return super().service(engine, address, size, user)
        count = engine.reg_read(r.UC_X86_REG_RDX)
        source = engine.reg_read(r.UC_X86_REG_RSI)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
        calls = state.setdefault('originalStaticCopyCalls', [])
        if (caller != 0x1bc338f or count != 0xb0 or not self.library_pointer(source, count) or
                len(calls) >= 4 or
                self.image[0x1bc3369:0x1bc338f] != self.source.image[0x1bc3369:0x1bc338f]):
            raise ValueError('Exact original SDK configuration memcpy caller/extent required')
        data = bytes(engine.mem_read(source, count))
        engine.mem_write(at, data)
        calls.append({'callerRva': caller, 'destinationRva': at-self.base, 'bytes': count,
            'source': source, 'copiedSha256': sha(data),
            'sourceSha256': sha(self.image[0x1bc3369:0x1bc338f])})
        engine.reg_write(r.UC_X86_REG_RAX, at)
        self.ret()

    def imported(self, engine, address, size, user):
        state = getattr(self, 'darwin_sdk_threads', None)
        at = engine.reg_read(r.UC_X86_REG_RDI)
        name = self.source.imports[address-self.base]
        if state is not None and name == '_time':
            caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
            calls = state.setdefault('hostWallTimeCalls', [])
            if (at or caller != 0x1bc3732 or len(calls) >= 16 or
                    self.image[0x1bc3721:0x1bc3732] != self.source.image[0x1bc3721:0x1bc3732]):
                raise ValueError('Exact original SDK time(NULL) caller required')
            # Apple time(3): seconds since the Unix epoch, separate from game
            # time and mach_absolute_time. Use the real host C-runtime clock.
            # https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/time.3.html
            clock = self.crt._time64
            clock.argtypes, clock.restype = [ctypes.c_void_p], ctypes.c_int64
            value = clock(None)
            if value < -1:
                raise ValueError('Host C time result is outside its source contract')
            calls.append({'callerRva': caller, 'unixSeconds': value,
                'actualHostCClockRead': True, 'recordedGameTimeAdmitted': False})
            engine.reg_write(r.UC_X86_REG_RAX, value & 0xffffffffffffffff)
            self.ret()
            return
        if (state is None or name != '___bzero' or
                at != self.base+0x2554ee0):
            return super().imported(engine, address, size, user)
        count = engine.reg_read(r.UC_X86_REG_RSI)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
        spans = [(0x1be8520, 0x1be8536), (0x1bc3300, 0x1bc332d)]
        calls = state.setdefault('originalStaticZeroCalls', [])
        if (address-self.base != 0x1fee5fa or caller != 0x1bc332d or count != 0x120 or
                len(calls) >= 4 or any(self.image[begin:end] != self.source.image[begin:end]
                                     for begin, end in spans)):
            raise ValueError('Exact original SDK static bzero caller/extent required')
        before = bytes(engine.mem_read(at, count))
        engine.mem_write(at, bytes(count))
        calls.append({'callerRva': caller, 'destinationRva': at-self.base, 'bytes': count,
            'beforeSha256': sha(before), 'afterSha256': sha(bytes(count)),
            'source': [{'startRva': begin, 'endRva': end, 'sha256': sha(self.image[begin:end])}
                       for begin, end in spans]})
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()
