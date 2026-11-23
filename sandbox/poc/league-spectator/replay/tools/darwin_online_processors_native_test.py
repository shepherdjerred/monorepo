import unittest
from types import SimpleNamespace
from unicorn import x86_const as r
from darwin_online_processors_native import NativeDarwinOnlineProcessors


class Base:
    def imported(self, *args):
        return 'delegated'


class Fake(NativeDarwinOnlineProcessors, Base):
    def __init__(self):
        self.base = 0x100000000
        self.source = SimpleNamespace(imports={100: '_sysconf', 200: '_other', 300: '_sysctlbyname'})
        self.registers = {r.UC_X86_REG_RDI: 58, r.UC_X86_REG_RSP: 1024}
        self.return_rva = 0x14b25d0
        class Image:
            def __getitem__(_, key):
                if (key.start, key.stop) != (0x14b25c6, 0x14b25d0):
                    raise AssertionError('Unexpected original instruction span')
                return bytes.fromhex('bf3a000000e88ec8b300')
        self.image = Image()
        self.returns = 0
        self.file_errno = None
        self.writes = []

    def q(self, address):
        if address == 2048:
            return 4
        if address != 1024:
            raise AssertionError('Unexpected original return stack')
        return self.base+self.return_rva

    def reg_read(self, register):
        return self.registers[register]

    def reg_write(self, register, value):
        self.registers[register] = value

    def ret(self):
        self.returns += 1

    def cstring(self, pointer):
        if pointer != 3072:
            raise AssertionError('Unexpected original sysctl name')
        return b'hw.perflevel0.physicalcpu'

    def writable_file_memory(self, pointer, size):
        return (pointer, size) in [(2048, 8), (4096, 4)]

    def allocate(self, size):
        if size != 4:
            raise AssertionError('Unexpected errno allocation')
        return 5120

    def put(self, pointer, kind, value):
        self.writes.append((pointer, kind, value))


class Controls(unittest.TestCase):
    def test_original_selector_caller_and_exact_return(self):
        for value in [1, 2, 64, 1024]:
            n = Fake()
            n.configure_online_processors(value)
            n.imported(n, n.base+100, 1, None)
            self.assertEqual(n.registers[r.UC_X86_REG_RAX], value)
            self.assertEqual(n.returns, 1)
            self.assertEqual(n.online_processor_calls, [{'selector': 58, 'value': value,
                                                        'callerReturnRva': 0x14b25d0}])
            self.assertEqual(n.imported(n, n.base+200, 1, None), 'delegated')

    def test_invalid_or_unknown_inputs_fail_without_native_return(self):
        for value in [None, True, 0, -1, 1025, 1.5]:
            n = Fake()
            with self.assertRaisesRegex(ValueError, 'bounded positive'):
                n.configure_online_processors(value)
        for change in ['unconfigured', 'selector', 'caller', 'quota']:
            n = Fake()
            if change != 'unconfigured':
                n.configure_online_processors(4)
            if change == 'selector':
                n.registers[r.UC_X86_REG_RDI] = 57
            if change == 'caller':
                n.return_rva += 1
            if change == 'quota':
                n.online_processor_calls = [{}]*128
            with self.assertRaisesRegex(ValueError, 'Unadmitted Darwin'):
                n.imported(n, n.base+100, 1, None)
            self.assertEqual(n.returns, 0)
        n = Fake()
        n.configure_online_processors(4)
        with self.assertRaisesRegex(ValueError, 'already configured'):
            n.configure_online_processors(4)

    def test_explicit_namespace_absence_preserves_original_output_buffers(self):
        n = Fake()
        n.configure_online_processors(24, performance_levels_unavailable=True)
        n.return_rva = 0x14b2615
        n.registers.update({r.UC_X86_REG_RDI: 3072, r.UC_X86_REG_RSI: 4096,
                            r.UC_X86_REG_RDX: 2048, r.UC_X86_REG_RCX: 0, r.UC_X86_REG_R8: 0})
        n.imported(n, n.base+300, 1, None)
        self.assertEqual(n.registers[r.UC_X86_REG_RAX], 0xffffffffffffffff)
        self.assertEqual(n.writes, [(5120, 'I', 2)])
        self.assertEqual(n.returns, 1)
        for change in ['unadmitted-policy', 'caller', 'output', 'new-value']:
            n = Fake()
            n.configure_online_processors(24, performance_levels_unavailable=change != 'unadmitted-policy')
            n.return_rva = 0x14b2616 if change == 'caller' else 0x14b2615
            n.registers.update({r.UC_X86_REG_RDI: 3072, r.UC_X86_REG_RSI: 4097 if change == 'output' else 4096,
                                r.UC_X86_REG_RDX: 2048, r.UC_X86_REG_RCX: 1 if change == 'new-value' else 0,
                                r.UC_X86_REG_R8: 0})
            with self.assertRaisesRegex(ValueError, 'Unadmitted Darwin performance-level'):
                n.imported(n, n.base+300, 1, None)
            self.assertEqual(n.writes, [])
            self.assertEqual(n.returns, 0)


if __name__ == '__main__':
    unittest.main()
