"""Compile static bone bindings from original rig construction, not inferred IDs."""
import argparse
import json
from pathlib import Path
import struct

from animation_rig_native import NativeAnimationRig, BLOCKS
from vfx_spawn_native import sha, name_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "scene", "libcpp_source", "evidence"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeAnimationRig(args.package, args.client)
    scene_raw = (args.scene / "manifest.json").read_bytes()
    scene = json.loads(scene_raw)
    world_raw = (args.scene / scene["world"]).read_bytes()
    world = json.loads(world_raw)
    if scene["build"] != kernel.profile["clientVersion"] or scene["protocol"] != kernel.profile["protocolDigest"]:
        raise ValueError("Rig source build mismatch")
    contract = args.libcpp_source.read_bytes()
    if b"If n == 0, returns 0.  Else returns the lowest prime number that" not in contract:
        raise ValueError("Unsupported libc++ prime helper contract source")
    assets = [("champions/"+key, value) for key,value in scene["champions"].items()]
    assets += [("world/"+key, value) for key,value in world["assets"].items() if value.get("animationGraph") and value.get("animationCatalog")]
    graphs, observations = {}, []
    for actor, asset in assets:
        catalog_raw = (args.scene / asset["animationCatalog"]).read_bytes()
        catalog = json.loads(catalog_raw)
        rig_file = (Path(asset["animationCatalog"]).parent / "model.skl").as_posix()
        raw = (args.scene / rig_file).read_bytes()
        try:
            observed = kernel.prepare(raw, catalog["joints"])
        except ValueError as error:
            raise ValueError(f"{actor}: {error}") from error
        offset = struct.unpack_from("<i", raw, 20)[0]
        for i,joint in enumerate(observed["joints"]):
            stored = struct.unpack_from("<I", raw, offset+i*100+8)[0]
            if stored != joint["resolvedBoneKey"] or name_hash(joint["name"]) != joint["fnvHash"]:
                raise ValueError("Native bone namespaces differ from static source")
        graphs[asset["animationGraph"]] = {"actor": actor, "rigFile": rig_file, "rigSha256": sha(raw),
            "catalogFile": asset["animationCatalog"], "catalogSha256": sha(catalog_raw),
            "joints": observed["joints"], "bindings": [{k:v for k,v in q.items() if k != "outputs"} for q in observed["queries"]],
            "primaryBuckets": observed["primaryBuckets"], "secondaryBuckets": observed["secondaryBuckets"]}
        observations.append({"actor": actor, "graph": asset["animationGraph"], "rigSha256": sha(raw), **observed})
    metadata = {"schema": 1, "build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"],
        "sliceSha256": kernel.profile["sliceSha256"], "decoderImageSha256": kernel.profile["decoderImageSha256"],
        "constructorRva": 0x15b3cc0, "jointConstructorRva": 0x15b4130, "mapBuilderRva": 0x15b4330,
        "nameLookupRva": 0x157fe60, "fnvPoseLookupRva": 0x157f940, "keyPoseLookupRva": 0x157f5d0,
        "nextPrimeBoundary": {"symbol": "__ZNSt3__112__next_primeEm", "rva": 0x1fee34e,
            "maximumInput": 65536, "contractSourceSha256": sha(contract), "source": "Cached Emscripten 4.0.22 libc++ src/hash.cpp"},
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a,b in BLOCKS],
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
            ["prepare-animation-rigs.py", "animation_rig_native.py", "vfx_spawn_native.py"]},
        "sceneManifestSha256": sha(scene_raw), "worldCatalogSha256": sha(world_raw), "graphs": graphs,
        "scope": "Original complete SKL v0 constructor, joint conversion and FNV/ELF map builders. FNV names resolve to stored ELF keys; both original transform getters are observed on supplied pose buffers. Duplicate-name selection is retained explicitly. Allocation/copy services and bounded libc++ next-prime are explicit boundaries. Native world-pose production, dynamic bones, transforms across forms, particles and A/V remain unverified."}
    raw = json.dumps(metadata, indent=2).encode()
    (args.package / "animation-rigs.json").write_bytes(raw)
    kernel.profile["animationRigsSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(kernel.profile, indent=2), encoding="utf-8")
    evidence = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"], "definitionSha256": sha(raw),
        "compilerSources": metadata["compilerSources"], "nextPrimeCalls": kernel.prime_calls,
        "executedOriginalBlocks": list(kernel.blocks.values()), "observations": observations, "scope": metadata["scope"]}
    args.evidence.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({"rigs": len(graphs), "joints": sum(len(g["joints"]) for g in graphs.values()),
        "originalBlocks": len(kernel.blocks), "primeCalls": len(kernel.prime_calls), "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
