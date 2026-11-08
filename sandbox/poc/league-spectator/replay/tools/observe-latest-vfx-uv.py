"""Compare replay-driven UV adapter outputs with original CPU functions."""
import argparse
import json
from pathlib import Path
import struct

from vfx_spawn_native import sha
from vfx_uv_animation_native import NativeUvAnimation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "playback", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeUvAnimation(args.package, args.client)
    meta = kernel.checked_json("vfx-uv-animation.json", "vfxUvAnimationSha256")
    raw_playback = args.playback.read_bytes()
    playback = json.loads(raw_playback)
    if (playback["nativeUv"]["definitionSha256"] != kernel.profile["vfxUvAnimationSha256"]
        or playback["effectManifestSha256"] != meta["effectsManifestSha256"]):
        raise ValueError("Replay UV proof source mismatch")
    if playback["observerSourceSha256"] != sha(Path(__file__).with_name("inspect-latest-vfx-playback.mjs").read_bytes()):
        raise ValueError("Stale replay draw observer")
    for name, digest in playback["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes()) != digest:
            raise ValueError(f"Stale replay draw source: {name}")
    f = lambda n: struct.unpack("<f", struct.pack("<f", n))[0]
    graphs, mismatches, matrices = {}, [], 0
    for sample in playback["nativeUvSamples"]:
        digest = sample["graphSha256"]
        if digest not in graphs:
            reference = next(t for t in meta["templates"] if t["sha256"] == digest)
            raw = (args.package / reference["file"]).read_bytes()
            if sha(raw) != digest:
                raise ValueError("Replay UV graph hash mismatch")
            graphs[digest] = json.loads(raw)
        kernel.restore_graph(graphs[digest])
        birth = kernel.birth({"emitterAge": 0, "chance": 0})
        elapsed, life = f(sample["age"]), f(sample["life"])
        actual = kernel.sample(birth["records"], {"age": elapsed, "normalizedAge": f(min(1, max(0, f(elapsed/life)))),
                                                   "lifetime": life, "chance": 0})
        if actual["matrices"] != sample["uv"]["raw"]:
            mismatches.append({"sample": sample, "native": actual})
        for group, hex_value in actual["matrices"].items():
            expected = list(struct.unpack("<ffffff", bytes.fromhex(hex_value))) if hex_value else [1, 0, 0, 1, 0, 0]
            if expected != sample["uv"][group]:
                mismatches.append({"kind": "decoded-matrix", "sample": sample, "native": expected})
            matrices += hex_value is not None
    result = {"schema": 1, "build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"],
              "definitionSha256": kernel.profile["vfxUvAnimationSha256"], "playbackSha256": sha(raw_playback),
              "observerSha256": sha(Path(__file__).read_bytes()), "moduleSha256": playback["sources"]["latest-vfx-uv-animation.mjs"],
              "adapterSha256": playback["sources"]["latest-vfx-uv-playback.mjs"], "samples": len(playback["nativeUvSamples"]),
              "matrices": matrices, "graphs": len(graphs), "mismatches": mismatches,
              "scope": "Raw UV matrix bytes and decoded coefficients from the browser's shared replay draw sampler agree with original native functions on the same preview ages/lifetimes, deterministic birth/chance policy and static graphs. No GPU, browser execution, original clock/activation/seed or rendered-game fidelity claim."}
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"samples": result["samples"], "matrices": matrices, "graphs": len(graphs), "mismatches": len(mismatches)}))
    if mismatches:
        raise ValueError("Replay UV native comparison failed")


if __name__ == "__main__":
    main()
