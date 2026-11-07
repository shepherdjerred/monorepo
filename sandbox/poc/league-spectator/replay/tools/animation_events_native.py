"""Original animation particle-event scheduling with explicit request sinks.

The client scheduler and data/runtime constructors execute unchanged. Effect
creation, attachment, and release implementations are replaced by observable
request boundaries; no particles, sound, or actor state are simulated here.
Input values are in the scheduler's native frame domain, not replay seconds.
"""
import math
import struct

import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES as A
from vfx_uv_native import registrations


FIELDS = {
    "base": {"mStartFrame": (0xc, 1, "float", 0),
             "mEndFrame": (0x10, 1, "float", -1),
             "mFireIfAnimationEndsEarly": (9, 1, "boolean", False)},
    "particle": {"mIsLoop": (0x48, 1, "boolean", True),
                 "mIsKillEvent": (0x49, 1, "boolean", True),
                 "mIsDetachable": (0x4a, 1, "boolean", False),
                 "mScalePlaySpeedWithAnimation": (0x4b, 1, "boolean", False)},
}
BOUNDARIES = {0x1594d20: "activate-request", 0x1595510: "release-request",
              0x1594cc0: "play-speed-request"}
BLOCKS = [(0x15dc290, 0x15dc2ed), (0x15c1750, 0x15c17c5),
          (0x1589270, 0x1589e90), (0x158cff0, 0x158d600)]


def finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(struct.unpack("<f", struct.pack("<f", value))[0])
    except (OverflowError, struct.error):
        return False


def validate_specs(specs):
    if not isinstance(specs, list) or len(specs) > 1024:
        raise ValueError("Invalid animation event collection")
    ids = set()
    for event in specs:
        if not isinstance(event, dict) or set(event) - {"id", "startFrame", "endFrame", "skipExpired", "isLoop", "isKillEvent", "fireIfEarly"}:
            raise ValueError("Unknown animation scheduling field")
        if not isinstance(event.get("id"), str) or not event["id"] or event["id"] in ids:
            raise ValueError("Invalid animation event identity")
        ids.add(event["id"])
        if not all(finite(event.get(k, default)) for k, default in [("startFrame", 0), ("endFrame", -1)]):
            raise ValueError("Invalid animation frame value")
        if not all(type(event.get(k, default)) is bool for k, default in
                   [("skipExpired", False), ("isLoop", True), ("isKillEvent", True), ("fireIfEarly", False)]):
            raise ValueError("Invalid animation event flag")


class NativeAnimationEvents(NativeSpawn):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("Animation event source differs from pristine client")
        self.layout = {
            "base": registrations(self.image, 0x15bb710, 0x15bb800, FIELDS["base"]),
            "particle": registrations(self.image, 0x15bc200, 0x15bc390, FIELDS["particle"]),
        }
        self.requests = []
        self.runtime_indices = {}
        for at in BOUNDARIES:
            self.u.hook_add(unicorn.UC_HOOK_CODE, self.request, begin=self.base+at, end=self.base+at)
        self.call(0x15dc290, {r.UC_X86_REG_RDI: A["definition"]})
        self.default_data = bytes(self.u.mem_read(A["definition"], 0x58))

    def request(self, uc, address, size, user):
        runtime = self.u.reg_read(r.UC_X86_REG_RDI)
        if runtime not in self.runtime_indices:
            raise ValueError("Animation request from unowned event")
        index = self.runtime_indices[runtime]
        output = {"event": self.specs[index]["id"], "kind": BOUNDARIES[address-self.base]}
        if output["kind"] == "play-speed-request":
            output["value"] = struct.unpack("<f", struct.pack("<I", self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
        self.requests.append(output)
        self.ret()

    def reset(self, specs):
        validate_specs(specs)
        self.specs = specs
        self.requests = []
        self.runtime_indices = {}
        self.next_heap = 0x10400000
        self.allocations = {}
        self.u.mem_write(A["manager"], bytes(0x50))
        self.u.mem_write(A["context"], bytes(0x10))
        self.put(A["point"], "I", 0)
        self.runtimes = []
        for index, event in enumerate(specs):
            data = self.allocate(0x58, 0xa5)
            self.call(0x15dc290, {r.UC_X86_REG_RDI: data})
            self.put(data+0xc, "ff", event.get("startFrame", 0), event.get("endFrame", -1))
            for offset, key, default in [(9, "fireIfEarly", False), (0x48, "isLoop", True),
                (0x49, "isKillEvent", True), (0x4c, "skipExpired", False)]:
                self.put(data+offset, "B", event.get(key, default))
            self.call(0x15c1750, {r.UC_X86_REG_RDI: A["context"], r.UC_X86_REG_RSI: data,
                                  r.UC_X86_REG_RDX: A["point"]})
            runtime = self.u.reg_read(r.UC_X86_REG_RAX)
            self.runtime_indices[runtime] = index
            self.runtimes.append(runtime)
        vector = self.allocate(max(8, len(specs)*8))
        if specs:
            self.put(vector, "Q"*len(specs), *self.runtimes)
        self.put(A["manager"]+0x20, "QI", vector, len(specs))
        self.last_frame = None

    def step(self, frame, resync=False):
        if not finite(frame) or type(resync) is not bool:
            raise ValueError("Invalid animation event clock")
        frame = struct.unpack("<f", struct.pack("<f", frame))[0]
        if not resync and self.last_frame is not None and frame < self.last_frame:
            raise ValueError("Backward clock requires explicit resynchronization")
        self.requests = []
        self.call(0x1589270, {r.UC_X86_REG_RDI: A["manager"], r.UC_X86_REG_RSI: A["context"],
            r.UC_X86_REG_RDX: resync, r.UC_X86_REG_XMM0: int.from_bytes(struct.pack("<f", frame), "little")})
        self.last_frame = frame
        states = []
        for spec, runtime in zip(self.specs, self.runtimes):
            data = bytes(self.u.mem_read(runtime+0x10, 12))
            states.append({"event": spec["id"], "oneShot": bool(data[0]), "pending": bool(data[1]),
                           "active": bool(data[2]), "phase": struct.unpack_from("<I", data, 4)[0]})
        return {"requests": list(self.requests), "states": states}
