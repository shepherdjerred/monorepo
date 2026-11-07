"""Recover particle sampler descriptors and Metal address arguments offline."""
import argparse
import json
from pathlib import Path
import re
import struct

from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES as A, sha
from vfx_uv_native import NativeUv, registrations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "apple_source"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeUv(args.package, args.client)
    source = json.loads(args.apple_source.read_bytes())
    header = args.apple_source.with_name("MTLSampler.hpp").read_bytes()
    if sha(header) != source["sha256"] or not re.fullmatch(r"[a-f0-9]{40}", source["revision"]):
        raise ValueError("Apple sampler source changed")
    metal = {name: int(re.search(rb"SamplerAddressMode"+name.encode()+rb"\s*=\s*(\d+)", header)[1])
             for name in ["Repeat", "MirrorRepeat", "ClampToEdge", "ClampToBorderColor"]}
    if metal != {"Repeat": 2, "MirrorRepeat": 3, "ClampToEdge": 0, "ClampToBorderColor": 5}:
        raise ValueError("Apple sampler enum changed")
    blocks = [(0x16e3910, 0x16e3a53), (0x1927f7b, 0x1927fa7), (0x1927db7, 0x1927dc2),
              (0x17bb66a, 0x17bb6a1), (0x16decd5, 0x16decec), (0x16df141, 0x16df160)]
    for start, end in blocks:
        if kernel.image[start:end] != kernel.source.image[start:end]:
            raise ValueError("Sampler code differs from pristine client")
    # The lookup's next instruction loads setSAddressMode: before objc_msgSend.
    selector_ref = 0x1927dc9+struct.unpack_from("<i", kernel.image, 0x1927dc5)[0]
    selector = struct.unpack_from("<Q", kernel.image, selector_ref)[0]-kernel.base
    if kernel.image[selector:selector+17] != b"setSAddressMode:\0":
        raise ValueError("Metal address selector binding changed")
    layout = {
        "base": registrations(kernel.image, 0x16fe700, 0x16ff3f0,
            {"texAddressModeBase": (0xc9, 1, "byte", 0), "isTexturePixelated": (0x12, 1, "boolean", 0)}),
        "mult": registrations(kernel.image, 0x1701310, 0x1701528,
            {"texAddressModeMult": (0x18, 1, "byte", 0)}),
    }
    kernel.call(0x1927f7b, {}, 0x1927fa7)
    default_base = kernel.default_definition[0xc9]
    default_mult = kernel.default_mult[0x18]
    default_pixelated = bool(kernel.default_definition[0x12])
    if default_base != 0 or default_mult != 0 or default_pixelated:
        raise ValueError("Native sampler defaults changed")
    cases, maps = [], {}
    frame = A["stack"]-8
    material, vector, mult = 0x10030000, 0x10031000, 0x10027000
    for base in range(4):
        for secondary in range(4):
            for pixelated in [False, True]:
                for layer, slot in [("base", 0), ("mult", 7)]:
                    kernel.u.mem_write(A["definition"], kernel.default_definition)
                    kernel.u.mem_write(mult, kernel.default_mult)
                    kernel.put(A["definition"]+0x230, "Q", mult)
                    kernel.put(A["definition"]+0xc9, "B", base)
                    kernel.put(mult+0x18, "B", secondary)
                    kernel.put(A["definition"]+0x12, "B", pixelated)
                    kernel.put(A["link"]+0x10, "Q", A["definition"])
                    kernel.u.mem_write(frame-0x50, bytes(0x20))
                    kernel.call(0x16e3910, {r.UC_X86_REG_RDI: A["link"], r.UC_X86_REG_RCX: slot}, 0x16e3a53)
                    if kernel.u.reg_read(r.UC_X86_REG_RBP) != frame:
                        raise ValueError("Native sampler call frame changed")
                    descriptor = bytes(kernel.u.mem_read(frame-0x40, 5))
                    # The original material binding copies these address/filter
                    # bytes intact; owned null texture and preallocated vector.
                    kernel.u.mem_write(material, bytes(0x30))
                    kernel.put(material+0x20, "Q", vector)
                    kernel.call(0x17bb66a, {r.UC_X86_REG_RBX: material, r.UC_X86_REG_R14: frame-0x50}, 0x17bb6a1)
                    if bytes(kernel.u.mem_read(vector+0x10, 5)) != descriptor:
                        raise ValueError("Material sampler copy changed descriptor")
                    engine = descriptor[0]
                    if descriptor[:3] != bytes([engine])*3:
                        raise ValueError("Unexpected asymmetric native particle address mode")
                    kernel.call(0x1927db7, {r.UC_X86_REG_R13: engine}, 0x1927dc2)
                    metal_value = kernel.u.reg_read(r.UC_X86_REG_RDX)
                    authored = base if layer == "base" else secondary
                    maps.setdefault(authored, (engine, metal_value))
                    if maps[authored] != (engine, metal_value):
                        raise ValueError(f"Inconsistent native sampler mode: base={base}, mult={secondary}, layer={layer}, pixelated={pixelated}, authored={authored}, previous={maps[authored]}, actual={(engine, metal_value)}, descriptor={descriptor.hex()}")
                    cases.append({"base": base, "mult": secondary, "pixelated": pixelated, "layer": layer,
                                  "descriptorHex": descriptor.hex(), "engineAddress": engine, "metalAddress": metal_value})
    names = {0: "repeat", 1: "mirror", 2: "clamp", 3: "border"}
    expected = {0: (0, 2), 1: (2, 3), 2: (1, 0), 3: (3, 5)}
    if maps != expected:
        raise ValueError("Native sampler map changed")
    profile = kernel.profile
    result = {"schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
              "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
              "descriptorBlock": [0x16e3910, 0x16e3a53], "lookupBlock": [0x1927db7, 0x1927dc2],
              "defaults": {"base": default_base, "mult": default_mult, "pixelated": default_pixelated}, "fieldLayout": layout,
              "addressModes": [{"authored": k, "engine": v[0], "metal": v[1], "name": names[k], "previewSupported": k != 3} for k, v in sorted(maps.items())],
              "appleSource": {**source, "enumValues": metal}, "nativeCases": cases,
              "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a, b in blocks],
              "executedOriginalBlocks": list(kernel.blocks.values()),
              "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
                                  ["prepare-vfx-samplers.py", "vfx_uv_native.py", "vfx_spawn_native.py"]},
              "scope": "Original base/mult address and min/mag selector fields, material binding copy and Metal address lookup on owned data. Stops before graphics/ObjC calls. Preview supports repeat, mirror and clamp addressing; border, mip/aniso/LOD behavior, pixelated preview textures, GPU equivalence and game A/V remain unverified."}
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-samplers.json").write_bytes(raw)
    profile["vfxSamplersSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "modes": result["addressModes"], "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
