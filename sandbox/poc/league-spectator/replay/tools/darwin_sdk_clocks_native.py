"""Source-scoped SDK CLOCK_MONOTONIC port using the real host boot clock.

Darwin clock ID6 is not the Linux clock enumeration. This port remains separate
from controlled mach_absolute_time inputs and recorded replay/expiry clocks.
"""
import ctypes
from unicorn import x86_const as r
from vfx_spawn_native import sha


CLOCK_SHA = '55ee62841451d0d936fee72658b9c0452d5571c6039789e794e42751e2050f15'
TYPES_SHA = '42762c009edb73b054f83be3075935adc846fd88f0a7201dab2e02887a81fa82'
SOURCE_COMMIT = '63976b830a836a22649b806fe62e8614fe3e5555'


class NativeDarwinSdkClocks:
    def configure_sdk_host_clock(self, source, types):
        if getattr(self, 'sdk_host_clock', None) is not None:
            raise ValueError('SDK host-clock ownership is not reentrant')
        if sha(source) != CLOCK_SHA or sha(types) != TYPES_SHA or getattr(self, 'darwin_sdk_threads', None) is None:
            raise ValueError('Pinned Darwin clock sources and explicit SDK platform required')
        # The Windows API-set contract exports this entry on this host;
        # kernel32.dll does not. Select it explicitly, with no DLL fallback.
        kernel = ctypes.WinDLL('api-ms-win-core-realtime-l1-1-1.dll', use_last_error=True)
        query = kernel.QueryInterruptTimePrecise
        query.argtypes, query.restype = [ctypes.POINTER(ctypes.c_uint64)], None
        self.sdk_interrupt_query = query
        self.sdk_host_clock = {'sourceCommit': SOURCE_COMMIT, 'sourceSha256': CLOCK_SHA,
            'typesSha256': TYPES_SHA, 'platform': 'Windows QueryInterruptTimePrecise',
            'apiSet': 'api-ms-win-core-realtime-l1-1-1.dll',
            'clockId': 6, 'epoch': 'host-system-boot', 'calls': [],
            'recordedReplayClockAdmitted': False, 'soundWorkerReadinessAdmitted': False}
        return self.sdk_host_clock

    def imported(self, engine, address, size, user):
        state = getattr(self, 'sdk_host_clock', None)
        if state is None or self.source.imports[address-self.base] != '_clock_gettime':
            return super().imported(engine, address, size, user)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP))-self.base
        clock, target = engine.reg_read(r.UC_X86_REG_RDI), engine.reg_read(r.UC_X86_REG_RSI)
        if (address-self.base != 0x1fee78c or caller != 0x1bc7a48 or clock != 6 or
                not self.writable_file_memory(target, 16) or len(state['calls']) >= 4096 or
                self.image[0x1bc7a3a:0x1bc7a48] != self.source.image[0x1bc7a3a:0x1bc7a48]):
            raise ValueError('Exact original SDK CLOCK_MONOTONIC caller/storage required')
        # Apple Libc clock_gettime.c uses elapsed host boot time for ID6.
        # Windows documents this host counter in100ns units, including sleep:
        # https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryinterrupttimeprecise
        ticks = ctypes.c_uint64()
        self.sdk_interrupt_query(ctypes.byref(ticks))
        # The pinned Darwin ID6 implementation converts gettimeofday's whole
        # microseconds. Preserve that resolution despite the finer host port.
        ns = (ticks.value//10)*1000
        if state['calls'] and ns < state['calls'][-1]['nanoseconds']:
            raise ValueError('Actual host SDK monotonic clock moved backward')
        seconds, remainder = divmod(ns, 1_000_000_000)
        if seconds >= 1 << 63:
            raise ValueError('Host clock exceeds original timespec seconds width')
        self.put(target, 'qq', seconds, remainder)
        state['calls'].append({'callerRva': caller, 'clockId': clock, 'target': target,
            'host100nsTicks': ticks.value, 'nanoseconds': ns, 'seconds': seconds, 'remainder': remainder})
        engine.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()
