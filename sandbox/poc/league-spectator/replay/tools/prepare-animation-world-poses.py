"""Prepare original world-pose hierarchy and observe asset-bound local poses."""
import argparse
import json
import math
from pathlib import Path
import struct

from animation_world_pose_native import NativeAnimationWorldPose, BLOCKS
from vfx_spawn_native import sha


def hex_pose(values):
    return struct.pack("<10f", *values).hex()


def local_frame(raw, frame, graph):
    size = struct.unpack_from("<I", raw)[0]
    header = json.loads(raw[4:4+size])
    data = raw[4+size:]
    poses = [bytearray.fromhex(value) for value in graph["bindLocalHex"]]
    offsets = {"position": 0, "scale": 12, "quaternion": 24}
    if not 0 <= frame < header["frames"]:
        raise ValueError("Prepared animation frame out of bounds")
    for track in header["tracks"]:
        index, width = track["jointId"], track["width"]
        if graph["joints"][index] != track["bone"] or width != (4 if track["channel"] == "quaternion" else 3):
            raise ValueError("Animation track/rig identity mismatch")
        start = track["offset"]+(0 if track["count"] == 1 else frame)*width*4
        poses[index][offsets[track["channel"]]:offsets[track["channel"]]+width*4] = data[start:start+width*4]
    return [bytes(pose).hex() for pose in poses]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "scene", "poses", "evidence"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeAnimationWorldPose(args.package, args.client)
    rig_raw = (args.package/"animation-rigs.json").read_bytes()
    pose_raw = (args.poses/"manifest.json").read_bytes()
    if sha(rig_raw) != kernel.profile["animationRigsSha256"] or sha(pose_raw) != kernel.profile["animationPosesSha256"]:
        raise ValueError("Stale world-pose input packages")
    rigs, poses = json.loads(rig_raw), json.loads(pose_raw)
    graphs, cases, clips_used = {}, [], {}
    for graph_file, rig in rigs["graphs"].items():
        raw = (args.scene/rig["rigFile"]).read_bytes()
        if sha(raw) != rig["rigSha256"]:
            raise ValueError("World-pose rig source changed")
        graph = kernel.construct(raw, [j["name"] for j in rig["joints"]])
        graph.update({"actor": rig["actor"], "rigSha256": rig["rigSha256"],
                      "catalogSha256": rig["catalogSha256"], "rigFile": rig["rigFile"], "catalogFile": rig["catalogFile"]})
        graphs[graph_file] = graph
        for inherit in [True, False]:
            for label, root in [("identity", [0,0,0,1,1,1,0,0,0,1]),
                                ("turned-scaled", [123.25,-4.5,678.75,1.25,.75,1.5,0,math.sin(.35),0,math.cos(.35)])]:
                inp = {"graph": graph_file, "localHex": graph["bindLocalHex"], "rootHex": hex_pose(root), "inheritScale": inherit}
                cases.append({"label": "bind/"+label, "input": inp, "output": kernel.evaluate(inp["localHex"], inp["rootHex"], inherit)})
        source = poses["graphs"][graph_file]
        chosen = []
        for word in ["idle", "run", "attack", "spell", "death", "dance"]:
            candidate = next((name for name in source["catalog"]["clips"] if word in name.lower() and name not in chosen), None)
            if candidate: chosen.append(candidate)
        if not chosen:
            raise ValueError("No prepared animation clips for world-pose observation")
        for clip_name in chosen:
            clip = source["catalog"]["clips"][clip_name]
            relative = source["directory"]+"/"+clip["file"]
            clip_raw = (args.poses/relative).read_bytes()
            if sha(clip_raw) != clip["sha256"]:
                raise ValueError("World-pose animation source changed")
            clips_used[relative] = clip["sha256"]
            for frame in sorted({0, clip["frames"]//2, clip["frames"]-1}):
                inp = {"graph": graph_file, "localHex": local_frame(clip_raw,frame,graph),
                       "rootHex": hex_pose([123+frame*2,0,678+frame,1.1,1.1,1.1,0,math.sin(.2),0,math.cos(.2)]), "inheritScale": True}
                cases.append({"label": clip_name, "clipFile": relative, "frame": frame, "input": inp,
                              "output": kernel.evaluate(inp["localHex"],inp["rootHex"],True)})
        print(json.dumps({"actor": rig["actor"], "joints": len(graph["joints"]), "casesSoFar": len(cases)}), flush=True)
    metadata = {"schema":1, "build":kernel.profile["clientVersion"], "protocol":kernel.profile["protocolDigest"],
        "sliceSha256":kernel.profile["sliceSha256"], "decoderImageSha256":kernel.profile["decoderImageSha256"],
        "runtimeSha256":sha((args.package.parent/"vendor/unicorn_x86_candidate.mjs").read_bytes()),
        "animationRigsSha256":sha(rig_raw), "animationPosesSha256":sha(pose_raw), "vfxSpawnSha256":kernel.profile["vfxSpawnSha256"],
        "constructorRva":0x15bc970, "worldPassRva":0x15852a0, "recursiveRva":0x15bdea0, "composeRva":0x1499680,
        "sourceBlocks":[{"startRva":a,"endRva":b,"sha256":sha(kernel.image[a:b])} for a,b in BLOCKS],
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in
            ["prepare-animation-world-poses.py","animation_world_pose_native.py","animation_rig_native.py","vfx_spawn_native.py"]},
        "graphs":graphs, "poseFiles":clips_used,
        "scope":"Original pose constructor and complete world-pose pass/recursive T-S-Q composition. Browser supplies the native-constructed static hierarchy and executes the original world pass. Local animation samples, root placement and scale-inheritance flag are supplied; sampled animation data uses LeagueToolkit, not the original ANM interpolator. No actor dirty/update scheduling, graph blending, dynamic bones, GPU skinning, rendered attachments or A/V fidelity claim."}
    raw = json.dumps(metadata,indent=2).encode()
    (args.package/"animation-world-poses.json").write_bytes(raw)
    kernel.profile["animationWorldPosesSha256"] = sha(raw)
    (args.package/"profile.json").write_text(json.dumps(kernel.profile,indent=2),encoding="utf-8")
    evidence = {"schema":1,"build":metadata["build"],"protocol":metadata["protocol"],"definitionSha256":sha(raw),
        "compilerSources":metadata["compilerSources"],"executedOriginalBlocks":list(kernel.blocks.values()),"cases":cases,"scope":metadata["scope"]}
    args.evidence.write_text(json.dumps(evidence,indent=2),encoding="utf-8")
    print(json.dumps({"rigs":len(graphs),"cases":len(cases),"jointPoses":sum(len(c["input"]["localHex"]) for c in cases),
                      "originalBlocks":len(kernel.blocks),"sha256":sha(raw)}))


if __name__ == "__main__":
    main()
