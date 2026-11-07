"""Prepare the exact-build arbitrary-quad CPU writer, without replay input."""
import argparse
import json
from pathlib import Path
import struct

from vfx_spawn_native import sha
from vfx_quad_native import NativeQuad, Q, BLOCKS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeQuad(args.package, args.client)
    profile = kernel.profile
    if struct.unpack_from("<Q", kernel.image, 0x23f20c8+0x28)[0] != kernel.base+0x1730410:
        raise ValueError("ArbitraryQuad vertex callback changed")
    result = {"schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
              "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
              "runtimeSha256": "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
              "vfxTrailsSha256": profile["vfxTrailsSha256"], "writerRva": 0x1730410,
              "primitiveVtableRva": 0x23f20c8, "maximumParticles": 1024, "addresses": Q,
              "stackAddress": 0x10010008, "defaultDefinitionHex": kernel.default_definition.hex(),
              "initializedGlobals": kernel.trails["initializedGlobals"], "mathImports": {"_modff": 0x1feea6e},
              "formats": {"0": {"stride": 28, "colorOffset": 12, "uvOffset": 16, "multUvOffset": 24},
                          "1": {"stride": 40, "colorOffset": 20, "uvOffset": 24, "multUvOffset": 32}},
              "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a, b in BLOCKS],
              "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
                                  ["prepare-vfx-quad-vertices.py", "vfx_quad_native.py", "vfx_emitter_native.py", "vfx_spawn_native.py"]},
              "scope": "Complete original arbitrary-quad writer, index order, packed color and half UVs on explicit owned particle bases/positions/scales/colors/matrices. Two native vertex formats; remaining format-1 fields retained as raw bytes. No original birth/orientation/pose/clock binding, texture sampling, original shader, browser or game A/V proof."}
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-quad-vertices.json").write_bytes(raw)
    profile["vfxQuadVerticesSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": sha(raw), "writerRva": result["writerRva"]}))


if __name__ == "__main__":
    main()
