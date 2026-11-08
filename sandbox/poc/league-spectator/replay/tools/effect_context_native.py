"""Original character context identity and registry components.

Asset loading is excluded. The decimal skin text normally produced by the
native %u formatter is an explicit input to the bounded identity fragment.
No entity, graphics or resource callback is substituted.
"""
import ctypes
import struct
from unicorn import x86_const as r
from vfx_retirement_native import NativeVfxRetirement

FRAME = 0x100f5000
TEXT = 0x100e0000
STRINGS = 0x100e4000


class NativeEffectContexts(NativeVfxRetirement):
    def original_string(self, address, value):
        if not isinstance(value, str) or not value or '\0' in value or len(value.encode('ascii')) > 1024:
            raise ValueError('A bounded ASCII context string is required')
        self.u.mem_write(TEXT, value.encode('ascii')+b'\0')
        self.u.mem_write(address, bytes(24))
        self.call(0x11fe0, {r.UC_X86_REG_RDI: address, r.UC_X86_REG_RSI: TEXT,
                            r.UC_X86_REG_RDX: len(value)})

    def character_context(self, name, skin, namespace='characters'):
        if type(skin) is not int or not 0 <= skin <= 0xffffffff:
            raise ValueError('An unsigned skin identity is required')
        self.original_string(STRINGS, name)
        self.original_string(STRINGS+0x20, namespace)
        obj = self.allocate(0x90)
        # Complete constructor prefix, ending immediately before asset loading.
        self.fragment(0x351910, 0x3519e7, {
            r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: STRINGS,
            r.UC_X86_REG_RDX: skin, r.UC_X86_REG_RCX: STRINGS+0x20,
            r.UC_X86_REG_R8: 0})
        # Confirm supplied decimal bytes against the host C %u contract.
        formatted = ctypes.create_string_buffer(32)
        formatter = ctypes.CDLL('msvcrt.dll').sprintf
        formatter.restype = ctypes.c_int
        count = formatter(formatted, b'%u', ctypes.c_uint(skin))
        decimal = str(skin).encode('ascii')
        if count != len(decimal) or formatted.value != decimal:
            raise ValueError('Unsigned decimal formatting differs')
        self.u.mem_write(TEXT, decimal+b'\0')
        self.u.mem_write(FRAME-0x300, bytes(0x300))
        self.put(FRAME-0x260, 'Q', TEXT)
        self.fragment(0x351af4, 0x351b46, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: obj})
        identity = struct.unpack('<I', self.u.mem_read(obj+0x48, 4))[0]
        return {'name': name, 'skinId': skin, 'namespace': namespace,
                'identity': identity, 'object': obj,
                'objectHex': bytes(self.u.mem_read(obj, 0x90)).hex(),
                'decimalAscii': decimal.decode('ascii')}

    def registry(self):
        obj = self.allocate(0xc0)
        self.call(0x3530b0, {r.UC_X86_REG_RDI: obj})
        return obj

    def register_context(self, registry, context):
        # Original insertion of a constructed context keyed by its +48 identity.
        # Stop before notification callbacks, after the registry's value store.
        self.u.mem_write(FRAME-0x100, bytes(0x100))
        self.fragment(0x353ba1, 0x353c3e, {
            r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_R14: context,
            r.UC_X86_REG_R15: registry})

    def lookup_context(self, registry, identity):
        if type(identity) is not int or not 0 <= identity <= 0xffffffff:
            raise ValueError('An unsigned context identity is required')
        self.call(0x354280, {r.UC_X86_REG_RDI: registry, r.UC_X86_REG_RSI: identity})
        return self.u.reg_read(r.UC_X86_REG_RAX)
