import unittest
import ctypes as C
from types import SimpleNamespace
from unicorn import x86_const as r
from libc_memchr_native import NativeBoundedMemchr


class Base:
    def imported(self, *args):
        return 'delegated'


class Fake(NativeBoundedMemchr, Base):
    def __init__(self, value, count):
        self.base = 0x100000000
        self.source = SimpleNamespace(imports={10: '_memchr', 20: '_other'})
        self.data = b'a\0/b/\xff'
        self.registers = {r.UC_X86_REG_RDI: 1024, r.UC_X86_REG_RSI: value, r.UC_X86_REG_RDX: count}
        self.reads, self.returns = [], 0

    def library_pointer(self, pointer, count):
        return pointer == 1024 and count <= len(self.data)

    def reg_read(self, register):
        return self.registers[register]

    def reg_write(self, register, value):
        self.registers[register] = value

    def mem_read(self, pointer, count):
        self.reads.append((pointer, count))
        return self.data[:count]

    def ret(self):
        self.returns += 1


class Controls(unittest.TestCase):
    def test_all_bytes_and_prefix_lengths_match_independent_host_c_memchr(self):
        native = C.CDLL('msvcrt.dll').memchr
        native.argtypes = [C.c_void_p, C.c_int, C.c_size_t]
        native.restype = C.c_void_p
        source = C.create_string_buffer(b'a\0/b/\xff')
        base = C.addressof(source)
        for byte in range(256):
            for count in range(7):
                result = native(base, byte, count)
                expected = 1024+(result-base) if result is not None else 0
                n = Fake(byte, count)
                n.imported(n, n.base+10, 1, None)
                self.assertEqual(n.registers[r.UC_X86_REG_RAX], expected)

    def test_explicit_span_includes_nul_and_returns_first_match(self):
        for byte, count, expected in [(47, 6, 1026), (0, 6, 1025), (47, 2, 0),
                                      (255, 6, 1029), (0xffffffffffffffff, 6, 1029), (97, 0, 0)]:
            n = Fake(byte, count)
            n.imported(n, n.base+10, 1, None)
            self.assertEqual(n.registers[r.UC_X86_REG_RAX], expected)
            self.assertEqual(n.returns, 1)
            self.assertEqual(n.reads, [(1024, count)] if count else [])
            self.assertEqual(n.imported(n, n.base+20, 1, None), 'delegated')

    def test_unknown_storage_excess_length_and_quota_never_read_or_return(self):
        for change in ['storage', 'length', 'quota']:
            n = Fake(47, 6)
            if change == 'storage':
                n.registers[r.UC_X86_REG_RDI] += 1
            if change == 'length':
                n.registers[r.UC_X86_REG_RDX] = 16*1024*1024+1
            if change == 'quota':
                n.memchr_calls = [{}]*65536
            with self.assertRaises(ValueError):
                n.imported(n, n.base+10, 1, None)
            self.assertEqual(n.reads, [])
            self.assertEqual(n.returns, 0)


if __name__ == '__main__':
    unittest.main()
