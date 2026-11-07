"""Join serialized event bone hashes to rigs and observe native binding requests."""
import argparse
from collections import Counter
import importlib.metadata
import io
import itertools
import json
import os
from pathlib import Path
import runpy
import struct

from animation_attachment_native import NativeAnimationAttachment, BLOCKS, OWNED, CALLBACKS
from vfx_spawn_native import sha, name_hash


def elf_hash(value):
    result = 0
    for byte in value.lower().encode("ascii"):
        result = ((result << 4)+byte) & 0xffffffff
        high = result & 0xf0000000
        result ^= high >> 24
        result &= ~high
    return result


def hash_value(value):
    if value is None:
        return 0
    if value.startswith("{") and value.endswith("}"):
        return int(value[1:-1], 16)
    return name_hash(value)


def rig_joints(raw, names):
    size, token, version = struct.unpack_from("<III", raw)
    if size != len(raw) or token != 0x22fd4fc3 or version != 0:
        raise ValueError("Unprepared SKL resource")
    count = struct.unpack_from("<H", raw, 14)[0]
    offset = struct.unpack_from("<i", raw, 20)[0]
    if count != len(names) or not 0 < offset <= len(raw)-count*100:
        raise ValueError("Rig/catalog bounds mismatch")
    joints = []
    for index in range(count):
        at = offset+index*100
        flags, joint_id, parent_id, _, stored_hash = struct.unpack_from("<HhhhI", raw, at)
        name_at = at+96+struct.unpack_from("<i", raw, at+96)[0]
        if not 0 <= name_at < len(raw):
            raise ValueError("Rig joint name outside resource")
        end = raw.find(b"\0", name_at, min(name_at+1024, len(raw)))
        if end < 0:
            raise ValueError("Unterminated rig joint name")
        name = raw[name_at:end].decode("ascii")
        if name != names[index] or stored_hash != elf_hash(name):
            raise ValueError("Rig joint name/hash differs from catalog")
        joints.append({"name": name, "poseJointIndex": index, "rigId": joint_id, "parentId": parent_id,
                       "fnvHash": name_hash(name), "elfHash": stored_hash})
    if len({j["fnvHash"] for j in joints}) != len(joints):
        raise ValueError("Ambiguous event bone name hash")
    return joints


def lookup(value, path):
    for key in path:
        if isinstance(value, list):
            value = value[key]
        elif key in value:
            value = value[key]
        else:
            value = value[f"{{{hash_value(key):08x}}}"]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "scene", "effects", "bins", "hashes", "evidence"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeAnimationAttachment(args.package, args.client)
    event_raw = (args.package / "animation-events.json").read_bytes()
    if sha(event_raw) != kernel.profile["animationEventsSha256"]:
        raise ValueError("Stale animation event inventory")
    event_meta = json.loads(event_raw)
    rig_package_raw = (args.package / "animation-rigs.json").read_bytes()
    if sha(rig_package_raw) != kernel.profile["animationRigsSha256"]:
        raise ValueError("Stale constructed rig binding package")
    rig_meta = json.loads(rig_package_raw)
    scene_raw = (args.scene / "manifest.json").read_bytes()
    effects_raw = (args.effects / "manifest.json").read_bytes()
    if sha(scene_raw) != event_meta["assets"]["sceneManifestSha256"] or sha(effects_raw) != event_meta["assets"]["effectsManifestSha256"]:
        raise ValueError("Attachment asset packages differ from event inventory")
    scene, effects = json.loads(scene_raw), json.loads(effects_raw)
    if rig_meta["sceneManifestSha256"] != sha(scene_raw):
        raise ValueError("Constructed rigs differ from attachment scene")
    source = json.loads(importlib.metadata.distribution("cdtb").read_text("direct_url.json"))
    if source["vcs_info"]["commit_id"] != "3367589fdd3ee3d0d01383d2f98dba12b04d1371":
        raise ValueError("Unprepared BIN parser source")
    os.environ["CDTB_HASHES_DIR"] = str(args.hashes.resolve())
    import cdtb.binfile as binfile
    names = runpy.run_path(str(Path(__file__).with_name("parse-latest-assets.py")))["names"]
    for dictionary, name in [(binfile.hashfile_binfields, "binfields"), (binfile.hashfile_bintypes, "bintypes")]:
        dictionary.hashes = names(args.hashes / f"hashes.{name}.txt")
    for dictionary in [binfile.hashfile_binentries, binfile.hashfile_binhashes,
                       binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}
    actors, parsed, groups, cases = {}, {}, [], []
    for actor_key in sorted({g["actor"] for g in event_meta["groups"]}):
        asset = scene["champions"][actor_key.removeprefix("champions/")]
        graph_raw = (args.scene / asset["animationGraph"]).read_bytes()
        graph = json.loads(graph_raw)
        roots = [k for k,v in graph.items() if isinstance(v, dict) and v.get("__type") == "AnimationGraphData"]
        if len(roots) != 1 or roots[0].startswith("{"):
            raise ValueError("Unprepared animation graph source path")
        path = "data/"+roots[0].lower()+".bin"
        provenance = [p for p in scene["provenance"] if p["path"].lower() == path]
        raw = (args.bins / (sha(path.encode())+".bin")).read_bytes()
        if len(provenance) != 1 or sha(raw) != provenance[0]["sha256"]:
            raise ValueError("Serialized animation graph differs from installed source")
        stream = io.BytesIO(raw)
        data = binfile.BinFile(stream)
        if data.is_patch or stream.tell() != len(raw):
            raise ValueError("Incomplete serialized animation graph")
        parsed[actor_key] = data.to_serializable()
        catalog_raw = (args.scene / asset["animationCatalog"]).read_bytes()
        catalog = json.loads(catalog_raw)
        rig_file = str(Path(asset["animationCatalog"]).parent / "model.skl").replace("\\", "/")
        rig_raw = (args.scene / rig_file).read_bytes()
        joints = rig_joints(rig_raw, catalog["joints"])
        actors[actor_key] = {"graphFile": asset["animationGraph"], "graphSha256": sha(graph_raw),
            "serializedGraph": {"path": path, "sha256": sha(raw)}, "rigFile": rig_file, "rigSha256": sha(rig_raw),
            "catalogSha256": sha(catalog_raw), "joints": joints}
        constructed = rig_meta["graphs"][asset["animationGraph"]]
        if constructed["rigSha256"] != sha(rig_raw) or constructed["catalogSha256"] != sha(catalog_raw):
            raise ValueError("Constructed rig/catalog differs from attachment input")
        by_hash = {j["fnvHash"]: j for j in constructed["bindings"]}
        for joint in joints:
            native = by_hash[joint["fnvHash"]]
            if native["resolvedBoneKey"] != joint["elfHash"] or native["poseJointIndex"] != joint["poseJointIndex"]:
                raise ValueError("Authored attachment rig requires explicit alias handling")
            joint["resolvedBoneKey"] = native["resolvedBoneKey"]
    statuses, authored_count = Counter(), 0
    for group in event_meta["groups"]:
        actor = actors[group["actor"]]
        joint_by_hash = {j["fnvHash"]: j for j in actor["joints"]}
        entries = []
        for event in group["events"]:
            raw_event = lookup(parsed[group["actor"]], [*group["path"], "mEventDataMap", event["id"]])
            authored = event["authored"]
            raw_pairs = raw_event.get("mParticleEventDataPairList", [])
            named_pairs = authored.get("mParticleEventDataPairList", [])
            if len(raw_pairs) != len(named_pairs) or f"{hash_value(raw_event.get('mEffectKey')):08x}" != event["effectKeyHash"]:
                raise ValueError("Serialized animation event/effect mismatch")
            pairs = []
            for raw_pair, named in zip(raw_pairs, named_pairs):
                pair = {}
                for field in ["mBoneName", "mTargetBoneName"]:
                    key = hash_value(raw_pair.get(field))
                    if key != hash_value(named.get(field)):
                        raise ValueError("Named event bone differs from serialized hash")
                    joint = joint_by_hash.get(key)
                    status = "root" if key == 0 else "static-rig-joint" if joint else "unresolved-static-bone"
                    statuses[status] += 1
                    pair[field] = {"hash": key, "status": status,
                        **({"name": joint["name"], "poseJointIndex": joint["poseJointIndex"]} if joint else {})}
                pairs.append(pair)
            entries.append({"id": event["id"], "pairs": pairs,
                "status": "unprepared-animation-speed-context" if authored.get("mScalePlaySpeedWithAnimation", False) else "request-component"})
            if authored.get("mScalePlaySpeedWithAnimation", False):
                continue
            afterimage = False
            if event["binding"]["status"] == "prepared-definition":
                definition = effects["definitions"][event["binding"]["effectId"]]
                definition_raw = (args.effects / definition["file"]).read_bytes()
                if sha(definition_raw) != definition["sha256"]:
                    raise ValueError("Effect definition changed")
                afterimage = json.loads(definition_raw)["definition"].get("mIsPoseAfterimage", False)
            value = {"effectKey": int(event["effectKeyHash"], 16), "ownerPositionHex": struct.pack("<3f", 100, 200, 300).hex(),
                "joints": [{"hash": j["fnvHash"], "resolvedBoneKey": j["resolvedBoneKey"],
                    "transformHex": struct.pack("<10f", i+.125, i*2+.25, -i-.5, 0,0,0,1,1,1,1).hex()}
                    for i,j in enumerate(actor["joints"])],
                "pairs": [[p["mBoneName"]["hash"], p["mTargetBoneName"]["hash"]] for p in pairs],
                "detachable": authored.get("mIsDetachable", False), "poseAfterimage": afterimage}
            kernel.reset(value)
            cases.append({"actor": group["actor"], "path": group["path"], "event": event["id"],
                "input": value, "activation": kernel.activate(), "cleanup": kernel.cleanup(), "emptyCleanup": kernel.cleanup()})
            authored_count += 1
        groups.append({"actor": group["actor"], "path": group["path"], "events": entries})
    # Boundary combinations include root/missing source, target attachment,
    # failed creation, suppression, detachment and pose-afterimage selection.
    for source_hash, target_hash, detach, afterimage, create, suppressed in itertools.product(
            [0, 0x1234, 0xffff], [0, 0x1234], [False, True], [False, True], [False, True], [False, True]):
        value = {"effectKey": 0x12345678, "ownerPositionHex": struct.pack("<3f", 100,200,300).hex(),
            "joints": [{"hash": 0x1234, "resolvedBoneKey": 0x87654321,
                "transformHex": struct.pack("<10f", 1,2,3,0,0,0,1,1,1,1).hex()}],
            "pairs": [[source_hash, target_hash]], "detachable": detach, "poseAfterimage": afterimage,
            "createSucceeds": create, "suppressed": suppressed, "effectScalar": .75}
        kernel.reset(value)
        cases.append({"actor": None, "input": value, "activation": kernel.activate(), "cleanup": kernel.cleanup(), "emptyCleanup": kernel.cleanup()})
    metadata = {"schema": 1, "build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"],
        "sliceSha256": kernel.profile["sliceSha256"], "decoderImageSha256": kernel.profile["decoderImageSha256"],
        "animationEventsSha256": sha(event_raw), "vfxSpawnSha256": kernel.profile["vfxSpawnSha256"],
        "animationRigsSha256": kernel.profile["animationRigsSha256"],
        "runtimeSha256": "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
        "activationRva": 0x1594d20, "cleanupRva": 0x1595510, "owned": OWNED, "callbacks": CALLBACKS,
        "fieldLayout": kernel.layout,
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a,b in BLOCKS],
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
            ["prepare-animation-attachments.py", "animation_attachment_native.py", "vfx_spawn_native.py", "vfx_uv_native.py", "parse-latest-assets.py"]},
        "dictionaries": {name: sha((args.hashes/f"hashes.{name}.txt").read_bytes()) for name in ["binfields", "bintypes"]},
        "actors": actors, "groups": groups, "boneBindings": dict(statuses),
        "scope": "Serialized event FNV hashes joined to original-constructed rig bindings. Authored cases use recovered ELF bone keys; controlled cases may supply synthetic keys. Original activation, lookup, attachment selection and cleanup execute on supplied rig maps, transforms and request sinks. Animation speed context, world pose production, effect creation and rendering remain unverified."}
    raw = json.dumps(metadata, indent=2).encode()
    (args.package / "animation-attachments.json").write_bytes(raw)
    kernel.profile["animationAttachmentsSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(kernel.profile, indent=2), encoding="utf-8")
    result = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"], "definitionSha256": sha(raw),
        "compilerSources": metadata["compilerSources"], "executedOriginalBlocks": list(kernel.blocks.values()),
        "cases": cases, "scope": metadata["scope"]}
    args.evidence.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"actors": len(actors), "events": sum(len(g["events"]) for g in groups), "boneBindings": dict(statuses),
        "authoredCases": authored_count, "cases": len(cases), "originalBlocks": len(kernel.blocks), "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
