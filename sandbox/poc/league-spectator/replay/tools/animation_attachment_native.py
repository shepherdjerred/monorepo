"""Original animation effect activation, lookup and binding decisions.

Rig hash maps, resolved bone keys and pose transforms are supplied owned inputs.
Context/effect/transform factories are explicit request sinks. Native resource
loading, rig construction, pose production and particle rendering are excluded.
"""
import struct

import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES as A
from vfx_uv_native import registrations


BLOCKS = [(0x1594d20, 0x1594d80), (0x1594d80, 0x1595510),
          (0x1595510, 0x15955d0), (0x1594cc0, 0x1594d20),
          (0x157fe60, 0x1580010), (0x157f940, 0x157fb80),
          (0x15dc290, 0x15dc2ed), (0x15c1750, 0x15c17c5),
          (0x1779b60, 0x1779cbc), (0x16e7640, 0x16e7990), (0x15bc200, 0x15bc390)]
OWNED = {"rig": 0x10040000, "joints": 0x10041000, "pose": 0x10049000,
         "poses": 0x10050000, "position": 0x1002a000,
         "contextVtable": 0x10030000, "rawVtable": 0x10030100,
         "wrapperVtable": 0x10030200, "callbackBase": 0x10032000}
CALLBACKS = {
    "owner": 0, "position": 1, "create": 2, "retain": 3,
    "detached": 4, "bone": 5, "afterimage": 6,
    "scalar": 7, "playSpeed": 8, "source": 9, "target": 10, "ownerBinding": 11,
    "definition": 12, "stop": 13, "release": 14, "speedUpdate": 15,
}


class NativeAnimationAttachment(NativeSpawn):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("Animation attachment code differs from pristine client")
        self.call(0x14aa3bf, {}, 0x14aa516)
        self.call(0x1779b60, {r.UC_X86_REG_RDI: A["systemDefinition"]})
        self.default_system = bytes(self.u.mem_read(A["systemDefinition"], 0x160))
        self.layout = {"system": registrations(self.image, 0x16e7640, 0x16e7990,
                {"mIsPoseAfterimage": (0xc7, 1, "boolean", False)}),
            "event": registrations(self.image, 0x15bc200, 0x15bc390,
                {"mIsDetachable": (0x4a, 1, "boolean", False),
                 "mScalePlaySpeedWithAnimation": (0x4b, 1, "boolean", False)})}
        if self.default_system[0xc7] != 0:
            raise ValueError("Native pose-afterimage default changed")
        for name, index in CALLBACKS.items():
            address = OWNED["callbackBase"]+index*16
            self.u.mem_write(address, b"\xc3")
            self.u.hook_add(unicorn.UC_HOOK_CODE, self.callback, begin=address, end=address)
        for key, slots in {
            "contextVtable": {0: "owner", 0x40: "position", 0x68: "create", 0x70: "retain",
                0x78: "detached", 0x80: "bone", 0x88: "afterimage"},
            "rawVtable": {0: "scalar", 8: "playSpeed", 0x10: "source", 0x18: "target",
                0x20: "ownerBinding", 0x38: "definition"},
            "wrapperVtable": {8: "release", 0x10: "stop", 0x28: "speedUpdate"},
        }.items():
            self.u.mem_write(OWNED[key], bytes(0x100))
            for offset, name in slots.items():
                self.put(OWNED[key]+offset, "Q", OWNED["callbackBase"]+CALLBACKS[name]*16)

    def callback(self, uc, address, size, user):
        index = (address-OWNED["callbackBase"])//16
        name = next(k for k, value in CALLBACKS.items() if value == index)
        di, si, dx, cx, r8 = [self.u.reg_read(getattr(r, "UC_X86_REG_"+reg))
                              for reg in ["RDI", "RSI", "RDX", "RCX", "R8"]]
        scalar = lambda: struct.unpack("<f", struct.pack("<I", self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
        result = None
        if name == "owner":
            result = A["actor"]
        elif name == "position":
            result = OWNED["position"]
        elif name == "create":
            effect = len(self.handles)
            self.requests.append({"kind": "create-effect-request", "effect": effect,
                "effectKey": struct.unpack("<I", self.u.mem_read(si, 4))[0],
                "secondaryKey": struct.unpack("<I", self.u.mem_read(dx, 4))[0],
                "positionHex": bytes(self.u.mem_read(r8, 12)).hex(), "created": self.create_succeeds})
            if self.create_succeeds:
                result = self.allocate(8)
                self.put(result, "Q", OWNED["rawVtable"])
                self.handles[result] = effect
            else:
                result = 0
        elif name in ["detached", "bone", "afterimage"]:
            descriptor = {"kind": name}
            if name == "bone":
                descriptor["resolvedBoneKey"] = dx & 0xffffffff
            elif name == "detached":
                descriptor.update({"positionHex": bytes(self.u.mem_read(dx, 12)).hex(),
                    "matrixHex": bytes(self.u.mem_read(cx, 64)).hex()})
            proxy = self.allocate(8)
            self.proxies[proxy] = descriptor
            self.put(di, "QQ", proxy, 0)
            result = di
        elif name == "retain":
            effect = self.handles[dx]
            wrapper = self.allocate(8)
            self.put(wrapper, "Q", OWNED["wrapperVtable"])
            self.wrappers[wrapper] = effect
            self.put(di, "QQ", wrapper, 0)
            self.requests.append({"kind": "retain-effect-request", "effect": effect})
            result = di
        elif name == "definition":
            if di not in self.handles:
                raise ValueError("Unowned effect definition request")
            result = A["systemDefinition"]
        elif name in ["scalar", "playSpeed"]:
            self.requests.append({"kind": name+"-request", "effect": self.handles[di], "value": scalar()})
        elif name in ["source", "target"]:
            descriptor = self.proxies[self.q(si)]
            self.requests.append({"kind": name+"-binding-request", "effect": self.handles[di], "binding": descriptor})
        elif name == "ownerBinding":
            if si != A["actor"]:
                raise ValueError("Unowned owner-binding request")
            self.requests.append({"kind": "owner-binding-request", "effect": self.handles[di]})
        elif name in ["stop", "release", "speedUpdate"]:
            request = {"kind": name+"-request", "effect": self.wrappers[di]}
            if name == "speedUpdate":
                request["value"] = scalar()
            self.requests.append(request)
        else:
            raise ValueError("Unknown animation attachment boundary")
        if result is not None:
            self.u.reg_write(r.UC_X86_REG_RAX, result)
        self.ret()

    def reset(self, value):
        if value.get("scalePlaySpeed", False):
            raise ValueError("Animation speed-context lookup is not admitted")
        joints = value["joints"]
        if len(joints) > 256 or len({j["hash"] for j in joints}) != len(joints):
            raise ValueError("Invalid supplied rig hash table")
        self.next_heap = 0x10400000
        self.allocations = {}
        self.requests, self.handles, self.wrappers, self.proxies = [], {}, {}, {}
        self.create_succeeds = value.get("createSucceeds", True)
        for address, size in [(A["actor"], 0x200), (A["context"], 0x10),
                (OWNED["rig"], 0x100), (OWNED["pose"], 0x120)]:
            self.u.mem_write(address, bytes(size))
        self.u.mem_write(A["systemDefinition"], self.default_system)
        self.put(A["systemDefinition"]+0xc7, "B", value.get("poseAfterimage", False))
        self.put(A["actor"]+0x29, "B", value.get("suppressed", False))
        self.put(A["actor"]+0x38, "Q", OWNED["rig"])
        self.put(A["actor"]+0xd0, "Q", OWNED["pose"])
        self.put(OWNED["pose"]+0x70, "Q", OWNED["rig"])
        self.put(OWNED["pose"]+8, "QI", OWNED["poses"], len(joints))
        self.put(OWNED["rig"]+0x28, "Q", OWNED["joints"])
        self.u.mem_write(OWNED["position"], bytes.fromhex(value["ownerPositionHex"]))
        bucket, sentinel = self.allocate(8), self.allocate(8)
        self.put(bucket, "Q", sentinel)
        self.put(OWNED["rig"]+0x48, "QQ", bucket, 1)
        nodes = [self.allocate(0x18) for _ in joints]
        self.put(sentinel, "Q", nodes[0] if nodes else 0)
        for i, (joint, node) in enumerate(zip(joints, nodes)):
            self.put(node, "QQIh", nodes[i+1] if i+1<len(nodes) else 0, joint["hash"], joint["hash"], i)
            self.u.mem_write(OWNED["joints"]+i*0x70, bytes(0x70))
            self.put(OWNED["joints"]+i*0x70, "H", i)
            self.put(OWNED["joints"]+i*0x70+4, "I", joint["resolvedBoneKey"])
            pose = bytes.fromhex(joint["transformHex"])
            if len(pose) != 40:
                raise ValueError("Supplied pose is not a native 40-byte transform")
            self.u.mem_write(OWNED["poses"]+i*40, pose)
        self.call(0x15dc290, {r.UC_X86_REG_RDI: A["definition"]})
        self.put(A["definition"]+0x18, "II", value["effectKey"], value.get("secondaryKey", 0))
        self.put(A["definition"]+0x4a, "B", value.get("detachable", False))
        self.put(A["definition"]+0x50, "f", value.get("effectScalar", 1))
        pairs = self.allocate(max(8, len(value["pairs"])*8))
        for i, pair in enumerate(value["pairs"]):
            self.put(pairs+i*8, "II", pair[0], pair[1])
        self.put(A["definition"]+0x30, "QI", pairs, len(value["pairs"]))
        self.put(A["context"], "Q", OWNED["contextVtable"])
        self.put(A["link"]+8, "Q", A["context"])
        self.put(A["point"], "I", 0)
        self.call(0x15c1750, {r.UC_X86_REG_RDI: A["link"], r.UC_X86_REG_RSI: A["definition"],
            r.UC_X86_REG_RDX: A["point"]})
        self.runtime = self.u.reg_read(r.UC_X86_REG_RAX)

    def activate(self):
        self.requests = []
        self.call(0x1594d20, {r.UC_X86_REG_RDI: self.runtime})
        return {"requests": list(self.requests), "retained": struct.unpack("<I", self.u.mem_read(self.runtime+0x30, 4))[0]}

    def cleanup(self):
        self.requests = []
        self.call(0x1595510, {r.UC_X86_REG_RDI: self.runtime})
        return {"requests": list(self.requests), "retained": struct.unpack("<I", self.u.mem_read(self.runtime+0x30, 4))[0]}
