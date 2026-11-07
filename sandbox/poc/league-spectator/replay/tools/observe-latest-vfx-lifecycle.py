"""Compare replay-driven lifecycle checkpoint results with original CPU execution."""
import argparse
import json
from pathlib import Path

import unicorn
from vfx_legacy_quad_native import NativeLegacyQuad
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "playback", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    k = NativeLegacyQuad(args.package, args.client)
    meta = k.checked_json("vfx-legacy-quads.json", "vfxLegacyQuadsSha256")
    raw = args.playback.read_bytes()
    playback = json.loads(raw)
    if (playback["nativeLifecycle"]["definitionSha256"] != k.profile["vfxLegacyQuadsSha256"] or
        playback["effectManifestSha256"] != meta["effectsManifestSha256"]):
        raise ValueError("Replay lifecycle package mismatch")
    if playback["observerSourceSha256"] != sha(Path(__file__).with_name("inspect-latest-vfx-playback.mjs").read_bytes()):
        raise ValueError("Stale lifecycle draw observer")
    for name, digest in playback["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes()) != digest:
            raise ValueError(f"Stale lifecycle draw source: {name}")
    for name, digest in meta["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError(f"Stale lifecycle compiler: {name}")
    graphs, mismatches, frames, live, empty = {}, [], 0, 0, 0
    active, writes = [False], set()
    def write(uc, kind, at, count, value, user):
        if active[0]:
            writes.add((at-k.base, count))
    k.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, write, begin=k.base, end=k.base+len(k.image)-1)
    for index, sample in enumerate(playback["nativeLifecycleSamples"]):
        digest = sample["graphSha256"]
        if digest not in graphs:
            reference = next(t for t in meta["templates"] if t["sha256"] == digest)
            graph_raw = (args.package/reference["file"]).read_bytes()
            if sha(graph_raw) != digest:
                raise ValueError("Replay lifecycle graph hash mismatch")
            graphs[digest] = json.loads(graph_raw)
        k.reset_quad(graphs[digest], int(sample["seedHex"], 16), sample["quality"])
        for value in sample["inputs"]:
            active[0] = True
            try:
                output = k.frame_quad(value)
            finally:
                active[0] = False
            frames += 1
        actual = {name: output["state"][name] for name in ["vectors", "rngHex", "actorHex", "poolHex"]}
        if actual != sample["state"]:
            mismatches.append({"sample": index, "sequence": sample["sequence"], "emitter": sample["emitterIndex"],
                               "keys": [name for name in actual if actual[name] != sample["state"][name]]})
        if actual["vectors"]["life"]["count"]:
            live += 1
        else:
            empty += 1
    unexpected = [w for w in writes if not 0x2516698 <= w[0] <= 0x25166a0-w[1]]
    if unexpected:
        raise ValueError(f"Unadmitted executable globals in replay lifecycle: {unexpected}")
    result = {"schema": 1, "build": k.profile["clientVersion"], "protocol": k.profile["protocolDigest"],
              "definitionSha256": k.profile["vfxLegacyQuadsSha256"], "playbackSha256": sha(raw),
              "observerSha256": sha(Path(__file__).read_bytes()), "sources": playback["sources"],
              "graphs": len(graphs), "samples": len(playback["nativeLifecycleSamples"]), "frames": frames,
              "liveSamples": live, "emptySamples": empty, "executableGlobalWrites": sorted(writes),
              "originalBlocks": len(k.blocks), "mismatches": mismatches,
              "scope": "Persistent birth/pool/actor/RNG state from the shared replay lifecycle adapter agrees with original CPU code when replaying the same explicit fixed ticks, fractional display update, graph, unit root settings, preview poses/bases and seed zero. Includes empty/removal states and interleaved WASM checkpoints. Original replay activation, clock/orientation/random binding, shader, browser/GPU and League A/V remain unverified."}
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({name: result[name] for name in ["graphs", "samples", "frames", "liveSamples", "emptySamples", "originalBlocks"]}
                     | {"mismatches": len(mismatches), "firstMismatch": mismatches[:1]}))
    if mismatches:
        raise ValueError("Replay lifecycle native comparison failed")


if __name__ == "__main__":
    main()
