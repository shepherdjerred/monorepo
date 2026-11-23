"""One original scene-decompression bzero ABI for its caller-owned temporary.

The original symbol-count computation and frame layout bound the destination;
this does not admit arbitrary stack writes or replace decompression code.
"""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


class UiSceneStackZero:
    def __init__(self, n):
        self.n, self.records = n, []
        for start, encoded in [
            (0x1B5CC70, '554889e54157415641554154534881ec98000000'),
            (0x1B5CD2B, '488dbd60ffffff488db55cffffff488d9558ffffff4c89c9'),
            (0x1B5CD43, 'e858b3f8ff'),
            (0x1AE80A0, '554889e54531c95de9a3f9ffff'),
            (0x1AE7AFE, '488975b8448b3641ffc64489f64801f64c89e748894dc0'),
            (0x1AE7B15, 'e8e06a5000')]:
            if n.image[start:start + len(bytes.fromhex(encoded))] != bytes.fromhex(encoded):
                raise ValueError("Original scene decompression stack-fill ABI changed")

    def apply(self, engine):
        n = self.n
        stack = engine.reg_read(r.UC_X86_REG_RSP)
        if n.q(stack) != n.base + 0x1AE7B1A:
            return False
        frame = engine.reg_read(r.UC_X86_REG_RBP)
        low, high = ADDRESSES['stack'] - 0x10000, ADDRESSES['stack'] + 8
        if not low <= stack == frame - 0x58 < frame <= high - 16:
            raise ValueError("Scene decoder stack-fill escaped the active owned frame")
        parent = n.q(frame)
        if (parent != frame + 0xD0 or parent > high - 16 or
                n.q(frame + 8) != n.base + 0x1B5CD48):
            raise ValueError("Scene decoder stack-fill lacks its original caller frame")
        destination = engine.reg_read(r.UC_X86_REG_RDI)
        count = engine.reg_read(r.UC_X86_REG_RSI)
        if (destination != parent - 0xA0 or not 0 < count <= 0x70 or
                count != 2 * (n.u32(parent - 0xA4) + 1) or
                n.q(frame - 0x48) != parent - 0xA4):
            raise ValueError("Scene decoder stack-fill exceeds its original symbol-count temporary")
        before = bytes(engine.mem_read(parent - 0x30, 8))
        engine.mem_write(destination, bytes(count))
        if bytes(engine.mem_read(parent - 0x30, 8)) != before:
            raise ValueError("Scene decoder stack-fill changed the original caller canary")
        self.records.append({'originalCallRva': 0x1AE7B15, 'originalCallerReturnRva': 0x1B5CD48,
            'destination': destination, 'bytes': count, 'symbolCount': n.u32(parent - 0xA4) + 1,
            'originalCallerCanaryPreserved': True})
        n.ret()
        return True
