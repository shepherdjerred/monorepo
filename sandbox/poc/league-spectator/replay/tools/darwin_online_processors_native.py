"""Explicit platform input for the observed Darwin sysconf CPU-count ABI.

Apple Libc include/unistd.h defines _SC_NPROCESSORS_ONLN as 58:
https://github.com/apple-oss-distributions/Libc/blob/main/include/unistd.h
Only the original observed worker-constructor call site is admitted here.
"""
from unicorn import x86_const as r


class NativeDarwinOnlineProcessors:
    def configure_online_processors(self, value, *, performance_levels_unavailable=False):
        if type(value) is not int or not 1 <= value <= 1024:
            raise ValueError('Explicit bounded positive online processor count required')
        if hasattr(self, 'online_processors'):
            raise ValueError('Online processor platform input already configured')
        if type(performance_levels_unavailable) is not bool:
            raise ValueError('Explicit performance-level availability input required')
        self.online_processors = value
        self.performance_levels_unavailable = performance_levels_unavailable
        self.online_processor_calls = []
        return {'selector': 58, 'value': value, 'callerReturnRva': 0x14b25d0,
                'performanceLevelQueryPolicy': 'explicit-unavailable-ENOENT' if performance_levels_unavailable else 'unadmitted',
                'scope': 'Explicit platform CPU-count input; no game or worker readiness state supplied'}

    def imported(self, uc, address, size, user):
        name = self.source.imports[address-self.base]
        if name == '_sysctlbyname':
            return self.online_performance_level_query(uc)
        if name != '_sysconf':
            return super().imported(uc, address, size, user)
        selector = uc.reg_read(r.UC_X86_REG_RDI)
        caller = self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
        if (selector != 58 or caller != 0x14b25d0 or
                self.image[0x14b25c6:0x14b25d0] != bytes.fromhex('bf3a000000e88ec8b300') or
                not hasattr(self, 'online_processors') or len(self.online_processor_calls) >= 128):
            raise ValueError('Unadmitted Darwin sysconf selector/caller or missing bounded platform input')
        self.online_processor_calls.append({'selector': selector, 'value': self.online_processors,
                                            'callerReturnRva': caller})
        uc.reg_write(r.UC_X86_REG_RAX, self.online_processors)
        self.ret()

    def online_performance_level_query(self, uc):
        # A separately declared platform namespace-absence control, never a
        # fabricated successful topology value. Darwin documents ENOENT for
        # unavailable sysctl names. Original game code owns its error branch:
        # https://developer.apple.com/documentation/kernel/1387446-sysctlbyname
        caller = self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
        pointer = uc.reg_read(r.UC_X86_REG_RDI)
        output = uc.reg_read(r.UC_X86_REG_RSI)
        length = uc.reg_read(r.UC_X86_REG_RDX)
        new_value, new_length = uc.reg_read(r.UC_X86_REG_RCX), uc.reg_read(r.UC_X86_REG_R8)
        expected = {0x14b2615: b'hw.perflevel0.physicalcpu',
                    0x14b2632: b'hw.perflevel1.physicalcpu'}
        if (not getattr(self, 'performance_levels_unavailable', False) or caller not in expected or
                self.cstring(pointer) != expected[caller] or new_value or new_length or
                not self.writable_file_memory(output, 4) or not self.writable_file_memory(length, 8) or
                self.q(length) != 4 or len(self.online_processor_calls) >= 128):
            raise ValueError('Unadmitted Darwin performance-level query or platform namespace policy')
        if self.file_errno is None:
            self.file_errno = self.allocate(4)
        self.put(self.file_errno, 'I', 2)
        self.online_processor_calls.append({'name': expected[caller].decode(), 'callerReturnRva': caller,
                                            'returned': -1, 'darwinErrno': 2,
                                            'policy': 'explicit-performance-level-namespace-unavailable'})
        uc.reg_write(r.UC_X86_REG_RAX, 0xffffffffffffffff)
        self.ret()
