"""Reject forged native object placement despite accessible arena memory."""
import struct
import unittest

from unicorn import x86_const as r
from ui_serialized_objects_native import UiSerializedObjects


class Memory:
    def __init__(self):
        self.registers = {}
        self.memory = bytearray(0x2000)

    def reg_read(self, key):
        return self.registers[key]

    def mem_read(self, address, count):
        return self.memory[address:address + count]


class Fixture:
    def __init__(self):
        self.base = 0x100000000
        self.u = Memory()
        self.asset_aligned_allocations = {0x108: {
            'retired': False, 'bytes': 0x100, 'alignment': 8,
            'returnRva': 0x14BB1F7, 'base': 0x100}}
        self.put(0x20, 0x60)
        self.put(0x60 + 0x20, 0x108)
        self.put(0x700 - 0x60, 0x800)
        self.put(0x800 + 0x40, 0x28)
        self.put(0x800 + 0x48, 8)
        self.put(0x128, self.base + 0x123)
        self.u.memory[0x808:0x80c] = struct.pack('<I', 0xabcdef)
        self.u.registers.update({r.UC_X86_REG_RBX: 0x60,
            r.UC_X86_REG_RAX: 0x108, r.UC_X86_REG_R14: 0x100,
            r.UC_X86_REG_R12: 8, r.UC_X86_REG_RBP: 0x700})

    def put(self, at, value):
        self.u.memory[at:at + 8] = struct.pack('<Q', value)

    def q(self, at):
        return struct.unpack('<Q', self.u.mem_read(at, 8))[0]

    def library_pointer(self, at, size):
        return 0 <= at <= len(self.u.memory) - size


class PlacementTests(unittest.TestCase):
    def observe(self):
        n = Fixture()
        # Hook installation separately verifies pinned original instructions.
        owner = UiSerializedObjects.__new__(UiSerializedObjects)
        owner.n, owner.arenas, owner.objects = n, {}, {}
        owner.allocation(n.u, 0, 0, None)
        n.u.registers[r.UC_X86_REG_RBX] = 0x20
        n.u.registers[r.UC_X86_REG_R14] = 0x128
        owner.placement(n.u, 0, 0, None)
        return n, owner

    def test_exact_subobject_not_allocation_start_is_owned(self):
        _, owner = self.observe()
        self.assertEqual(owner.require(0x128, 0x28, 0x123)['arena'], 0x108)
        with self.assertRaisesRegex(ValueError, 'exact original typed placement'):
            owner.require(0x130, 0x20)
        with self.assertRaisesRegex(ValueError, 'exact original typed placement'):
            owner.require(0x128, 0x20)
        with self.assertRaisesRegex(ValueError, 'class vtable'):
            owner.require(0x128, 0x28, 0x124)

    def test_type_extent_and_allocation_lifetime_are_required(self):
        n, owner = self.observe()
        n.put(0x800 + 0x40, 0x100)
        with self.assertRaisesRegex(ValueError, 'escaped'):
            owner.placement(n.u, 0, 0, None)
        n.asset_aligned_allocations[0x108]['retired'] = True
        with self.assertRaisesRegex(ValueError, 'live original BIN arena'):
            owner.require(0x128, 0x28)
        n.u.registers[r.UC_X86_REG_RBX] = 0x60
        n.u.registers[r.UC_X86_REG_R14] = 0x100
        with self.assertRaisesRegex(ValueError, 'live aligned allocation'):
            owner.allocation(n.u, 0, 0, None)


if __name__ == '__main__':
    unittest.main()
