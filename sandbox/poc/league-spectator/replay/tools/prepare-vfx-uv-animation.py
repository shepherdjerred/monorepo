"""Prepare static UV-only graphs; never reads a replay or loads game textures."""
import argparse
from collections import Counter
import json
from pathlib import Path

from vfx_spawn_native import ADDRESSES as A, sha
from vfx_uv_animation_native import NativeUvAnimation, UvAdmissionError, EXTRA, BLOCKS, project, controlled_inputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "effects"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeUvAnimation(args.package, args.client)
    kernel.checked_json("vfx-uv.json", "vfxUvSha256")
    raw_manifest = (args.effects / "manifest.json").read_bytes()
    manifest = json.loads(raw_manifest)
    folder = args.package / "vfx-uv-animation-graphs"
    folder.mkdir(exist_ok=True)
    templates, bindings, rejected, cache = [], [], [], {}
    for effect_id, ref in sorted(manifest["definitions"].items()):
        path = (args.effects / ref["file"]).resolve()
        if not path.is_relative_to(args.effects.resolve()):
            raise ValueError("UV animation source outside effects package")
        raw = path.read_bytes()
        if sha(raw) != ref["sha256"]:
            raise ValueError("UV animation source definition hash mismatch")
        definition = json.loads(raw)["definition"]
        for index, emitter in enumerate(definition.get("complexEmitterDefinitionData", [])):
            value = project(emitter)
            key = sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())
            if key not in cache:
                try:
                    graph = kernel.assemble(value)
                except UvAdmissionError as error:
                    cache[key] = {"rejection": str(error)}
                else:
                    graph.update({"build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"]})
                    graph_bytes = json.dumps(graph, separators=(",", ":"), allow_nan=False).encode()
                    digest = sha(graph_bytes)
                    name = f"vfx-uv-animation-graphs/{digest}.json"
                    (args.package / name).write_bytes(graph_bytes)
                    cache[key] = {"graphSha256": digest}
                    templates.append({"sha256": digest, "file": name, "bytes": len(graph_bytes), "flags": graph["flags"]})
            item = {"effectId": effect_id, "emitterIndex": index, "sourceDefinitionSha256": sha(raw), **cache[key]}
            (rejected if "rejection" in item else bindings).append(item)
    controlled_bindings = []
    for case_id, value in controlled_inputs():
        key = sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())
        if key not in cache:
            graph = kernel.assemble(value)
            graph.update({"build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"]})
            graph_bytes = json.dumps(graph, separators=(",", ":"), allow_nan=False).encode()
            digest = sha(graph_bytes)
            name = f"vfx-uv-animation-graphs/{digest}.json"
            (args.package / name).write_bytes(graph_bytes)
            cache[key] = {"graphSha256": digest}
            templates.append({"sha256": digest, "file": name, "bytes": len(graph_bytes), "flags": graph["flags"]})
        controlled_bindings.append({"id": case_id, **cache[key]})
    globals_value = [{"rva": 0x256c9c0, "bytesHex": bytes(kernel.u.mem_read(kernel.base+0x256c9c0, 0x180)).hex()}]
    result = {
        "schema": 1, "build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"],
        "decoderImageSha256": kernel.profile["decoderImageSha256"], "sliceSha256": kernel.profile["sliceSha256"],
        "runtimeSha256": "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
        "vfxUvSha256": kernel.profile["vfxUvSha256"], "vfxBirthSha256": kernel.profile["vfxBirthSha256"],
        "effectsManifestSha256": sha(raw_manifest), "birthBlock": [0x175abce, 0x175affb],
        "matrixFunctions": {"base": 0x175fae0, "mult": 0x175fec0},
        "integratedPostLoad": {"floatRva": 0x177f5b0, "vector2Rva": 0x177f6e0, "sampleCount": 64},
        "addresses": {"definition": A["definition"], "link": A["link"], "actor": A["actor"], **EXTRA},
        "stackAddress": A["stack"], "initializedGlobals": globals_value,
        "mathImports": {"_modff": 0x1feea6e, "___sincosf_stret": 0x1fee66c},
        "additionalFieldLayout": kernel.extra_layout, "templates": templates, "bindings": bindings, "rejected": rejected,
        "controlledBindings": controlled_bindings,
        "coverage": {"emitters": len(bindings)+len(rejected), "admittedUvProjections": len(bindings),
                     "uniqueGraphs": len(templates), "rejectedUvProjections": len(rejected),
                     "rejectionReasons": dict(Counter(v["rejection"] for v in rejected))},
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a, b in BLOCKS],
        "executedOriginalPreparationBlocks": list(kernel.blocks.values()),
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
                            ["prepare-vfx-uv-animation.py", "vfx_uv_animation_native.py", "vfx_uv_native.py", "vfx_spawn_native.py"]},
        "preparationAdapters": "Bounded owned allocator/memory services inherited from birth preparation; ___bzero additionally admitted only inside integrated post-load and only within one recorded allocation. Runtime permits only declared modff and sincosf imports, with no allocator/TLS/OS services.",
        "scope": "UV projections only, not complete emitters. Original birth fragment and complete base/mult matrix functions. Unbaked ordinary curves; integrated values execute original type post-load with 64-sample preparation. Explicit emitter age, particle age/normalized age/lifetime/shared chance. Flex channels and cached UV scale modifiers unsupported. No replay activation, atlas selection, texture sampling, shaders, GPU or game A/V claim."
    }
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-uv-animation.json").write_bytes(raw)
    profile = kernel.profile
    profile["vfxUvAnimationSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({**result["coverage"], "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
