"""Trace original mode1 joins in an unchanged full-writer input fixture.

External modff/atan2f/fmodf use the Windows CRT; original macOS libm equivalence
is not established. No League process, renderer or match birth/pool runs.
"""
import argparse
import ctypes
import hashlib
import itertools
import json
import math
from pathlib import Path
import struct
import unicorn
from unicorn import x86_const as reg
from macho import MachImage


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    definition_bytes = (args.package / "vfx-trails.json").read_bytes()
    definition = json.loads(definition_bytes)
    source = MachImage(args.client.read_bytes())
    if (sha(image) != profile["decoderImageSha256"] or sha(definition_bytes) != profile["vfxTrailsSha256"]
        or sha(source.binary) != definition["sliceSha256"] or definition["decoderImageSha256"] != sha(image)):
        raise ValueError("Trail oracle source mismatch")
    base, owned = profile["imageBase"], 0x10000000
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image)); engine.mem_write(base, image)
    engine.mem_map(owned, 0x400000); engine.mem_map(0x20000000, 0x200000)
    stop, stack = owned + 0x9000, 0x201ff008
    a = {name: owned + offset for name, offset in {"context": 0x20000, "definition": 0x21000, "link": 0x22000,
         "actor": 0x23000, "pool": 0x24000, "system": 0x25000, "view": 0x26000, "primitive": 0x27000,
         "manager": 0x28000, "draw": 0x29000, "particles": 0x40000, "attributes": 0x100000,
         "tiling": 0x140000, "odometer": 0x150000, "indices": 0x160000, "vertices": 0x180000}.items()}
    put = lambda at, fmt, *values: engine.mem_write(at, struct.pack("<" + fmt, *values))
    for initializer in definition["initializedGlobals"]:
        engine.mem_write(base + initializer["rva"], bytes.fromhex(initializer["bytesHex"]))
    put(base + definition["managerPointerRva"], "Q", a["manager"])
    crt = ctypes.CDLL("ucrtbase.dll")
    for name in ["atan2f", "fmodf"]:
        fn = getattr(crt, name); fn.argtypes = [ctypes.c_float, ctypes.c_float]; fn.restype = ctypes.c_float
    crt.modff.argtypes = [ctypes.c_float, ctypes.POINTER(ctypes.c_float)]; crt.modff.restype = ctypes.c_float
    math_entries = {base + rva: name for name, rva in definition["mathImports"].items()}
    math_calls, blocks = [], {}
    initial = engine.context_save()
    joins = []
    def join_trace(uc, address, size, user):
        at = address-base; frame = uc.reg_read(reg.UC_X86_REG_RBP)
        vector = lambda offset: list(struct.unpack('<fff', bytes(uc.mem_read(frame+offset,12))))
        value = lambda offset: struct.unpack('<f',bytes(uc.mem_read(frame+offset,4)))[0]
        if at == 0x17380df:
            joins.append({'previousOffset':vector(-0x50),'currentOffset':vector(-0x38),
                'width':scalar(reg.UC_X86_REG_XMM9),'previousWidth':value(-0x9c),
                'segmentLength':value(-0xac),'first':bool(uc.reg_read(reg.UC_X86_REG_R13)&255),
                'enteredCorrection':False})
        elif at == 0x17381b8: joins[-1]['enteredCorrection']=True
        elif at == 0x17381c5: joins[-1]['angleRadians']=scalar(reg.UC_X86_REG_XMM0)
        elif at == 0x1738377: joins[-1]['axis']=vector(-0x148)
        elif at == 0x1738393: joins[-1]['rotationDegrees']=scalar(reg.UC_X86_REG_XMM0)
        elif at == 0x1738398: joins[-1]['sin']=scalar(reg.UC_X86_REG_XMM0)
        elif at == 0x17383aa: joins[-1]['cos']=scalar(reg.UC_X86_REG_XMM0)
        elif at == 0x1738408: joins[-1]['offsetHex']=bytes(uc.mem_read(frame-0x38,12)).hex()
    for at in [0x17380df,0x17381b8,0x17381c5,0x1738377,0x1738393,0x1738398,0x17383aa,0x1738408]:
        engine.hook_add(unicorn.UC_HOOK_CODE,join_trace,begin=base+at,end=base+at)

    def scalar(register):
        return struct.unpack("<f", struct.pack("<I", engine.reg_read(register) & 0xffffffff))[0]

    def external_math(uc, address, size, user):
        name = math_entries[address]
        x, y = scalar(reg.UC_X86_REG_XMM0), scalar(reg.UC_X86_REG_XMM1)
        if name == "modff":
            integer = ctypes.c_float()
            result = crt.modff(x, ctypes.byref(integer))
            pointer = engine.reg_read(reg.UC_X86_REG_RDI)
            if not 0x20000000 <= pointer < 0x201ffffc:
                raise ValueError("Trail modf write outside owned stack")
            put(pointer, "f", integer.value)
        else:
            result = getattr(crt, name)(x, y)
        engine.reg_write(reg.UC_X86_REG_XMM0, int.from_bytes(struct.pack("<f", result), "little"))
        math_calls.append({"name": name, "a": x, "b": y, "result": result})
        sp = engine.reg_read(reg.UC_X86_REG_RSP)
        target = struct.unpack("<Q", bytes(engine.mem_read(sp, 8)))[0]
        engine.reg_write(reg.UC_X86_REG_RSP, sp + 8); engine.reg_write(reg.UC_X86_REG_RIP, target)

    def reject(uc, address, size, user):
        raise ValueError(f"Trail entered unadmitted modeled service {address-base:x}")

    for patch in profile["modeledServices"]:
        if base + patch["rva"] in math_entries:
            continue
        engine.hook_add(unicorn.UC_HOOK_CODE, reject, begin=base + patch["rva"],
                        end=base + patch["rva"] + len(bytes.fromhex(patch["bytesHex"])) - 1)
    for address in math_entries:
        engine.hook_add(unicorn.UC_HOOK_CODE, external_math, begin=address, end=address)

    def check_block(uc, address, size, user):
        if address in math_entries:
            return
        at = address - base
        if not 0 <= at < len(image) or image[at:at+size] != source.image[at:at+size]:
            raise ValueError(f"Executed trail block differs from pristine client: {at:x}")
        blocks[at] = {"rva": at, "size": size, "sha256": sha(image[at:at+size])}

    engine.hook_add(unicorn.UC_HOOK_BLOCK, check_block, begin=base, end=base+len(image)-1)
    f = lambda x: struct.unpack("<f", struct.pack("<f", x))[0]

    def make_input(count, shape, mode, smoothing, quality, camera, cutoff):
        points = []
        for index in range(count):
            t = index / max(count-1, 1)
            if shape == "straight": p = [0, 0, t*120]
            elif shape == "bend": p = [t*120, 0, max(t-.5, 0)*120]
            elif shape == "curve": p = [math.sin(t*2.5)*80, t*12, math.cos(t*2.5)*80]
            else: p = [0, 0, 0] if index % 3 else [t*80, t*3, t*40]
            points.append([f(x) for x in p])
        particles = bytearray(count*0xac); attributes = bytearray(count*0x2c)
        tiling = bytearray(count*8); odometer = bytearray(count*4)
        distance = 0
        for index, point in enumerate(points):
            if index: distance = f(distance + math.dist(points[index-1], point))
            struct.pack_into("<fff", particles, index*0xac+0x80, *point)
            struct.pack_into("<ffff", attributes, index*0x2c+4, .2+.05*(index%8), .7, .3, .9)
            struct.pack_into("<ff", attributes, index*0x2c+0x14, 2+.25*(index%4), 3)
            struct.pack_into("<ff", attributes, index*0x2c+0x20, .125*(index%3), .25)
            struct.pack_into("<ff", tiling, index*8, 100, 0 if index%2 else 4)
            struct.pack_into("<f", odometer, index*4, distance)
        return {"count": count, "mode": mode, "smoothingMode": smoothing, "smoothingQuality": quality,
                "textureAddressMode": 0, "blendMode": 1, "cutoff": cutoff,
                "viewForward": camera, "systemScale": [1,1], "colorMultiplier": [1,1,1,1], "emitterUv": [0,0],
                "particleHex": particles.hex(), "attributesHex": attributes.hex(),
                "tilingHex": tiling.hex(), "odometerHex": odometer.hex()}

    def observe(input_value):
        math_calls.clear()
        for key in ["particle", "attributes", "tiling", "odometer"]:
            engine.mem_write(a["particles" if key == "particle" else key], bytes.fromhex(input_value[key+"Hex"]))
        engine.context_restore(initial)
        engine.mem_write(a["context"], bytes(0xa000))
        for offset, address in [(0,a["indices"]),(8,a["vertices"]),(0x10,a["draw"]),(0x18,a["actor"]),(0x20,a["view"])]:
            put(a["context"]+offset,"Q",address)
        put(a["actor"],"QQ",a["system"],a["link"]); put(a["actor"]+0xa0,"Q",a["pool"])
        put(a["link"]+0x10,"Q",a["definition"]); put(a["link"]+0x1c,"I",0xffffffff)
        put(a["definition"]+0x60,"Q",a["primitive"]); put(a["definition"]+0x14,"B",input_value["blendMode"])
        put(a["definition"]+0xc9,"B",input_value["textureAddressMode"]); put(a["definition"]+0xe0,"ffff",*input_value["colorMultiplier"])
        put(a["primitive"],"Q",base+definition["primitiveVtableRva"]); put(a["primitive"]+8,"B",4)
        put(a["primitive"]+0x28,"f",input_value["cutoff"]); put(a["primitive"]+0x30,"BB",input_value["mode"],input_value["smoothingMode"])
        put(a["manager"]+0x29c,"I",input_value["smoothingQuality"])
        put(a["system"]+0x150,"ff",*input_value["systemScale"]); put(a["view"]+0x24,"fff",*input_value["viewForward"])
        put(a["actor"]+0x28,"ff",*input_value["emitterUv"])
        put(a["pool"]+0x10,"H",input_value["count"])
        for offset, address in [(0x38,a["particles"]),(0x98,a["attributes"]),(0xa8,a["tiling"]),(0xb8,a["odometer"])]:
            put(a["pool"]+offset,"Q",address)
        put(stack,"Q",stop); engine.reg_write(reg.UC_X86_REG_RSP,stack)
        engine.reg_write(reg.UC_X86_REG_RDI,a["primitive"]); engine.reg_write(reg.UC_X86_REG_RSI,a["context"])
        engine.emu_start(base+definition["writerRva"],stop,count=5000000)
        if engine.reg_read(reg.UC_X86_REG_RIP) != stop: raise ValueError("Trail instruction bound")
        vertex_end = struct.unpack("<Q",bytes(engine.mem_read(a["context"]+8,8)))[0]
        index_end = struct.unpack("<Q",bytes(engine.mem_read(a["context"],8)))[0]
        vertex_bytes, index_bytes = vertex_end-a["vertices"], index_end-a["indices"]
        if not (0<=vertex_bytes<=input_value["count"]*56 and 0<=index_bytes<=max(input_value["count"]-1,0)*12):
            raise ValueError("Native trail output outside owned buffers")
        return {"input":input_value,"verticesHex":bytes(engine.mem_read(a["vertices"],vertex_bytes)).hex(),
                "indicesHex":bytes(engine.mem_read(a["indices"],index_bytes)).hex(),
                "drawHex":bytes(engine.mem_read(a["draw"],16)).hex(),"mathCalls":list(math_calls)}

    fixture_path = args.package.resolve().parents[1] / 'research/vfx-trails-native.json'
    fixture_bytes = fixture_path.read_bytes()
    reference = json.loads(fixture_bytes)['cases'][292]
    observed = observe(reference['input'])
    if any(observed[key]!=reference[key] for key in ['verticesHex','indicesHex','drawHex']):
        raise ValueError('Traced original writer differs from unchanged native fixture')
    cases = [observed]
    result = {"schema":1,"build":definition["build"],"protocol":definition["protocol"],
              "definitionSha256":sha(definition_bytes),"decoderImageSha256":sha(image),
              "observerSourceSha256":sha(Path(__file__).read_bytes()),"cases":cases,
              "fixturePath":str(fixture_path),"fixtureSha256":sha(fixture_bytes),"caseIndex":292,"joins":joins,
              "executedOriginalBlocks":list(blocks.values()),
              "mathProvider":{"name":"Windows ucrtbase.dll float functions","sha256":sha(Path('C:/Windows/System32/ucrtbase.dll').read_bytes()),
                              "originalMacOSLibmVerified":False},"scope":__doc__}
    args.output.write_text(json.dumps(result,separators=(",",":"),allow_nan=False),encoding="utf-8")
    print(json.dumps({"cases":len(cases),"vertices":sum(len(c["verticesHex"])//56 for c in cases),
                      "executedOriginalBlocks":len(blocks),"mathCalls":sum(len(c["mathCalls"]) for c in cases)}))


if __name__ == "__main__":
    main()
