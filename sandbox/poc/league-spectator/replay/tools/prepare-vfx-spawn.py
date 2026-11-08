"""Compile strictly admitted static native emitter graphs, without ROFL input."""
import argparse
import json
from pathlib import Path

from vfx_spawn_native import NativeSpawn, ADDRESSES, SERVICES, VECTORS, admissible, field_layout, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "effects"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeSpawn(args.package, args.client)
    profile = kernel.profile
    manifest_bytes = (args.effects / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    templates, rejected, emitter_count = [], 0, 0
    output = args.package / "vfx-spawn-graphs"
    output.mkdir(exist_ok=True)
    for effect_id, reference in sorted(manifest["definitions"].items()):
        path = (args.effects / reference["file"]).resolve()
        if not path.is_relative_to(args.effects.resolve()):
            raise ValueError("Effect source outside package")
        raw = path.read_bytes()
        if sha(raw) != reference["sha256"]:
            raise ValueError("Effect definition hash mismatch")
        definition = json.loads(raw)["definition"]
        for index, emitter in enumerate(definition.get("complexEmitterDefinitionData", [])):
            emitter_count += 1
            if not admissible(emitter):
                rejected += 1
                continue
            graph = kernel.prepare(emitter)
            graph.update({"build": profile["clientVersion"], "protocol": profile["protocolDigest"],
                          "effectId": effect_id, "emitterIndex": index,
                          "sourceDefinitionSha256": sha(raw)})
            graph_bytes = json.dumps(graph, separators=(",", ":"), allow_nan=False).encode()
            digest = sha(graph_bytes)
            (output / f"{digest}.json").write_bytes(graph_bytes)
            templates.append({"effectId": effect_id, "emitterIndex": index, "emitterName": emitter.get("emitterName"),
                              "sourceDefinitionSha256": sha(raw), "file": f"vfx-spawn-graphs/{digest}.json",
                              "sha256": digest, "bytes": len(graph_bytes)})
    if not templates:
        raise ValueError("No strictly admitted native spawn graphs")
    result = {
        "schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": sha(kernel.source.binary), "decoderImageSha256": sha(kernel.image),
        "runtimeSha256": "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
        "vfxBirthSha256": profile["vfxBirthSha256"], "vfxValuesSha256": profile["vfxValuesSha256"],
        "effectsManifestSha256": sha(manifest_bytes), "addresses": ADDRESSES,
        "birthRva": 0x1758a70, "insertRva": 0x175bac0, "runtimeConstructorBlock": [0x1756780, 0x1756a26],
        "mathInitializationBlock": [0x14aa3bf, 0x14aa516], "managerPointerRva": 0x246dfd0,
        "seedRva": 0x14910e0, "rngVtableRva": 0x234b720,
        "tls": kernel.birth_meta["random"]["tls"], "services": SERVICES,
        "mathImports": {name: at for at, name in kernel.source.imports.items() if name in
                        ["___sincosf_stret", "_sinf", "_cosf", "_sqrtf", "_acosf", "_atan2f", "_fmodf", "_powf"]},
        "importRvas": list(kernel.source.imports),
        "vectors": VECTORS, "maximumBirthsPerStep": 1000, "maximumPoolSize": 4096,
        "fieldLayout": field_layout(kernel.source.image), "templates": templates,
        "coverage": {"examinedEmitters": emitter_count, "admitted": len(templates), "rejected": rejected},
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes())
                            for name in ["prepare-vfx-spawn.py", "vfx_spawn_native.py"]},
        "executedOriginalPreparationBlocks": list(kernel.blocks.values()),
        "scope": "Complete native birth and pool insertion for strictly admitted point/CameraTrail static graphs with owned inputs. Constructor prefix excludes material acquisition. Bounded monotonic allocator, owned TLS, supplied libm and system inputs are explicit adapters. No pool ageing/removal, native frame scheduling, original match seed/call order, attachment, shader or browser/League A/V proof."
    }
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-spawn.json").write_bytes(raw)
    profile["vfxSpawnSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": sha(raw), "coverage": result["coverage"], "templates": templates}))


if __name__ == "__main__":
    main()
