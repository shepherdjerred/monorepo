"""Prepare exact-build VFX curve/probability entry points without a replay."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from macho import MachImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("client", type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    source = MachImage(args.client.read_bytes())
    sha = lambda data: hashlib.sha256(data).hexdigest()
    if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(source.binary) != profile["sliceSha256"] or sha(image) != profile["decoderImageSha256"]):
        raise ValueError("VFX value source mismatch")
    blocks = [(0x177f49e, 0x177f4ac), (0x177f92e, 0x177f93c),
        (0x177f9be, 0x177f9fa), (0x178022e, 0x178026f), (0x1786a3e, 0x1786a55),
        (0x1786b10, 0x1786b64), (0x16d7b00, 0x16d7c30), (0x16db660, 0x16db6f0),
        (0x16d7de0, 0x16d7e10), (0x16d7e10, 0x16d8040),
        (0x16dc340, 0x16dc370), (0x1783560, 0x17836c0),
        (0x16d6e30, 0x16d6f10), (0x16d7600, 0x16d76e0),
        (0x16e4e90, 0x16e4f60)]
    for a, b in blocks:
        if image[a:b] != source.image[a:b]:
            raise ValueError("VFX value code differs from original client")
    for at, expected in [(0x16d6e88, 0xfe064c88), (0x16d7658, 0x4349c5f5), (0x16e4ee8, 0x53a6c97e)]:
        if struct.unpack_from("<I", image, at)[0] != expected:
            raise ValueError("VFX class registration mismatch")
    result = {"schema": 1, "build": profile["clientVersion"], "sliceSha256": profile["sliceSha256"],
        "decoderImageSha256": profile["decoderImageSha256"],
        "float": {"constructorBlock": [0x177f9be, 0x177f9fa], "postLoadRva": 0x16d7b00,
            "sampleRva": 0x16d7de0, "vtableRva": 0x23f1038},
        "color": {"constructorBlock": [0x178022e, 0x178026f], "postLoadRva": 0x16db660,
            "sampleRva": 0x16dc340, "vtableRva": 0x23f1218},
        "probability": {"constructorBlock": [0x1786a3e, 0x1786a55], "postLoadRva": 0x1786b10,
            "defaultSingleValueBits": 0x3f800000},
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(image[a:b])} for a, b in blocks],
        "scope": "Unbaked float/color curve and supplied-chance probability components. Vector2/3 wrapper selection, RNG, baked/integrated curves, emitter simulation and rendered A/V are separate"}
    destination = args.package / "vfx-values.json"
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["vfxValuesSha256"] = sha(destination.read_bytes())
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["vfxValuesSha256"], "sourceBlocks": len(blocks)}))


if __name__ == "__main__":
    main()
