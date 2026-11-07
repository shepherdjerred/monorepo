"""Original skeletal world-pose pass on explicitly supplied local T/S/Q poses."""
import struct

from unicorn import x86_const as r
from animation_rig_native import NativeAnimationRig, RIG, POSE

ROOT = 0x10090000
CANARY = 0x10091000
BLOCKS = [(0x15bc970, 0x15bd0c0), (0x15bd0c0, 0x15bd300),
          (0x15852a0, 0x1585440), (0x15bdea0, 0x15bdf60),
          (0x1499680, 0x1499870), (0xd3ca0, 0xd4050)]


class NativeAnimationWorldPose(NativeAnimationRig):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("World-pose code differs from pristine client")
        if self.source.imports[0x1fee5fa] != "___bzero":
            raise ValueError("Unexpected world-pose zero-fill binding")
        # External stack-canary data, not a replacement for the original check.
        self.put(self.base+0x22e0310, "Q", CANARY)
        self.put(CANARY, "Q", 0x7766554433221100)

    def reject(self, uc, address, size, user):
        if address-self.base != 0x1fee5fa:
            super().reject(uc, address, size, user)

    def imported(self, uc, address, size, user):
        if address-self.base == 0x1fee5fa:
            dest = self.u.reg_read(r.UC_X86_REG_RDI)
            count = self.u.reg_read(r.UC_X86_REG_RSI)
            if not 0 <= count <= 0x100000 or not 0x10000000 <= dest <= 0x12000000-count:
                raise ValueError("Unowned world-pose zero fill")
            if count:
                self.u.mem_write(dest, bytes(count))
            self.ret()
        else:
            super().imported(uc, address, size, user)

    def construct(self, raw, names):
        observed = self.prepare(raw, names)
        if not 0 < len(names) <= 256 or any(j["nativePoseIndex"] != i for i,j in enumerate(observed["joints"])):
            raise ValueError("World-pose joint layout is not admitted")
        self.u.mem_write(POSE, bytes(0x120))
        self.call(0x15bc970, {r.UC_X86_REG_RDI: POSE, r.UC_X86_REG_RSI: RIG})
        self.count = len(names)
        self.poses = self.q(POSE+8)
        parents = list(struct.unpack("<"+"i"*self.count, self.u.mem_read(self.q(POSE+0xc0), self.count*4)))
        if parents != [j["parentId"] for j in observed["joints"]]:
            raise ValueError("Native pose constructor changed parent mapping")
        rows = self.q(RIG+0x28)
        self.bind = [bytes(self.u.mem_read(rows+i*0x70+0x20, 40)).hex() for i in range(self.count)]
        return {"parents": parents, "jointIds": [j["nativePoseIndex"] for j in observed["joints"]],
                "bindLocalHex": self.bind, "joints": names}

    def evaluate(self, local, root, inherit_scale):
        if len(local) != self.count or type(inherit_scale) is not bool:
            raise ValueError("Invalid world-pose observation input")
        for i, value in enumerate(local):
            self.u.mem_write(self.poses+i*40, bytes.fromhex(value))
        self.u.mem_write(POSE+4, b"\0")
        self.put(POSE, "I", 0)
        self.u.mem_write(ROOT, bytes.fromhex(root))
        self.call(0x15852a0, {r.UC_X86_REG_RDI: POSE, r.UC_X86_REG_RSI: ROOT,
                            r.UC_X86_REG_RDX: int(inherit_scale)})
        result = {"worldHex": [bytes(self.u.mem_read(self.poses+i*40,40)).hex() for i in range(self.count)],
                  "changed": bool(self.u.reg_read(r.UC_X86_REG_AL)),
                  "revision": struct.unpack("<I", self.u.mem_read(POSE,4))[0],
                  "worldValid": bool(self.u.mem_read(POSE+4,1)[0]),
                  "rootHex": bytes(self.u.mem_read(POSE+0xe0,40)).hex()}
        # A second call must use the original valid-pose guard without recomposing.
        self.call(0x15852a0, {r.UC_X86_REG_RDI: POSE, r.UC_X86_REG_RSI: ROOT,
                            r.UC_X86_REG_RDX: int(inherit_scale)})
        result["secondChanged"] = bool(self.u.reg_read(r.UC_X86_REG_AL))
        if result["secondChanged"] or result["revision"] != 1 or not result["worldValid"]:
            raise ValueError("Unexpected native world-pose validity policy")
        if result["worldHex"] != [bytes(self.u.mem_read(self.poses+i*40,40)).hex() for i in range(self.count)]:
            raise ValueError("Valid-pose guard modified transforms")
        return result
