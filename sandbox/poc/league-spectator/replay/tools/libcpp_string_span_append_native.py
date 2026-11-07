"""Length-delimited append through the same bounded libc++ insertion ABI."""
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string
from libcpp_string_append_native import NativeLibcppStringAppend
from libcpp_string_resize_native import INSERT_RVA

SPAN_APPEND_RVA = 0x1fee360
SPAN_APPEND_NAME = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKcm'


class NativeLibcppStringSpanAppend(NativeLibcppStringAppend):
    def __init__(self, *args, **kwargs):
        self.libcpp_span_append_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(SPAN_APPEND_RVA) != SPAN_APPEND_NAME:
            raise ValueError('Original libc++ span append platform import differs')

    def imported(self, engine, address, size, user):
        if address - self.base != SPAN_APPEND_RVA:
            return super().imported(engine, address, size, user)
        target, source, amount = [engine.reg_read(register) for register in
                                 [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX]]
        before = read_libcpp_string(self, target)
        if amount > 65535 - len(before) or amount and not self.library_pointer(source, amount):
            raise ValueError('libc++ span append escaped bounded owned source/size')
        suffix = bytes(engine.mem_read(source, amount)) if amount else b''
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base
        engine.reg_write(r.UC_X86_REG_RSI, len(before))
        engine.reg_write(r.UC_X86_REG_RDX, source)
        engine.reg_write(r.UC_X86_REG_RCX, amount)
        super().imported(engine, self.base + INSERT_RVA, size, user)
        if read_libcpp_string(self, target) != before + suffix:
            raise ValueError('Shared libc++ span append contents differ')
        self.libcpp_span_append_calls.append({'callerRva': caller, 'object': target,
            'beforeBytes': len(before), 'appendedBytes': amount, 'afterBytes': len(before) + amount,
            'platformLibraryBoundary': True, 'sharedSpanInsertionImplementation': True})
