"""Prepare original atomic clocks from installed-build graphs and raw ANM headers."""
import argparse
from collections import Counter
import json
from pathlib import Path
import struct

from animation_clock_native import NativeAnimationClock, BLOCKS, RESOURCE
from vfx_spawn_native import sha


def scalar(hex_value):
    return struct.unpack("<f", bytes.fromhex(hex_value))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "scene", "evidence"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeAnimationClock(args.package, args.client)
    profile = kernel.profile
    scene_raw = (args.scene / "manifest.json").read_bytes()
    scene = json.loads(scene_raw)
    world_raw = (args.scene / scene["world"]).read_bytes()
    world = json.loads(world_raw)
    if scene["build"] != profile["clientVersion"] or scene["protocol"] != profile["protocolDigest"]:
        raise ValueError("Atomic clock scene build mismatch")
    assets = [("champions/"+key, asset) for key, asset in scene["champions"].items()]
    assets += [("world/"+key, asset) for key, asset in world["assets"].items()
               if asset.get("animationGraph") and asset.get("animationCatalog")]
    defaults = {key: struct.unpack_from("<f", kernel.default_data, offset)[0]
                for key, offset in [("tickDuration", 0x68), ("startFrame", 0x88), ("endFrame", 0x8c)]}
    graphs, observations, format_counts = {}, [], Counter()
    for actor, asset in assets:
        graph_raw = (args.scene / asset["animationGraph"]).read_bytes()
        catalog_raw = (args.scene / asset["animationCatalog"]).read_bytes()
        selected_file = Path(asset["animationCatalog"]).parent / "selected-clips.json"
        selected_raw = (args.scene / selected_file).read_bytes()
        selected = json.loads(selected_raw)
        catalog = json.loads(catalog_raw)
        data = [g for g in json.loads(graph_raw).values() if isinstance(g, dict) and g.get("__type") == "AnimationGraphData"]
        if len(data) != 1:
            raise ValueError("Ambiguous atomic clock graph")
        clips = {}
        for name, node in data[0]["mClipDataMap"].items():
            if node["__type"] != "AtomicClipData":
                continue
            raw_file = Path(asset["animationCatalog"]).parent / selected[name]
            raw = (args.scene / raw_file).read_bytes()
            resource = kernel.prepare_header(raw)
            format_counts[(resource.get("kind", resource["status"]), resource["version"])] += 1
            clip = {"source": {"file": raw_file.as_posix(), "sha256": sha(raw),
                    "headerSha256": sha(raw[:0x80])}, "status": resource["status"]}
            if resource["status"] != "prepared":
                clips[name] = clip
                continue
            clock = {"resourceFrames": resource["resourceFrames"], "resourceFps": resource["resourceFps"],
                "tickDuration": node.get("mTickDuration", defaults["tickDuration"]),
                "startFrame": node.get("startFrame", defaults["startFrame"]),
                "endFrame": node.get("EndFrame", defaults["endFrame"])}
            base = kernel.sample(resource, node, 0)
            duration = scalar(base["durationHex"])
            if duration < 0 or clock["tickDuration"] <= 0:
                raise ValueError("Invalid authored atomic clock interval")
            clip.update({"clock": clock, "duration": duration, "resourceKind": resource["kind"],
                "resourceVersion": resource["version"], "exportedFrames": catalog["clips"][name]["frames"],
                "exportedFps": catalog["clips"][name]["fps"], "exportedDuration": catalog["clips"][name]["duration"]})
            clips[name] = clip
            inputs = [{"elapsed": t, "delta": 0, "rate": 1} for t in
                [-.1, 0, .01, .1, duration*.25, duration*.5, max(0, duration-.00001), duration, duration+.01]]
            inputs += [{"elapsed": .1, "delta": 1/60, "rate": rate} for rate in [0, .5, 1, 2, 4]]
            observations.append({"actor": actor, "graph": asset["animationGraph"], "clip": name,
                "clock": clock, "samples": [{"input": v, "output": kernel.sample(resource, node, **v)} for v in inputs]})
        if asset["animationGraph"] in graphs:
            raise ValueError("Duplicate atomic clock graph")
        graphs[asset["animationGraph"]] = {"actor": actor, "graphSha256": sha(graph_raw),
            "catalogFile": asset["animationCatalog"], "catalogSha256": sha(catalog_raw),
            "selectedClipsFile": selected_file.as_posix(), "selectedClipsSha256": sha(selected_raw), "clips": clips}
    # Fractional trims and tick/rate combinations expose the native operation
    # order, rather than comparing only integer frames on 30 FPS assets.
    resource = kernel.prepare_header((args.scene / next(iter(next(iter(graphs.values()))["clips"].values()))["source"]["file"]).read_bytes())
    for start, end in [(0, -1), (3.25, 20.75), (-2, 30), (12, 12), (2.5, 3.1)]:
        for tick in [1/60, 1/30, .0555555559694767, 1]:
            node = {"startFrame": start, "EndFrame": end, "mTickDuration": tick}
            clock = {"resourceFrames": resource["resourceFrames"], "resourceFps": resource["resourceFps"], "startFrame": start, "endFrame": end, "tickDuration": tick}
            observations.append({"actor": None, "graph": None, "clip": "controlled", "clock": clock,
                "samples": [{"input": v, "output": kernel.sample(resource, node, **v)} for v in
                    [{"elapsed": .13125, "delta": d, "rate": rate} for d in [0, 1/60, .1] for rate in [0, .5, 1, 2]]]})
    metadata = {"schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
        "defaults": defaults, "fieldLayout": kernel.layout, "resourceClasses": RESOURCE,
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a, b in BLOCKS],
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
            ["prepare-animation-clock.py", "animation_clock_native.py", "vfx_spawn_native.py", "vfx_uv_native.py"]},
        "sceneManifestSha256": sha(scene_raw), "worldCatalogSha256": sha(world_raw), "graphs": graphs,
        "scope": "Original loaded-resource header projections/frame-count/FPS getters, atomic event-frame/duration prefixes and pose-time conversion. No pose evaluation, ANM payload conversion, recorded rate semantics, clip interruption or loop policy is established."}
    raw = json.dumps(metadata, indent=2).encode()
    (args.package / "animation-clock.json").write_bytes(raw)
    profile["animationClockSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    evidence = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"],
        "definitionSha256": sha(raw), "decoderImageSha256": metadata["decoderImageSha256"],
        "compilerSources": metadata["compilerSources"], "executedOriginalBlocks": list(kernel.blocks.values()),
        "observations": observations, "scope": metadata["scope"]}
    args.evidence.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    clips = [c for g in graphs.values() for c in g["clips"].values()]
    print(json.dumps({"graphs": len(graphs), "clips": len(clips), "statuses": dict(Counter(c["status"] for c in clips)),
        "formats": {str(k): v for k, v in format_counts.items()}, "observations": sum(len(o["samples"]) for o in observations),
        "exportedFrameDeficits": sum(c.get("exportedFrames", 0) < c["clock"]["resourceFrames"] for c in clips if c["status"] == "prepared"),
        "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
