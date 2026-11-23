"""The scene decoder can clear only its exact source-owned stack temporary."""
import struct
import unittest

from unicorn import x86_const as r
from ui_scene_stack_zero_native import UiSceneStackZero
from vfx_spawn_native import ADDRESSES


class Fixture:
    def __init__(self):
        self.base, self.retired = 0x100000000, False
        self.low = ADDRESSES['stack'] - 0x10000
        self.memory = bytearray(b'\xa5' * 0x10008)
        self.parent = ADDRESSES['stack'] - 0x1008
        self.frame = self.parent - 0xD0
        self.stack = self.frame - 0x58
        self.registers = {r.UC_X86_REG_RSP: self.stack, r.UC_X86_REG_RBP: self.frame,
            r.UC_X86_REG_RDI: self.parent - 0xA0, r.UC_X86_REG_RSI: 72}
        self.put(self.stack, 'Q', self.base + 0x1AE7B1A)
        self.put(self.frame, 'Q', self.parent)
        self.put(self.frame + 8, 'Q', self.base + 0x1B5CD48)
        self.put(self.frame - 0x48, 'Q', self.parent - 0xA4)
        self.put(self.parent - 0xA4, 'I', 35)

    def put(self, at, kind, value):
        self.mem_write(at, struct.pack('<' + kind, value))

    def q(self, at):
        return struct.unpack('<Q', self.mem_read(at, 8))[0]

    def u32(self, at):
        return struct.unpack('<I', self.mem_read(at, 4))[0]

    def mem_read(self, at, size):
        return self.memory[at - self.low:at - self.low + size]

    def mem_write(self, at, data):
        self.memory[at - self.low:at - self.low + len(data)] = data

    def reg_read(self, reg):
        return self.registers[reg]

    def ret(self):
        self.retired = True


class StackFillTests(unittest.TestCase):
    def fixture(self):
        n = Fixture()
        adapter = UiSceneStackZero.__new__(UiSceneStackZero)
        adapter.n, adapter.records = n, []
        return n, adapter

    def test_only_source_symbol_extent_changes(self):
        n, adapter = self.fixture()
        before = bytes(n.memory)
        self.assertTrue(adapter.apply(n))
        start = n.parent - 0xA0 - n.low
        self.assertEqual(n.memory[:start], before[:start])
        self.assertEqual(n.memory[start:start + 72], bytes(72))
        self.assertEqual(n.memory[start + 72:], before[start + 72:])
        self.assertTrue(n.retired)
        self.assertEqual(adapter.records[0]['symbolCount'], 36)

    def test_other_calls_and_forged_frame_extents_do_not_write(self):
        for mutation in ['caller', 'parent', 'destination', 'count', 'symbolCount']:
            with self.subTest(mutation=mutation):
                n, adapter = self.fixture()
                if mutation == 'caller':
                    n.put(n.stack, 'Q', n.base + 1)
                elif mutation == 'parent':
                    n.put(n.frame, 'Q', n.parent + 8)
                elif mutation == 'destination':
                    n.registers[r.UC_X86_REG_RDI] += 8
                elif mutation == 'count':
                    n.registers[r.UC_X86_REG_RSI] = 112
                else:
                    n.put(n.parent - 0xA4, 'I', 56)
                before = bytes(n.memory)
                if mutation == 'caller':
                    self.assertFalse(adapter.apply(n))
                else:
                    with self.assertRaises(ValueError):
                        adapter.apply(n)
                self.assertEqual(n.memory, before)
                self.assertFalse(n.retired)


if __name__ == '__main__':
    unittest.main()
