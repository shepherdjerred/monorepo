"""Prepare static geometry/lifecycle projections for original legacy quads."""
import argparse
import json
from pathlib import Path

from vfx_legacy_quad_native import NativeLegacyQuad, QuadProjectionError
from vfx_spawn_native import sha
from vfx_emitter_native import GEOMETRY


SOURCES = ["prepare-vfx-legacy-quads.py", "vfx_legacy_quad_native.py", "vfx_spawn_native.py",
           "vfx_emitter_native.py", "vfx_uv_native.py"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "effects"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    k = NativeLegacyQuad(args.package, args.client)
    manifest_raw = (args.effects/"manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest["build"] != k.profile["clientVersion"] or manifest["protocol"] != k.profile["protocolDigest"]:
        raise ValueError("Legacy quad effect manifest mismatch")
    output = args.package/"vfx-legacy-quad-graphs"
    output.mkdir(exist_ok=True)
    templates, rejected = [], []
    for effect_id, reference in sorted(manifest["definitions"].items()):
        path = (args.effects/reference["file"]).resolve()
        if not path.is_relative_to(args.effects.resolve()):
            raise ValueError("Effect outside package")
        raw = path.read_bytes()
        if sha(raw) != reference["sha256"]:
            raise ValueError("Legacy quad effect hash mismatch")
        for index, emitter in enumerate(json.loads(raw)["definition"].get("complexEmitterDefinitionData", [])):
            try:
                graph = k.prepare_quad(emitter)
            except QuadProjectionError as error:
                rejected.append({"effectId": effect_id, "emitterIndex": index, "reason": str(error)})
                continue
            graph.update({"build": k.profile["clientVersion"], "protocol": k.profile["protocolDigest"],
                          "effectId": effect_id, "emitterIndex": index, "sourceDefinitionSha256": sha(raw)})
            data = json.dumps(graph, separators=(",", ":"), allow_nan=False).encode()
            digest = sha(data)
            (output/f"{digest}.json").write_bytes(data)
            templates.append({"effectId": effect_id, "emitterIndex": index, "name": emitter.get("emitterName"),
                              "sourceDefinitionSha256": sha(raw), "sha256": digest,
                              "file": f"vfx-legacy-quad-graphs/{digest}.json", "bytes": len(data)})
    if not templates:
        raise ValueError("No admitted legacy quad projections")
    spawn = k.checked_json("vfx-spawn.json", "vfxSpawnSha256")
    metadata = {"schema": 1, "build": k.profile["clientVersion"], "protocol": k.profile["protocolDigest"],
                "sliceSha256": k.profile["sliceSha256"], "decoderImageSha256": k.profile["decoderImageSha256"],
                "runtimeSha256": spawn["runtimeSha256"], "vfxSpawnSha256": k.profile["vfxSpawnSha256"],
                "vfxEmitterSha256": k.profile["vfxEmitterSha256"], "vfxQuadVerticesSha256": k.profile["vfxQuadVerticesSha256"],
                "effectsManifestSha256": sha(manifest_raw), "fieldLayout": k.layout,
                "frameRva": 0x1757f10, "writerRva": 0x1730410,
                "shapeConstructorRva": 0x17951d0, "primitiveConstructorRva": 0x17a6390,
                "geometryAddresses": GEOMETRY, "maximumParticles": 1024,
                "checkpointLayout": {"ownedAddress": 0x10020000, "ownedBytes": 0x10000,
                                     "heapAddress": 0x10400000, "heapLimit": 0x12000000,
                                     "globals": [{"rva": 0x2516698, "bytes": 8}]},
                "uvScratchAddress": 0x1002f000,
                "initializedGlobals": k.trails["initializedGlobals"], "templates": templates,
                "coverage": {"admitted": len(templates), "rejected": len(rejected)}, "rejected": rejected,
                "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in SOURCES},
                "executedOriginalPreparationBlocks": list(k.blocks.values()),
                "scope": "Original legacy-shape birth, complete emitter update/removal and arbitrary-quad vertex writer on explicit clocks, seeds, poses and system bases. Strict geometry/lifecycle projections; UV records/materials/textures excluded. Full actor constructor/material acquisition, replay binding, original seed/call order, shaders, GPU, browser and League A/V unverified."}
    raw = json.dumps(metadata, indent=2).encode()
    (args.package/"vfx-legacy-quads.json").write_bytes(raw)
    k.profile["vfxLegacyQuadsSha256"] = sha(raw)
    (args.package/"profile.json").write_text(json.dumps(k.profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": sha(raw), "coverage": metadata["coverage"]}))


if __name__ == "__main__":
    main()
