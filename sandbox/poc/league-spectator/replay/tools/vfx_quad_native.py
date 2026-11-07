"""Original arbitrary-quad writer on explicit particle/presentation buffers."""
import math
import struct

from unicorn import x86_const as r
from vfx_emitter_native import NativeEmitter
from vfx_spawn_native import ADDRESSES as A


Q = {"definition": 0x10020000, "link": 0x10021000, "actor": 0x10022000,
     "system": 0x10023000, "pool": 0x10024000, "context": 0x10025000,
     "view": 0x10026000, "draw": 0x10027000, "primitive": 0x10028000,
     "particles": 0x10040000, "attributes": 0x10080000, "baseMatrices": 0x10090000,
     "multMatrices": 0x100a0000, "vertices": 0x10100000, "indices": 0x10140000}
BLOCKS = [(0x1730410, 0x1730b33), (0x1730b40, 0x1730f20), (0x1731a50, 0x1731c70),
          (0x1731fb0, 0x17322c0), (0x148f090, 0x148f0eb)]


class NativeQuad(NativeEmitter):
    def __init__(self, package, client):
        super().__init__(package, client)
        self.trails = self.checked_json("vfx-trails.json", "vfxTrailsSha256")
        for start, end in BLOCKS:
            if self.image[start:end] != self.source.image[start:end]:
                raise ValueError("Quad writer differs from pristine client")
        self.call(0x16ffef0, {r.UC_X86_REG_RDI: Q["definition"]})
        self.default_definition = bytes(self.u.mem_read(Q["definition"], 0x470))
        for field in self.trails["initializedGlobals"]:
            self.u.mem_write(self.base+field["rva"], bytes.fromhex(field["bytesHex"]))

    def render(self, value):
        particles, fmt = value["particles"], value["vertexFormat"]
        count, stride = len(particles), 40 if fmt == 1 else 28
        if fmt not in [0, 1] or count > 1024 or not 0 <= value["baseVertex"] <= 65535-4*count:
            raise ValueError("Quad output bound")
        for matrix in ["baseUV", "multUV"]:
            if len({p[matrix] is None for p in particles}) > 1:
                raise ValueError("Mixed per-emitter UV record presence")
        self.math_calls.clear(); self.services.clear()
        self.u.mem_write(Q["definition"], self.default_definition)
        for name, size in [("link", 0xf0), ("actor", 0x128), ("system", 0x2b8), ("pool", 0xf0),
                           ("context", 0x30), ("view", 0x30), ("draw", 0x10)]:
            self.u.mem_write(Q[name], bytes(size))
        self.put(Q["definition"]+0x14, "B", value["blend"])
        self.put(Q["definition"]+0xe0, "ffff", *value["modulation"])
        flags = struct.unpack("<I", self.u.mem_read(Q["definition"]+0x2d0, 4))[0]
        self.put(Q["definition"]+0x2d0, "I", flags | 8 if value["uniformScale"] else flags & ~8)
        for offset, key in [(0x330, "directionScale"), (0x334, "directionMinScale"), (0x338, "projectionScroll")]:
            self.put(Q["definition"]+offset, "f", value[key])
        self.put(Q["definition"]+0xc8, "B", 0)
        self.put(Q["link"]+0x10, "Q", Q["definition"])
        self.put(Q["link"]+0x58, "Q", Q["primitive"] if value["multBound"] else 0)
        for offset, name in [(0xe8, "baseUV"), (0xe9, "multUV")]:
            self.put(Q["link"]+offset, "B", bool(particles and particles[0][name] is not None))
        for offset, name in [(0, "system"), (8, "link"), (0xa0, "pool")]:
            self.put(Q["actor"]+offset, "Q", Q[name])
        self.put(Q["actor"]+0x28, "ff", *value["actorUvOffset"])
        self.put(Q["system"]+0x150, "ff", *value["systemScale"])
        self.put(Q["pool"]+0x10, "I", count)
        for offset, name in [(0x38, "particles"), (0x98, "attributes"), (0x78, "baseMatrices"), (0x88, "multMatrices")]:
            self.put(Q["pool"]+offset, "Q", Q[name])
        for offset, name in [(0, "indices"), (8, "vertices"), (0x10, "draw"), (0x18, "actor"), (0x20, "view")]:
            self.put(Q["context"]+offset, "Q", Q[name])
        self.put(Q["context"]+0x28, "B", fmt)
        self.put(Q["draw"], "H", value["baseVertex"])
        self.put(Q["view"], "fff", *value["viewPosition"])
        for index, particle in enumerate(particles):
            at, attr = Q["particles"]+index*0xac, Q["attributes"]+index*0x2c
            self.u.mem_write(at, bytes(0xac)); self.u.mem_write(attr, bytes(0x2c))
            for offset, name in [(0x50, "basisX"), (0x60, "basisY"), (0x70, "basisZ"), (0x80, "position"), (0x90, "direction")]:
                self.put(at+offset, "fff", *particle[name])
            self.put(attr, "f", particle["frame"])
            self.put(attr+4, "ffff", *particle["color"])
            self.put(attr+0x14, "ff", *particle["size"])
            self.put(attr+0x20, "ff", *particle["uvOffset"])
            self.put(attr+0x28, "f", particle["aux"])
            for group, matrix in [("baseMatrices", "baseUV"), ("multMatrices", "multUV")]:
                if particle[matrix] is not None:
                    self.put(Q[group]+index*0x18, "ffffff", *particle[matrix])
        self.u.mem_write(Q["vertices"], bytes([0xa5])*(count*4*stride))
        self.u.mem_write(Q["indices"], bytes([0xa5])*(count*12))
        self.call(0x1730410, {r.UC_X86_REG_RDI: Q["primitive"], r.UC_X86_REG_RSI: Q["context"]})
        nv, ni = self.q(Q["context"]+8)-Q["vertices"], self.q(Q["context"])-Q["indices"]
        if nv != count*4*stride or ni != count*12 or self.services:
            raise ValueError(f"Quad output/service mismatch: {nv}, {ni}, {self.services}")
        return {"verticesHex": bytes(self.u.mem_read(Q["vertices"], nv)).hex(),
                "indicesHex": bytes(self.u.mem_read(Q["indices"], ni)).hex(),
                "drawHex": bytes(self.u.mem_read(Q["draw"], 16)).hex(), "mathCalls": list(self.math_calls)}


def particle(**overrides):
    return {"position": [0, 0, 0], "basisX": [1, 0, 0], "basisY": [0, 1, 0], "basisZ": [0, 0, 1],
            "direction": [3, 4, 0], "color": [1, .5, .25, .75], "size": [2, 3], "frame": 0,
            "aux": 0, "uvOffset": [0, 0], "baseUV": None, "multUV": None, **overrides}


def controlled():
    def state(items, **changes):
        return {"particles": items, "vertexFormat": 0, "baseVertex": 0, "blend": 1,
                "modulation": [1, 1, 1, 1], "uniformScale": False, "systemScale": [1, 1],
                "actorUvOffset": [0, 0], "directionScale": 0, "directionMinScale": 0,
                "projectionScroll": 0, "viewPosition": [0, 0, 0], "multBound": False, **changes}
    for fmt in [0, 1]:
        for count in [0, 1, 2, 7, 64, 1024]:
            items = [particle(position=[index*.3, 5, index*-.25], color=[.2, .4, .8, .6]) for index in range(count)]
            yield f"format{fmt}/count{count}", state(items, vertexFormat=fmt)
        for blend in [0, 1, 2, 4]:
            for uniform in [False, True]:
                for uv in ["none", "base", "mult", "both"]:
                    value = particle(position=[5000, 50, 6000], size=[1.5, 2.5], uvOffset=[.2, -.3], aux=.7)
                    if uv in ["base", "both"]:
                        value["baseUV"] = [0, -1, 1, 0, .25, -.5]
                    if uv in ["mult", "both"]:
                        value["multUV"] = [2, .25, -.5, .75, .4, -.2]
                    yield f"format{fmt}/blend{blend}/uniform{uniform}/uv{uv}", state([value], vertexFormat=fmt,
                        blend=blend, uniformScale=uniform, multBound=uv in ["mult", "both"], baseVertex=12,
                        modulation=[.8, .7, .6, .5], systemScale=[1.25, .5], actorUvOffset=[-.1, .2])
        for projection in [0, .125, -.2]:
            for direction in [0, .25, 1]:
                value = particle(position=[3.5, 5.25, -2.75], basisX=[0, 0, 1], basisY=[0, 1, 0], basisZ=[-1, 0, 0])
                yield f"format{fmt}/projection{projection}/direction{direction}", state([value], vertexFormat=fmt,
                    projectionScroll=projection, directionScale=direction, directionMinScale=.1, viewPosition=[.5, 1.25, -.75])
