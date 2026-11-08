"""Prepare the exact-build CPU camera-trail writer and owned-context contract."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from macho import MachImage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "runtime"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    profile = json.loads((args.package / "profile.json").read_bytes())
    image = (args.package / "image.bin").read_bytes()
    original = MachImage(args.client.read_bytes())
    runtime = json.loads(args.runtime.read_bytes())
    sha = lambda b: hashlib.sha256(b).hexdigest()
    if (profile["clientVersion"] != "16.21.829.8620"
        or profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b"
        or sha(original.binary) != profile["sliceSha256"] or sha(image) != profile["decoderImageSha256"]
        or runtime["sha256"] != "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716"):
        raise ValueError("Trail writer source mismatch")
    blocks = [(0x1737570, 0x1738a20), (0x1738a20, 0x1738a40),
              (0x17a7584, 0x17a75bd), (0x17b5074, 0x17b50d1),
              (0x148dbe0, 0x148dc50), (0x148dfa0, 0x148e0d0),
              (0x1731fb0, 0x17320f0), (0x148f090, 0x148f0f0)]
    for a, b in blocks:
        if image[a:b] != original.image[a:b]:
            raise ValueError("Trail writer differs from original")
    if struct.unpack_from("<Q", image, 0x23f6520 + 0x28)[0] != profile["imageBase"] + 0x1737570:
        raise ValueError("Camera trail writer vtable changed")
    imports = {"modff": 0x1feea6e, "atan2f": 0x1fee720, "fmodf": 0x1fee864}
    for name, rva in imports.items():
        if original.imports.get(rva) != "_" + name:
            raise ValueError("Trail math import changed")
    if struct.unpack_from("<ff", image, 0x20ca0d0) != (1., 1.):
        raise ValueError("Trail UV static initializer changed")
    result = {
        "schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
        "runtimeSha256": runtime["sha256"], "writerRva": 0x1737570,
        "primitiveVtableRva": 0x23f6520, "primitiveKind": 4,
        "primitiveConstructorBlock": [0x17a7584, 0x17a75bd], "capacityRva": 0x1738a20,
        "managerPointerRva": 0x246dfd0, "mathImports": imports,
        "initializedGlobals": [{"rva": 0x247c7d0, "bytesHex": image[0x20ca0d0:0x20ca0d8].hex()},
                               {"rva": 0x247c7d8, "bytesHex": "01"}],
        "strides": {"particle": 0xac, "attributes": 0x2c, "tiling": 8, "odometer": 4,
                    "vertex": 28, "index": 2},
        "maximumPoints": 1024,
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(image[a:b])} for a, b in blocks],
        "scope": "Whole original CPU camera-trail writer on owned no-attachment/no-mult-layer inputs and supplied particle/attribute/tiling/odometer buffers, view direction and smoothing quality. Initialized static UV data and explicit external math adapters. Birth/pool ordering, attachments, full material/shader behavior and rendered A/V remain separate"
    }
    path = args.package / "vfx-trails.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["vfxTrailsSha256"] = sha(path.read_bytes())
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["vfxTrailsSha256"], "sourceBlocks": len(blocks)}))


if __name__ == "__main__":
    main()
