"""Compare replay preview quad buffers and decoded attributes with original code."""
import argparse
import json
from pathlib import Path
import struct

from vfx_quad_native import NativeQuad
from vfx_spawn_native import sha


def decoded(output):
    raw = bytes.fromhex(output["verticesHex"])
    positions, uv, mult_uv, colors = [], [], [], []
    for at in range(0, len(raw), 28):
        positions.append(list(struct.unpack_from("<3f", raw, at)))
        packed = struct.unpack_from("<I", raw, at + 12)[0]
        colors.append([((packed >> bit) & 255) / 255 for bit in [16, 8, 0, 24]])
        uv.append(list(struct.unpack_from("<2e", raw, at + 16)))
        mult_uv.append(list(struct.unpack_from("<2e", raw, at + 24)))
    idx = bytes.fromhex(output["indicesHex"])
    return {"positions": positions, "uv": uv, "multUv": mult_uv,
            "color": colors[0], "indices": list(struct.unpack(f"<{len(idx)//2}H", idx))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "playback", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeQuad(args.package, args.client)
    raw = args.playback.read_bytes()
    playback = json.loads(raw)
    if playback["nativeQuad"]["definitionSha256"] != kernel.profile["vfxQuadVerticesSha256"]:
        raise ValueError("Replay quad source mismatch")
    if playback["observerSourceSha256"] != sha(Path(__file__).with_name("inspect-latest-vfx-playback.mjs").read_bytes()):
        raise ValueError("Stale replay draw observer")
    for name, digest in playback["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes()) != digest:
            raise ValueError(f"Stale replay draw source: {name}")
    mismatches, vertices = [], 0
    for index, sample in enumerate(playback["nativeQuadSamples"]):
        actual = kernel.render(sample["input"])
        if actual != sample["output"]:
            mismatches.append({"sample": index, "kind": "raw-buffers", "native": actual})
        vertices += len(bytes.fromhex(actual["verticesHex"])) // 28
    draws = playback["softwarePreview"]["draws"]
    for index, draw in enumerate(draws):
        actual = kernel.render(draw["nativeQuad"]["input"])
        if actual != draw["nativeQuad"]["output"]:
            mismatches.append({"draw": index, "kind": "preview-raw-buffers"})
        for key, expected in decoded(actual).items():
            if draw[key] != expected:
                mismatches.append({"draw": index, "kind": f"decoded-{key}", "native": expected})
    result = {"schema": 1, "build": kernel.profile["clientVersion"],
              "protocol": kernel.profile["protocolDigest"],
              "definitionSha256": kernel.profile["vfxQuadVerticesSha256"],
              "playbackSha256": sha(raw), "observerSha256": sha(Path(__file__).read_bytes()),
              "moduleSha256": playback["sources"]["latest-vfx-quad-vertices.mjs"],
              "samples": len(playback["nativeQuadSamples"]), "vertices": vertices,
              "decodedPreviewQuads": len(draws), "mismatches": mismatches,
              "scope": "Raw vertex/index/header bytes and decoded preview attributes match original quad code on the same supplied preview particle bases, colors, scales and native UV matrices. Does not establish original birth/orientation/clock binding, browser rendering, shader, GPU or game A/V fidelity."}
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ["samples", "vertices", "decodedPreviewQuads"]} | {"mismatches": len(mismatches)}))
    if mismatches:
        raise ValueError("Replay quad native comparison failed")


if __name__ == "__main__":
    main()
