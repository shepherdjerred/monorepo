"""Prepare exact-build emitter-count code identity without reading a replay."""
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
        or sha(original.binary) != profile["sliceSha256"]
        or sha(image) != profile["decoderImageSha256"]):
        raise ValueError("VFX emission source mismatch")
    blocks = [(0x1758680, 0x1758a70), (0x176db00, 0x176db08),
              (0x17a635e, 0x17a636e), (0x17a6394, 0x17a63a4),
              (0x16fe7ad, 0x16fe7f5), (0x16fe83a, 0x16fe854),
              (0x16fe86b, 0x16fe8ab), (0x1700033, 0x1700043),
              (0x1700117, 0x1700142), (0x175679b, 0x17567c5),
              (0x175925c, 0x1759268), (0x175b146, 0x175b14a),
              (0x1758ab5, 0x1758aca), (0x1759553, 0x175958d),
              (0x17597fa, 0x175986c), (0x175994a, 0x175999c)]
    constants = [(0x20ccea0, 8), (0x20cc324, 4)]
    for a, b in blocks + [(a, a + size) for a, size in constants]:
        if image[a:b] != original.image[a:b]:
            raise ValueError("VFX emission code/constants differ from original")
    if struct.unpack_from("<II", image, 0x20ccea0) != (0x7f7fffff, 0x7f7fffff):
        raise ValueError("VFX period defaults changed")
    if struct.unpack_from("<Q", image, 0x23f20c8 + 0x38)[0] != profile["imageBase"] + 0x176db00:
        raise ValueError("ArbitraryQuad capacity callback changed")
    result = {
        "schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
        "countRva": 0x1758680, "countEndRva": 0x1758a70,
        "primitiveConstructorBlock": [0x17a6394, 0x17a63a2],
        "primitiveVtableRva": 0x23f20c8, "primitiveCapacityRva": 0x176db00,
        "birthTimeCommitBlock": [0x175925c, 0x1759268],
        "birthFlagCommitBlock": [0x175b146, 0x175b14a],
        "birthCountClampBlock": [0x1758ab5, 0x1758aca],
        "birthPositionInputsBlock": [0x1759553, 0x175958d],
        "birthPositionSetupBlock": [0x17597fa, 0x175986c],
        "birthPositionBlock": [0x175994a, 0x175999c],
        "maximumBirthsPerUpdate": 1000,
        "qualityPointerRva": 0x246dfd0, "qualityArrayOffset": 0x284,
        "defaults": {"rate": 0, "periodBits": 0x7f7fffff, "lastEmissionTime": 0},
        "perUpdateCapSecondsBits": struct.unpack_from("<I", image, 0x20cc324)[0],
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(image[a:b])} for a, b in blocks],
        "constants": [{"rva": a, "bytesHex": image[a:a+size].hex(), "sha256": sha(image[a:a+size])} for a, size in constants],
        "scope": "Emitter count arithmetic with unbaked/nonrandom rate, supplied time/normalized-age/quality and ArbitraryQuad capacity callback; birth-origin interpolation on supplied previous/current system positions. Velocity-derived rates, flex, quality selection, outer lifetime/period gates, remaining birth work and rendered presentation remain separate"
    }
    target = args.package / "vfx-emission.json"
    target.write_text(json.dumps(result, indent=2), encoding="utf-8")
    profile["vfxEmissionSha256"] = sha(target.read_bytes())
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": profile["vfxEmissionSha256"], "sourceBlocks": len(blocks)}))


if __name__ == "__main__":
    main()
