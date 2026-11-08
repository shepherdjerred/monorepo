"""CString append delegates to the bounded shared libc++ span-insert ABI."""
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string
from libcpp_string_resize_native import NativeLibcppStringResize, INSERT_RVA

APPEND_RVA = 0x1fee35a
APPEND_NAME = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6appendEPKc'


class NativeLibcppStringAppend(NativeLibcppStringResize):
    def __init__(self, *args, **kwargs):
        self.libcpp_append_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(APPEND_RVA) != APPEND_NAME:
            raise ValueError('Original libc++ CString append import differs')

    def imported(self, engine, address, size, user):
        if address - self.base != APPEND_RVA:
            return super().imported(engine, address, size, user)
        target, source = engine.reg_read(r.UC_X86_REG_RDI), engine.reg_read(r.UC_X86_REG_RSI)
        before, suffix = read_libcpp_string(self, target), self.cstring(source)
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base
        # Standard append is insertion at size(). Reuse exactly the same owned
        # storage/bounds implementation, including overlapping source safety.
        # This is platform ABI dispatch; no guest game function is redirected.
        engine.reg_write(r.UC_X86_REG_RSI, len(before))
        engine.reg_write(r.UC_X86_REG_RDX, source)
        engine.reg_write(r.UC_X86_REG_RCX, len(suffix))
        super().imported(engine, self.base + INSERT_RVA, size, user)
        if read_libcpp_string(self, target) != before + suffix:
            raise ValueError('Shared libc++ append/insert contents differ')
        self.libcpp_append_calls.append({'callerRva': caller, 'object': target,
                                        'beforeBytes': len(before), 'appendedBytes': len(suffix),
                                        'afterBytes': len(before) + len(suffix),
                                        'platformLibraryBoundary': True,
                                        'sharedSpanInsertionImplementation': True})
