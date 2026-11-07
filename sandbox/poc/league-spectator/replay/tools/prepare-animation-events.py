"""Prepare exact-build scheduling metadata and equipped-skin event bindings."""
import argparse
from collections import Counter
import itertools
import json
from pathlib import Path
import struct

from animation_events_native import NativeAnimationEvents, BLOCKS, BOUNDARIES
from vfx_spawn_native import sha, name_hash


def walk(value, path=()):
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            yield from walk(child, (*path, key))
    elif isinstance(value, list):
        for key, child in enumerate(value):
            yield from walk(child, (*path, key))


def meta_hash(value):
    if not isinstance(value, str):
        raise ValueError("Invalid animation effect key")
    if len(value) == 10 and value.startswith("{") and value.endswith("}"):
        return f"{int(value[1:-1], 16):08x}"
    return f"{name_hash(value):08x}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "scene", "effects", "evidence"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeAnimationEvents(args.package, args.client)
    profile = kernel.profile
    scene_raw = (args.scene / "manifest.json").read_bytes()
    effects_raw = (args.effects / "manifest.json").read_bytes()
    scene, effects = json.loads(scene_raw), json.loads(effects_raw)
    if any(p["build"] != profile["clientVersion"] or p["protocol"] != profile["protocolDigest"]
           for p in [scene, effects]):
        raise ValueError("Animation event asset build mismatch")
    groups, sources, types = [], [], Counter()
    for key, asset in scene["champions"].items():
        actor_key = "champions/" + key
        actor = effects["actors"][actor_key]
        if actor["skinId"] != asset["skinId"] or actor["character"].lower() != asset["champion"].lower():
            raise ValueError("Animation event appearance mismatch")
        raw = (args.scene / asset["animationGraph"]).read_bytes()
        sources.append({"actor": actor_key, "file": asset["animationGraph"], "sha256": sha(raw)})
        for path, node in walk(json.loads(raw)):
            if "mEventDataMap" not in node:
                continue
            entries = []
            for event_id, event in node["mEventDataMap"].items():
                types[event["__type"]] += 1
                if event["__type"] != "ParticleEventData":
                    continue
                effect_key = event.get("mEffectKey")
                effect_hash = meta_hash(effect_key) if effect_key is not None else "00000000"
                binding = actor["resources"].get(effect_hash)
                if effect_key is None:
                    binding = {"status": "no-declared-effect-key"}
                elif binding is None:
                    binding = {"status": "unprepared-resource-key"}
                if binding["status"] == "prepared-definition":
                    definition = effects["definitions"][binding["effectId"]]
                    if definition["actor"] != actor_key:
                        raise ValueError("Animation event definition belongs to another appearance")
                projection = {"id": event_id, "startFrame": event.get("mStartFrame", 0),
                    "endFrame": event.get("mEndFrame", -1), "skipExpired": event.get("{a3826203}", False),
                    "isLoop": event.get("mIsLoop", True), "isKillEvent": event.get("mIsKillEvent", True),
                    "fireIfEarly": event.get("mFireIfAnimationEndsEarly", False)}
                entries.append({"id": event_id, "authored": event, "scheduling": projection,
                    "effectKeyHash": effect_hash, "binding": binding,
                    "attachmentStatus": "unrecovered-native-bone-and-owner-binding"})
            if entries:
                groups.append({"actor": actor_key, "path": list(path), "clipType": node["__type"], "events": entries})
    # Both observed authored inputs and controlled boundary/flag combinations.
    sequences = []
    for start, end in [(0, -1), (2, -1), (2, 1), (2, 2), (2, 5), (-1, 2), (2.25, 4.75)]:
        for skip, loop, kill, early in itertools.product([False, True], repeat=4):
            spec = {"id": "controlled", "startFrame": start, "endFrame": end,
                "skipExpired": skip, "isLoop": loop, "isKillEvent": kill, "fireIfEarly": early}
            for clocks in [[-2, -1, 0, 1, 2, 2.25, 3, 4.75, 5, 6], [-2, 6, 6]]:
                sequences.append({"name": "controlled", "events": [spec], "clocks":
                    [{"frame": f, "resync": False} for f in clocks] +
                    [{"frame": f, "resync": True} for f in [0, 2, 3, 6, 1, -2, 3]]})
    for group in groups:
        specs = [e["scheduling"] for e in group["events"]]
        boundaries = {0.0}
        for spec in specs:
            for key in ["startFrame", "endFrame"]:
                value = spec[key]
                boundaries.update([value-0.01, value, value+0.01])
        clocks = sorted(boundaries)
        sequences.append({"name": "authored", "actor": group["actor"], "path": group["path"],
            "events": specs, "clocks": [{"frame": f, "resync": False} for f in clocks] +
            [{"frame": f, "resync": True} for f in reversed(clocks)]})
    for sequence in sequences:
        kernel.reset(sequence["events"])
        sequence["frames"] = [{"input": clock, "output": kernel.step(clock["frame"], clock["resync"])}
                              for clock in sequence.pop("clocks")]
    defaults = kernel.default_data
    if struct.unpack_from("<ff", defaults, 0xc) != (0, -1) or defaults[0x48:0x4d] != bytes([1, 1, 0, 0, 0]):
        raise ValueError("Native animation particle event defaults changed")
    metadata = {"schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
        "vfxSpawnSha256": profile["vfxSpawnSha256"],
        "runtimeSha256": "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
        "constructorRva": 0x15dc290, "factoryRva": 0x15c1750, "dispatchRva": 0x1589270,
        "resyncRva": 0x158cff0, "runtimeVtableRva": 0x23e31b8,
        "requestBoundaries": [{"rva": at, "kind": kind} for at, kind in BOUNDARIES.items()],
        "fieldLayout": kernel.layout, "defaultDataHex": defaults.hex(),
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a, b in BLOCKS],
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
            ["prepare-animation-events.py", "animation_events_native.py", "vfx_spawn_native.py", "vfx_uv_native.py"]},
        "assets": {"sceneManifestSha256": sha(scene_raw), "effectsManifestSha256": sha(effects_raw), "graphs": sources},
        "eventTypes": dict(types), "groups": groups,
        "scope": "Original constructors, forward dispatch and explicit resynchronization on owned event collections. Activation/release/speed are request sinks. No effect creation, attachment, interruption/loop policy, replay-time conversion, sound or renderer integration is claimed."}
    raw = json.dumps(metadata, indent=2).encode()
    (args.package / "animation-events.json").write_bytes(raw)
    profile["animationEventsSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    evidence = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"],
        "definitionSha256": sha(raw), "decoderImageSha256": metadata["decoderImageSha256"],
        "executedOriginalBlocks": list(kernel.blocks.values()), "compilerSources": metadata["compilerSources"],
        "sequences": sequences, "scope": metadata["scope"]}
    args.evidence.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    events = [event for group in groups for event in group["events"]]
    print(json.dumps({"groups": len(groups), "events": len(events), "eventTypes": dict(types),
        "bindings": dict(Counter(e["binding"]["status"] for e in events)), "sequences": len(sequences),
        "frames": sum(len(s["frames"]) for s in sequences), "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
