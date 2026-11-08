"""Prepare matching particle RNG and hashed point-shape identities, without ROFL input."""
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
    original = MachImage(args.client.read_bytes())
    sha = lambda data: hashlib.sha256(data).hexdigest()
    if (profile["clientVersion"] != "16.21.829.8620"
        or profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(original.binary) != profile["sliceSha256"] or sha(image) != profile["decoderImageSha256"]):
        raise ValueError("VFX birth source mismatch")
    blocks = [(0x1490eb0, 0x14910a0), (0x14910e0, 0x1491110),
              (0x2e7b60, 0x2e7b69), (0x2e7b70, 0x2e7ba9),
              (0x665be3, 0x665c01), (0x14db200, 0x14db20a),
              (0x17b2073, 0x17b20d5), (0x179556e, 0x179558c),
              (0x170a400, 0x170a406), (0x170acb0, 0x170acd4), (0x170ace0, 0x170ace6),
              (0x177fb4e, 0x177fb83), (0x177fcee, 0x177fd36),
              (0x16d8aa0, 0x16d8b30), (0x16d9e70, 0x16d9f10),
              (0x16d8d40, 0x16d9100), (0x16d9fa0, 0x16da4b0),
              (0x16db8d0, 0x16dbdf0)]
    for a, b in blocks + [(0x20d9770, 0x20d9774), (0x256cb08, 0x256cb14)]:
        if image[a:b] != original.image[a:b]:
            raise ValueError("VFX birth code/constants differ from original")
    if original.imports.get(0x1fee9ea) != "_mach_absolute_time":
        raise ValueError("RNG startup seed import changed")
    if struct.unpack_from("<I", image, 0x17b20a3)[0] != 0xee39916f:
        raise ValueError("Point shape class registration changed")
    if struct.unpack_from("<I", image, 0x20d9770)[0] != 0x2f800000:
        raise ValueError("RNG float conversion scale changed")
    if struct.unpack_from("<Q", image, 0x234b720 + 0x18)[0] != profile["imageBase"] + 0x2e7b70:
        raise ValueError("RNG draw vtable changed")
    result = {
        "schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
        "vfxValuesSha256": profile["vfxValuesSha256"],
        "randomizedValues": {
            "1": {"constructorBlock": [0x177f9be, 0x177f9fa], "timeOffset": 0x10, "valueOffset": 0x20,
                  "postLoadRva": 0x16d7b00, "sampleRva": 0x16d7de0, "outputRegister": "rsi", "vtableRva": 0x23f1038, "sampleSlot": 0x48},
            "2": {"constructorBlock": [0x177fb4e, 0x177fb83], "timeOffset": 0x18, "valueOffset": 0x28,
                  "postLoadRva": 0x16d8aa0, "sampleRva": 0x16d8d40, "outputRegister": "rsi", "vtableRva": 0x23f10e0, "sampleSlot": 0x40},
            "3": {"constructorBlock": [0x177fcee, 0x177fd36], "timeOffset": 0x20, "valueOffset": 0x30,
                  "postLoadRva": 0x16d9e70, "sampleRva": 0x16d9fa0, "outputRegister": "rdx", "vtableRva": 0x23f1180, "sampleSlot": 0x40},
            "4": {"constructorBlock": [0x178022e, 0x178026f], "timeOffset": 0x28, "valueOffset": 0x38,
                  "postLoadRva": 0x16db660, "sampleRva": 0x16db8d0, "outputRegister": "rdx", "vtableRva": 0x23f1218, "sampleSlot": 0x40}},
        "random": {"seedRva": 0x14910e0, "nextFloatRva": 0x1490eb0,
                   "wordRva": 0x2e7b70, "counterRva": 0x2e7b60,
                   "vtableRva": 0x234b720, "seedStorageRva": 0x2516698,
                   "tls": {"stream": 0x2488280, "seedReady": 0x2488298, "objectReady": 0x24882b0},
                   "wordMultiplierHex": "2545f4914f6cdd1d", "floatScaleBits": 0x2f800000,
                   "floatConversionBlock": [0x1490f3d, 0x1490f52],
                   "startupSeedCallRva": 0x665bfc, "startupSeedProviderRva": 0x14db200,
                   "startupSeedImport": "_mach_absolute_time"},
        "point": {"classHash": "ee39916f", "vtableRva": 0x23f4ff0,
                  "constructorBlock": [0x179556e, 0x179558c], "postLoadRva": 0x170a400,
                  "sampleRva": 0x170acb0, "secondaryRva": 0x170ace0,
                  "offsetFieldHash": "e5f268dd", "offsetField": 8, "outputOffset": 8},
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(image[a:b])} for a, b in blocks],
        "scope": "Native seeded random stream/float conversion, unbaked randomized scalar/vector2/vector3/color samplers and hashed point-shape offset copy. TLS resolution is an owned-input adapter. Original match seed, thread/call order, other shapes, full birth execution and rendered A/V are not established"
    }
    for value_meta in result["randomizedValues"].values():
        for slot, key in [(0x20, "postLoadRva"), (value_meta["sampleSlot"], "sampleRva")]:
            if struct.unpack_from("<Q", image, value_meta["vtableRva"] + slot)[0] != profile["imageBase"] + value_meta[key]:
                raise ValueError("VFX value vtable binding changed")
    target = args.package / "vfx-birth.json"
    target.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["vfxBirthSha256"] = sha(target.read_bytes())
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["vfxBirthSha256"], "sourceBlocks": len(blocks)}))


if __name__ == "__main__":
    main()
