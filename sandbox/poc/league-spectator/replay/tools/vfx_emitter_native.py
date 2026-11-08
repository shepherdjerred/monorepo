"""Whole native emitter frames and native trail geometry on controlled system inputs."""
import ctypes
import math
import struct

from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, ADDRESSES as A, VECTORS


GEOMETRY = {"context": 0x10030000, "view": 0x10031000, "draw": 0x10032000,
            "indices": 0x10040000, "vertices": 0x10080000}


class NativeEmitter(NativeSpawn):
    def imported(self, uc, address, size, user):
        name = self.source.imports[address-self.base]
        if name not in ["_expf", "_modff"]:
            return super().imported(uc, address, size, user)
        x = struct.unpack("<f", struct.pack("<I", self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
        extra = {}
        if name == "_modff":
            fn = self.crt.modff
            fn.argtypes = [ctypes.c_float, ctypes.POINTER(ctypes.c_float)]; fn.restype = ctypes.c_float
            integer = ctypes.c_float()
            result = fn(x, ctypes.byref(integer))
            target = self.u.reg_read(r.UC_X86_REG_RDI)
            if not A["stack"]-0x8000 <= target <= A["stack"]-4:
                raise ValueError("Emitter modf output outside owned stack")
            self.put(target, "f", integer.value); extra["integer"] = integer.value
        else:
            fn = self.crt.expf; fn.argtypes = [ctypes.c_float]; fn.restype = ctypes.c_float
            result = fn(x)
        self.u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<f", result), "little"))
        self.math_calls.append({"name": name, "x": x, **extra, "result": [result]})
        self.ret()

    def reset_emitter(self, graph, seed, metadata, quality):
        self.reset(graph, seed)
        self.put(A["system"]+0x1c8, "f", 1)
        importance = self.u.mem_read(A["definition"]+0x17, 1)[0]
        if importance >= 6 or quality not in [0, 1, 2, 3]:
            raise ValueError("Unsupported emitter quality input")
        self.put(A["manager"]+0x284, "f"*6, *([1]*6))
        self.put(A["manager"]+0x29c, "I", quality)
        self.put(A["link"]+8, "Q", A["resource"])
        self.call(0x14896f0, {r.UC_X86_REG_RDI: A["systemDefinition"]+0x100})
        for value in metadata["initializedGlobals"]:
            self.u.mem_write(self.base+value["rva"], bytes.fromhex(value["bytesHex"]))
        self.last_time = -math.inf

    def snapshot(self):
        pool = self.q(A["actor"]+0xa0)
        vectors = {}
        for name, (offset, stride) in VECTORS.items():
            pointer = self.q(pool+offset)
            count = struct.unpack("<I", self.u.mem_read(pool+offset+8, 4))[0]
            if count > 1024 or pointer and not 0x10400000 <= pointer <= self.next_heap-count*stride:
                raise ValueError("Emitter pool output outside owned buffers")
            vectors[name] = {"count": count, "hex": bytes(self.u.mem_read(pointer, count*stride)).hex() if count else ""}
        return {"births": list(self.births), "vectors": vectors,
                "rngHex": bytes(self.u.mem_read(A["stream"]+8, 12)).hex(),
                "actorHex": bytes(self.u.mem_read(A["actor"], 0x128)).hex(),
                "poolHex": bytes(self.u.mem_read(pool, 0xf0)).hex(), "services": dict(self.services), "mathCalls": list(self.math_calls)}

    def frame(self, value):
        time = value["time"]
        if not self.last_time <= time <= 30 or time < 0:
            raise ValueError("Emitter clock must advance monotonically after reset")
        self.last_time = time
        self.births.clear(); self.math_calls.clear(); self.services.clear()
        self.put(A["system"]+0xfc, "fff", *value["previous"])
        self.put(A["system"]+0x108, "fff", *value["current"])
        self.u.mem_write(A["stack"]-0x8000, bytes(0x8000))
        self.u.context_restore(self.initial)
        self.put(A["stack"], "Q", A["stop"])
        self.u.reg_write(r.UC_X86_REG_RSP, A["stack"])
        self.u.reg_write(r.UC_X86_REG_RDI, A["actor"])
        self.u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<f", time), "little"))
        self.u.emu_start(self.base+0x1757f10, A["stop"], count=5000000)
        if self.u.reg_read(r.UC_X86_REG_RIP) != A["stop"]:
            raise ValueError("Emitter frame instruction bound")
        state = self.snapshot()
        self.u.mem_write(GEOMETRY["context"], bytes(0x3000))
        for offset, pointer in [(0, GEOMETRY["indices"]), (8, GEOMETRY["vertices"]), (0x10, GEOMETRY["draw"]),
                                (0x18, A["actor"]), (0x20, GEOMETRY["view"])]:
            self.put(GEOMETRY["context"]+offset, "Q", pointer)
        self.put(GEOMETRY["view"]+0x24, "fff", *value["viewForward"])
        self.math_calls.clear()
        self.call(0x1737570, {r.UC_X86_REG_RDI: A["primitive"], r.UC_X86_REG_RSI: GEOMETRY["context"]})
        nv, ni = self.q(GEOMETRY["context"]+8)-GEOMETRY["vertices"], self.q(GEOMETRY["context"])-GEOMETRY["indices"]
        count = state["vectors"]["life"]["count"]
        if not (0 <= nv <= count*56 and 0 <= ni <= max(count-1, 0)*12 and nv % 28 == ni % 2 == 0):
            raise ValueError("Emitter geometry outside owned output")
        return {"state": state, "geometry": {"verticesHex": bytes(self.u.mem_read(GEOMETRY["vertices"], nv)).hex(),
                "indicesHex": bytes(self.u.mem_read(GEOMETRY["indices"], ni)).hex(),
                "drawHex": bytes(self.u.mem_read(GEOMETRY["draw"], 16)).hex(), "mathCalls": list(self.math_calls)}}
