"""Original atomic-clip clock and loaded ANM header projections.

No resource loader or pose evaluator is modeled. Actual header-copy prefixes and
frame-count getters execute on owned raw ANM bytes, followed by the atomic clock
prefix stopping before event dispatch. Clip completion/loop policy is excluded.
"""
import struct

from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES as A
from vfx_uv_native import registrations


BLOCKS = [(0x15d6a70, 0x15d6ac6), (0x1589050, 0x1589183),
          (0x158919b, 0x1589205), (0x15b5200, 0x15b5265),
          (0x15b08e0, 0x15b0981), (0x15bfb50, 0x15bfb60),
          (0x15bf960, 0x15bf980), (0x15af2ee, 0x15af315),
          (0x1595b1b, 0x1595b31), (0x15aeda2, 0x15aedaa),
          (0x15aedcb, 0x15aeddd), (0x158522a, 0x158525e),
          (0x15bfaf0, 0x15bfb30), (0x15bf940, 0x15bf950)]
RESOURCE = {"uncompressed": {"constructor": [0x15b5200, 0x15b5265],
                            "vtable": 0x23e3a00, "getter": 0x15bfb50, "fpsGetter": 0x15bfaf0},
            "compressed": {"constructor": [0x15b08e0, 0x15b0981],
                          "vtable": 0x23e3950, "getter": 0x15bf960, "fpsGetter": 0x15bf940}}


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


class NativeAnimationClock(NativeSpawn):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("Animation clock differs from pristine client")
        self.layout = registrations(self.image, 0x15b6cd0, 0x15b6db6,
            {"mTickDuration": (0x68, 1, "float", 1/30), "startFrame": (0x88, 1, "float", 0),
             "EndFrame": (0x8c, 1, "float", -1)})
        self.call(0x15d6a70, {r.UC_X86_REG_RDI: A["definition"]})
        self.default_data = bytes(self.u.mem_read(A["definition"], 0x90))

    def prepare_header(self, raw):
        version = struct.unpack_from("<I", raw, 8)[0]
        if len(raw) < 0x80:
            raise ValueError("Truncated ANM header projection")
        if raw[:8] == b"r3d2anmd" and version in [3, 4, 5]:
            kind = "uncompressed"
        elif raw[:8] == b"r3d2canm" and version in [1, 2, 3]:
            kind = "compressed"
        else:
            return {"status": "unprepared-ANM-header-format", "magic": raw[:8].decode("ascii"), "version": version}
        header = 0x10040000
        self.u.mem_write(header, raw[:0x80])
        source = header+12
        if kind == "uncompressed" and version == 4:
            # Original V4 conversion copies the complete header, then rewrites
            # payload offsets and quaternions. Those payload operations do not
            # change the frame-count/tick fields consumed by this projection.
            source = 0x10041000
            self.call(0x15af2ee, {r.UC_X86_REG_R13: header+12, r.UC_X86_REG_R14: source}, 0x15af315)
        elif kind == "uncompressed" and version == 3:
            # Native legacy reader's four-word header copy and integer-FPS
            # conversion, followed by the converter's common-header writes.
            frame = A["stack"]-8
            legacy = 0x10042000
            self.u.mem_write(frame-0x40, raw[12:28])
            self.call(0x1595b1b, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_R14: legacy}, 0x1595b31)
            tracks, frames, fps = struct.unpack("<IIf", self.u.mem_read(legacy+0x48, 12))
            source = 0x10041000
            self.u.mem_write(source, bytes(0x40))
            self.put(source, "I", 0x40)
            self.call(0x15aeda2, {r.UC_X86_REG_RDI: source, r.UC_X86_REG_R14: frames,
                r.UC_X86_REG_R15: tracks}, 0x15aedaa)
            self.put(frame-0x80, "f", fps)
            self.call(0x15aedcb, {r.UC_X86_REG_RDI: source, r.UC_X86_REG_RBP: frame}, 0x15aeddd)
        self.u.mem_write(A["system"], bytes(0x70))
        start, end = RESOURCE[kind]["constructor"]
        self.call(start, {r.UC_X86_REG_RDI: A["system"], r.UC_X86_REG_RSI: source}, end)
        if self.q(A["system"]) != self.base+RESOURCE[kind]["vtable"]:
            raise ValueError("Unexpected loaded animation resource class")
        self.call(RESOURCE[kind]["getter"], {r.UC_X86_REG_RDI: A["system"]})
        frames = self.u.reg_read(r.UC_X86_REG_EAX)
        if not 1 <= frames <= 100000:
            raise ValueError("Invalid native ANM resource frame count")
        self.call(RESOURCE[kind]["fpsGetter"], {r.UC_X86_REG_RDI: A["system"]})
        fps = struct.unpack("<f", struct.pack("<I", self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
        return {"status": "prepared", "kind": kind, "version": version, "resourceFrames": frames,
                "resourceFps": fps,
                "resourceHex": bytes(self.u.mem_read(A["system"], 0x70)).hex()}

    def sample(self, resource, node, elapsed, delta=0, rate=1):
        if resource["status"] != "prepared":
            raise ValueError("Unprepared atomic clock resource")
        self.u.mem_write(A["system"], bytes.fromhex(resource["resourceHex"]))
        self.u.mem_write(A["definition"], self.default_data)
        self.put(A["definition"]+0x78, "Q", A["system"])
        for key in ["mTickDuration", "startFrame", "EndFrame"]:
            if key in node:
                self.put(A["definition"]+self.layout[key]["offset"], "f", node[key])
        self.u.mem_write(A["actor"], bytes(0x70))
        self.put(A["actor"]+0xc, "ff", elapsed, rate)
        self.put(A["actor"]+0x28, "QQ", A["definition"], A["manager"])
        self.call(0x1589050, {r.UC_X86_REG_RDI: A["actor"],
            r.UC_X86_REG_XMM0: int.from_bytes(struct.pack("<f", delta), "little")}, 0x1589183)
        frame = self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff
        updated = bytes(self.u.mem_read(A["actor"]+0xc, 4))
        self.call(0x158919b, {r.UC_X86_REG_RBX: A["actor"]}, 0x1589205)
        duration = self.u.reg_read(r.UC_X86_REG_XMM1) & 0xffffffff
        frame_base = A["stack"]-8
        self.call(0x158522a, {r.UC_X86_REG_R14: A["definition"], r.UC_X86_REG_RBP: frame_base,
            r.UC_X86_REG_XMM0: int.from_bytes(updated, "little")}, 0x158525e)
        pose_time = self.u.reg_read(r.UC_X86_REG_XMM1) & 0xffffffff
        pose_frame = bytes(self.u.mem_read(frame_base-0x30, 4))
        return {"frameHex": struct.pack("<I", frame).hex(), "elapsedHex": updated.hex(),
                "durationHex": struct.pack("<I", duration).hex(), "poseTimeHex": struct.pack("<I", pose_time).hex(),
                "poseFrameHex": pose_frame.hex()}
