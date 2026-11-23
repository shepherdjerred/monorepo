import unittest
from types import SimpleNamespace
from unicorn import x86_const as r
from dynamic_vfx_buffers_native import NativeDynamicVfxBuffers
from vfx_graphics_native import DEVICE


class Base:
    def buffer_create(self, *args):
        return 'existing-static-gate'


class Image:
    def __getitem__(self, key):
        return b'original-code'


class Fake(NativeDynamicVfxBuffers, Base):
    def __init__(self):
        self.base = 0x100000000
        self.image = Image()
        self.source = SimpleNamespace(image=Image())
        self.registers = {r.UC_X86_REG_RDI: DEVICE, r.UC_X86_REG_RSI: 786396,
                          r.UC_X86_REG_RDX: 3, r.UC_X86_REG_RCX: 0, r.UC_X86_REG_RSP: 4096,
                          r.UC_X86_REG_RBX: 8192}
        self.pending_mesh_buffer = None
        self.return_rva = 0x1917baf
        self.requests, self.writes = [], []
        self.dynamic_buffer_device = SimpleNamespace(create_uninitialized=self.create_uninitialized)

    def create_uninitialized(self, count, flags):
        self.requests.append((count, flags))
        return {'bytes': count, 'flags': flags}

    def q(self, address):
        if address != 4096:
            raise AssertionError('Unexpected original return-stack read')
        return self.base+self.return_rva

    def allocate(self, size, poison):
        if (size, poison) != (0x48, 0xa5):
            raise AssertionError('Unexpected original CPU-header allocation')
        return 12288

    def put(self, *args):
        self.writes.append(args)

    def reg_read(self, register):
        return self.registers[register]

    def reg_write(self, register, value):
        self.registers[register] = value

    def library_pointer(self, pointer, size):
        return (pointer, size) == (8192, 0x48)

    def u32(self, address):
        return {8192+4: 16000*112, 8192+8: 16000*6, 8192+12: 16000}[address]


class Controls(unittest.TestCase):
    def test_exact_original_wrapper_executes_original_cpu_header(self):
        n = Fake()
        n.buffer_create(n, 0, 1, None)
        self.assertEqual(n.requests, [(786396, 3)])
        self.assertEqual(n.registers[r.UC_X86_REG_RIP], n.base+0x1917a40)
        self.assertEqual(n.registers[r.UC_X86_REG_RDI], 12288)
        self.assertEqual(n.pending_mesh_buffer['sourcePointer'], 0)
        self.assertEqual(n.pending_mesh_buffer['returnRva'], 0x1917baf)

    def test_original_pool_shape_and_static_gate_remain_distinct(self):
        n = Fake()
        n.return_rva = 0x17449bc
        n.registers[r.UC_X86_REG_RDX] = 1
        n.registers[r.UC_X86_REG_RSI] = 1792000
        n.buffer_create(n, 0, 1, None)
        self.assertEqual(n.requests, [(1792000, 1)])
        for index, count in [(False, 1792000), (True, 192000)]:
            n.validate_dynamic_vfx_pool(8192, count, 1, index)
            with self.assertRaisesRegex(ValueError, 'dimensions/flags'):
                n.validate_dynamic_vfx_pool(8192, count+4, 1, index)
        n = Fake()
        n.registers[r.UC_X86_REG_RDX] = 0
        n.registers[r.UC_X86_REG_RCX] = 16384
        self.assertEqual(n.buffer_create(n, 0, 1, None), 'existing-static-gate')
        self.assertEqual(n.requests, [])

    def test_unknown_caller_flags_count_and_owner_never_allocate_gpu_storage(self):
        for change in ['caller', 'device', 'pending', 'count', 'pool-flags', 'pool-count']:
            n = Fake()
            if change == 'caller':
                n.return_rva += 1
            if change == 'device':
                n.registers[r.UC_X86_REG_RDI] += 1
            if change == 'pending':
                n.pending_mesh_buffer = {}
            if change == 'count':
                n.registers[r.UC_X86_REG_RSI] = 0
            if change == 'pool-flags':
                n.registers[r.UC_X86_REG_RDX] = 1
            if change == 'pool-count':
                n.return_rva = 0x17449bc
                n.registers[r.UC_X86_REG_RDX] = 1
                n.registers[r.UC_X86_REG_RSI] = 1792004
            with self.assertRaises(ValueError):
                n.buffer_create(n, 0, 1, None)
            self.assertEqual(n.requests, [])
            self.assertEqual(n.writes, [])


if __name__ == '__main__':
    unittest.main()
