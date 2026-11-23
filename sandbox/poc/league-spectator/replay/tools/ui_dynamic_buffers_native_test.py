import unittest
from types import SimpleNamespace
from unicorn import x86_const as r
from ui_dynamic_buffers_native import NativeUiDynamicBuffers
from vfx_graphics_native import DEVICE
from vfx_spawn_native import ADDRESSES


class Image:
    def __init__(self, changed=False):
        self.changed = changed

    def __getitem__(self, key):
        return b"changed-original" if self.changed else b"original-code"


class Fake(NativeUiDynamicBuffers):
    def __init__(self):
        self.base = 0x100000000
        self.ui_manager_startup_active = True
        self.owner = 0x11000000
        self.allocations = {self.owner: 0xD0}
        self.frame = ADDRESSES["stack"] - 0x60
        self.stack = self.frame - 0x18
        self.parent = 0x1899D60
        self.caller = 0x1917B19
        self.image = Image()
        self.source = SimpleNamespace(image=Image())
        self.pending_index_buffer = None
        self.requests, self.writes = [], []
        self.index_callbacks = {"return": 0x100F6000}
        self.dynamic_buffer_device = SimpleNamespace(create_uninitialized=self.create)
        self.registers = {r.UC_X86_REG_RDI: DEVICE, r.UC_X86_REG_RSI: 0x20000,
            r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: 3, r.UC_X86_REG_R8: 0,
            r.UC_X86_REG_RSP: self.stack, r.UC_X86_REG_RBP: self.frame,
            r.UC_X86_REG_R15: self.owner + 0x70}

    def create(self, count, flags, *, kind):
        self.requests.append((count, flags, kind))
        return {"bytes": count, "flags": flags, "kind": "dynamic-uninitialized-index"}

    def q(self, address):
        return {self.stack: self.base + self.caller, self.frame + 8: self.base + self.parent}[address]

    def allocate(self, size, poison):
        if (size, poison) != (0x48, 0xA5):
            raise AssertionError("Unexpected original CPU-header storage request")
        return self.owner + 0x100

    def put(self, *args):
        self.writes.append(args)

    def reg_read(self, register):
        return self.registers[register]

    def reg_write(self, register, value):
        self.registers[register] = value


class Controls(unittest.TestCase):
    def test_original_ui_owner_dispatches_to_original_index_header(self):
        n = Fake()
        n.index_buffer_create(n, 0, 1, None)
        self.assertEqual(n.requests, [(0x20000, 3, "index")])
        self.assertEqual(n.pending_index_buffer["gpu"]["originalUiRequest"]["owner"], n.owner)
        self.assertEqual(n.registers[r.UC_X86_REG_RIP], n.base + 0x1916AE0)
        self.assertEqual(n.registers[r.UC_X86_REG_RSI], 0x20000)

    def test_unrelated_or_changed_native_requests_cannot_allocate_ui_gpu_storage(self):
        for change in ["device", "count", "format", "flags", "source", "owner", "parent", "frame", "code", "pending"]:
            with self.subTest(change=change):
                n = Fake()
                if change == "device": n.registers[r.UC_X86_REG_RDI] += 1
                if change == "count": n.registers[r.UC_X86_REG_RSI] += 4
                if change == "format": n.registers[r.UC_X86_REG_RDX] = 1
                if change == "flags": n.registers[r.UC_X86_REG_RCX] = 1
                if change == "source": n.registers[r.UC_X86_REG_R8] = n.owner
                if change == "owner": n.allocations[n.owner] = 0xD8
                if change == "parent": n.parent += 1
                if change == "frame": n.registers[r.UC_X86_REG_RBP] = ADDRESSES["stack"] + 8
                if change == "code": n.image = Image(changed=True)
                if change == "pending": n.pending_index_buffer = {}
                with self.assertRaisesRegex(ValueError, "Unadmitted original UI"):
                    n.index_buffer_create(n, 0, 1, None)
                self.assertEqual(n.requests, [])
                self.assertEqual(n.writes, [])


if __name__ == "__main__":
    unittest.main()
