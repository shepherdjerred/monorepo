"""Original SKL rig construction and both bone-name lookup namespaces."""
import math
import struct

from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES as A


RIG = 0x10040000
RAW = 0x10060000
POSE = 0x10050000
POSES = 0x10080000
OUTPUT = 0x10051000
BLOCKS = [(0x15b3cc0, 0x15b4130), (0x15b4130, 0x15b4330),
          (0x15b4330, 0x15b4750), (0x14be1d0, 0x14be1e0),
          (0x144b4e0, 0x144b580), (0x157fe60, 0x1580010),
          (0x157f940, 0x157fb80), (0x157f5d0, 0x157f7f0)]


def next_prime(value):
    if type(value) is not int or not 0 <= value <= 65536:
        raise ValueError("Unadmitted libc++ next-prime input")
    if value == 0:
        return 0
    result = max(value, 2)
    while any(result % divisor == 0 for divisor in range(2, math.isqrt(result)+1)):
        result += 1
    return result


class NativeAnimationRig(NativeSpawn):
    def __init__(self, package, client):
        super().__init__(package, client)
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("Rig source differs from pristine client")
        if self.source.imports[0x1fee34e] != "__ZNSt3__112__next_primeEm":
            raise ValueError("Unexpected rig standard-library binding")
        self.prime_calls = []

    def imported(self, uc, address, size, user):
        if self.source.imports[address-self.base] == "__ZNSt3__112__next_primeEm":
            value = self.u.reg_read(r.UC_X86_REG_RDI)
            result = next_prime(value)
            self.prime_calls.append({"input": value, "output": result})
            self.u.reg_write(r.UC_X86_REG_RAX, result)
            self.ret()
        else:
            super().imported(uc, address, size, user)

    def prepare(self, raw, expected_names):
        if not 0x40 <= len(raw) <= 0x20000:
            raise ValueError("Rig resource outside owned bounds")
        size, token, version = struct.unpack_from("<III", raw)
        count = struct.unpack_from("<H", raw, 14)[0]
        if size != len(raw) or token != 0x22fd4fc3 or version != 0 or count != len(expected_names) or count > 4096:
            raise ValueError("Unprepared rig resource header/catalog")
        self.next_heap, self.allocations = 0x10400000, {}
        self.u.mem_write(RAW, raw)
        self.put(A["link"]+8, "Q", RAW)
        self.call(0x15b3cc0, {r.UC_X86_REG_RDI: RIG, r.UC_X86_REG_RSI: A["link"]})
        rows = self.q(RIG+0x28)
        actual_count = struct.unpack("<I", self.u.mem_read(RIG+0x30, 4))[0]
        if actual_count != count:
            raise ValueError("Native rig constructor joint count mismatch")
        result = []
        for index, expected in enumerate(expected_names):
            at = rows+index*0x70
            pose_index, flags, key = struct.unpack("<HHI", self.u.mem_read(at, 8))
            string, length = struct.unpack("<QI", self.u.mem_read(at+8, 12))
            if not 0 < length < 1024:
                raise ValueError("Invalid constructed rig joint name")
            name = bytes(self.u.mem_read(string, length)).decode("ascii")
            if name != expected or pose_index >= 4096:
                raise ValueError("Constructed rig/catalog identity mismatch")
            self.call(0x14be1d0, {r.UC_X86_REG_RDI: string, r.UC_X86_REG_RSI: length})
            fnv = self.u.reg_read(r.UC_X86_REG_EAX)
            parent = struct.unpack("<h", self.u.mem_read(at+0x1c, 2))[0]
            result.append({"name": name, "poseJointIndex": index, "nativePoseIndex": pose_index,
                "rigId": pose_index, "parentId": parent, "fnvHash": fnv, "resolvedBoneKey": key})
        self.u.mem_write(A["actor"], bytes(0x200))
        self.u.mem_write(POSE, bytes(0x120))
        self.put(A["actor"]+0x38, "Q", RIG)
        self.put(A["actor"]+0xd0, "Q", POSE)
        pose_count = max((j["nativePoseIndex"] for j in result), default=-1)+1
        self.put(POSE+8, "QI", POSES, pose_count)
        self.put(POSE+0x70, "Q", RIG)
        for index in range(pose_count):
            self.put(POSES+index*40, "10f", index+.125, index*2+.25, -index-.5, 0,0,0,1,1,1,1)
        queries = []
        for joint in {j["fnvHash"]: j for j in result}.values():
            self.call(0x157fe60, {r.UC_X86_REG_RDI: A["actor"], r.UC_X86_REG_RSI: joint["fnvHash"]})
            resolved = self.u.reg_read(r.UC_X86_REG_EAX)
            outputs = []
            for entry, key in [(0x157f940, joint["fnvHash"]), (0x157f5d0, resolved)]:
                self.u.mem_write(OUTPUT, bytes([0xa5])*40)
                self.call(entry, {r.UC_X86_REG_RDI: POSE, r.UC_X86_REG_RSI: key, r.UC_X86_REG_RDX: OUTPUT})
                outputs.append({"found": bool(self.u.reg_read(r.UC_X86_REG_AL)),
                    "transformHex": bytes(self.u.mem_read(OUTPUT, 40)).hex()})
            selected = []
            for output in outputs:
                if not output["found"]:
                    raise ValueError("Constructed rig key cannot locate supplied pose")
                pose_index = struct.unpack("<f", bytes.fromhex(output["transformHex"])[:4])[0]-.125
                if pose_index != int(pose_index) or not 0 <= pose_index < pose_count:
                    raise ValueError("Native lookup returns an unknown supplied pose")
                expected = bytes(self.u.mem_read(POSES+int(pose_index)*40, 40)).hex()
                if output["transformHex"] != expected:
                    raise ValueError("Native lookup corrupts supplied pose bytes")
                selected.append(int(pose_index))
            source_joint = next(j for j in result if j["nativePoseIndex"] == selected[0])
            if resolved != source_joint["resolvedBoneKey"]:
                raise ValueError("Constructed FNV lookup key differs from selected joint")
            queries.append({"fnvHash": joint["fnvHash"], "resolvedBoneKey": resolved,
                "nativePoseIndex": selected[0], "keyPoseIndex": selected[1],
                "poseJointIndex": source_joint["poseJointIndex"], "name": source_joint["name"],
                "sourceJointIndices": [j["poseJointIndex"] for j in result if j["fnvHash"] == joint["fnvHash"]],
                "outputs": outputs})
        return {"joints": result, "queries": queries,
            "rigHeaderHex": bytes(self.u.mem_read(RIG, 0x98)).hex(),
            "primaryBuckets": self.q(RIG+0x50), "secondaryBuckets": self.q(RIG+0x78),
            "arenaSha256": __import__("hashlib").sha256(bytes(self.u.mem_read(0x10400000, self.next_heap-0x10400000))).hexdigest()}
