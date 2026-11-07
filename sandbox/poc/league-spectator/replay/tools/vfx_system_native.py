"""Original parent particle-system scheduling on a selected admitted emitter.

Initial clock/position and subsequent position requests are owned inputs. Other
emitters, attachments, material/audio registration and original replay binding
are excluded explicitly. No League process or original frame schedule runs.
"""
import struct
import unicorn
from unicorn import x86_const as r

from vfx_spawn_native import ADDRESSES as A
from vfx_emitter_native import NativeEmitter, GEOMETRY as G


class NativeSystem(NativeEmitter):
    def __init__(self, package, client):
        super().__init__(package, client)
        self.substeps = []
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.capture_substep,
                        begin=self.base+0x1757f10, end=self.base+0x1757f10)

    def capture_substep(self, uc, address, size, user):
        if self.u.reg_read(r.UC_X86_REG_RDI) != A["actor"]:
            raise ValueError("Unadmitted sibling emitter")
        time = struct.unpack("<f", struct.pack("<I", self.u.reg_read(r.UC_X86_REG_XMM0) & 0xffffffff))[0]
        position = list(struct.unpack("<fff", self.u.mem_read(A["system"]+0x108, 12)))
        self.substeps.append({"time": time, "position": position})

    def reset_system(self, graph, seed, metadata, quality, created_at, position):
        emitter = self.checked_json("vfx-emitter.json", "vfxEmitterSha256")
        self.reset_emitter(graph, seed, emitter, quality)
        self.call(metadata["rootConstructorRva"], {r.UC_X86_REG_RDI: A["systemDefinition"]})
        for block in metadata["initializers"]:
            registers = {getattr(r, "UC_X86_REG_"+name):
                         A[value] if isinstance(value, str) else value for name, value in block["registers"].items()}
            if "RBP" in block["registers"]:
                registers[r.UC_X86_REG_RBP] = A["stack"]-0x100
            self.call(block["startRva"], registers, block["endRva"])
        self.u.mem_write(A["manager"]+0x284, bytes.fromhex(metadata["nativeQualityMultipliersHex"]))
        self.call(0x17567a6, {r.UC_X86_REG_RDI: A["actor"]}, 0x17567b7)
        self.put(A["system"]+0x30, "Q", A["manager"])
        self.put(A["system"]+0x40, "Q", metadata["actorListAddress"])
        self.put(A["system"]+0x48, "II", 1, 1)
        self.put(metadata["actorListAddress"], "Q", A["actor"])
        self.put(metadata["basisInputAddress"], "fff", 0, 1, 0)
        self.call(metadata["basisRva"], {r.UC_X86_REG_RDI: A["system"], r.UC_X86_REG_RSI: metadata["basisInputAddress"]})
        clock = int.from_bytes(struct.pack("<f", created_at), "little")
        self.call(0x174bbb3, {r.UC_X86_REG_RBX: A["system"], r.UC_X86_REG_XMM0: clock}, 0x174bbd5)
        self.put(metadata["positionInputAddress"], "fff", *position)
        self.call(0x174bc15, {r.UC_X86_REG_RBX: A["system"], r.UC_X86_REG_RCX: metadata["positionInputAddress"],
                             r.UC_X86_REG_RAX: A["resource"]}, 0x174bc8d)
        self.last_time = created_at

    def tick(self, value, metadata):
        time = value["time"]
        if time < self.last_time or not 1 <= value["maxSubsteps"] <= 20:
            raise ValueError("Invalid system clock or substep budget")
        self.last_time = time
        self.births.clear(); self.math_calls.clear(); self.services.clear(); self.substeps.clear()
        self.put(A["system"]+0x108, "fff", *value["current"])
        self.u.mem_write(A["stack"]-0x8000, bytes(0x8000))
        self.u.context_restore(self.initial)
        self.put(A["stack"], "Q", A["stop"])
        self.u.reg_write(r.UC_X86_REG_RSP, A["stack"])
        self.u.reg_write(r.UC_X86_REG_RDI, A["system"])
        self.u.reg_write(r.UC_X86_REG_RSI, value["maxSubsteps"])
        self.u.reg_write(r.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<f", time), "little"))
        self.u.emu_start(self.base+metadata["tickRva"], A["stop"], count=5000000)
        if self.u.reg_read(r.UC_X86_REG_RIP) != A["stop"]:
            raise ValueError("System tick instruction bound")
        state = self.snapshot()
        state["systemHex"] = bytes(self.u.mem_read(A["system"], 0x2b8)).hex()
        self.u.mem_write(G["context"], bytes(0x3000))
        for offset, pointer in [(0, G["indices"]), (8, G["vertices"]), (0x10, G["draw"]),
                                (0x18, A["actor"]), (0x20, G["view"])]:
            self.put(G["context"]+offset, "Q", pointer)
        self.put(G["view"]+0x24, "fff", *value["viewForward"])
        self.math_calls.clear()
        self.call(0x1737570, {r.UC_X86_REG_RDI: A["primitive"], r.UC_X86_REG_RSI: G["context"]})
        nv, ni = self.q(G["context"]+8)-G["vertices"], self.q(G["context"])-G["indices"]
        count = state["vectors"]["life"]["count"]
        if not (0 <= nv <= count*56 and 0 <= ni <= max(count-1, 0)*12 and nv % 28 == ni % 2 == 0):
            raise ValueError("System geometry outside owned output")
        return {"state": state, "substeps": list(self.substeps), "geometry": {
                "verticesHex": bytes(self.u.mem_read(G["vertices"], nv)).hex(),
                "indicesHex": bytes(self.u.mem_read(G["indices"], ni)).hex(),
                "drawHex": bytes(self.u.mem_read(G["draw"], 16)).hex(), "mathCalls": list(self.math_calls)}}
