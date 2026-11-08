"""Bounded C libm ABI for the original integer texture mip-level query."""
import math
import struct
from unicorn import x86_const as r


class NativeTextureLog2:
    def __init__(self, *args):
        self.texture_math_calls = []
        super().__init__(*args)

    def imported(self, uc, address, size, user):
        if self.source.imports[address - self.base] != '_log2':
            return super().imported(uc, address, size, user)
        caller = self.q(uc.reg_read(r.UC_X86_REG_RSP)) - self.base
        bits = uc.reg_read(r.UC_X86_REG_XMM0) & 0xffffffffffffffff
        value = struct.unpack('<d', struct.pack('<Q', bits))[0]
        # This complete original caller converts the maximum uint16 texture
        # dimension to double, calls libm and rounds down before adding one.
        if caller != 0x16004a9 or not math.isfinite(value) or not 1 <= value <= 65535 or value != int(value):
            raise ValueError('Texture log2 caller or positive uint16 dimension differs')
        result = math.log2(value)
        uc.reg_write(r.UC_X86_REG_XMM0, struct.unpack('<Q', struct.pack('<d', result))[0])
        self.texture_math_calls.append({'callerRva': caller, 'dimension': int(value),
                                        'inputBits': bits, 'result': result})
        self.ret()
