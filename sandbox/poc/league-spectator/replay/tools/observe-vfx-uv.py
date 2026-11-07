"""Run original UV admission code on controlled inputs and prepared emitters."""
import argparse
import json
from pathlib import Path
import random

from vfx_spawn_native import sha
from vfx_uv_native import NativeUv, FIELDS


def project(emitter):
    result = {name: value for name, value in emitter.items() if name in FIELDS["base"]}
    if "textureMult" in emitter:
        result["textureMult"] = {name: value for name, value in emitter["textureMult"].items()
                                 if name in FIELDS["mult"] or name == "__type"}
    return result


def controlled():
    yield "defaults", {}
    yield "empty-secondary", {"textureMult": {"__type": "VfxTextureMultDefinitionData"}}
    for group, fields in FIELDS.items():
        for name, (_, width, kind, default) in fields.items():
            variants = []
            if width == -1:
                variants = [False, True, 0, 1]
            elif width == 0:
                variants = [{"__type": kind}, {"__type": kind, "mValue": {"__type": "ValueVector2", "constantValue": [1, 0]}},
                            {"__type": kind, "mValue": {"__type": "ValueVector2", "dynamics": {"__type": "VfxAnimatedVector2fVariableData"}}}]
            else:
                values = [default, 0, -0.0, 1, -1, 1e-50, 1e-45, 1+1e-8, 1+1e-6, -123.125]
                for lane in range(width):
                    for value in values:
                        lanes = [default]*width
                        lanes[lane] = value
                        variants.append({"__type": kind, "constantValue": lanes[0] if width == 1 else lanes})
                variants.append({"__type": kind, "dynamics": {"__type": "VfxAnimatedFloatVariableData" if width == 1 else "VfxAnimatedVector2fVariableData"}})
            for index, value in enumerate(variants):
                obj = {name: value}
                if group == "mult":
                    obj = {"textureMult": {"__type": "VfxTextureMultDefinitionData", **obj}}
                yield f"{group}/{name}/{index}", obj
    rng = random.Random(0x16e1d6d)
    for index in range(256):
        obj = {}
        for group, fields in FIELDS.items():
            target = obj if group == "base" else {"__type": "VfxTextureMultDefinitionData"}
            for name, (_, width, kind, default) in fields.items():
                if rng.random() > .2:
                    continue
                if width == -1:
                    target[name] = bool(rng.getrandbits(1))
                elif width == 0:
                    target[name] = {"__type": kind}
                else:
                    lanes = [rng.choice([0, 1, -1, default]) for _ in range(width)]
                    target[name] = {"__type": kind, "constantValue": lanes[0] if width == 1 else lanes}
            if group == "mult":
                obj["textureMult"] = target
        yield f"mixed/{index}", obj


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "effects", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeUv(args.package, args.client)
    kernel.checked_json("vfx-uv.json", "vfxUvSha256")
    cases = [{"id": name, "input": obj, "flags": kernel.evaluate(obj)} for name, obj in controlled()]
    raw_manifest = (args.effects / "manifest.json").read_bytes()
    manifest = json.loads(raw_manifest)
    assets, histogram, heuristic_disagreements = [], {}, 0
    for effect_id, reference in sorted(manifest["definitions"].items()):
        path = (args.effects / reference["file"]).resolve()
        if not path.is_relative_to(args.effects.resolve()):
            raise ValueError("UV source outside effects package")
        raw = path.read_bytes()
        if sha(raw) != reference["sha256"]:
            raise ValueError("UV source definition hash mismatch")
        definition = json.loads(raw)["definition"]
        for index, emitter in enumerate(definition.get("complexEmitterDefinitionData", [])):
            input_value = project(emitter)
            flags = kernel.evaluate(input_value)
            key = f'{int(flags["base"])}{int(flags["mult"])}'
            histogram[key] = histogram.get(key, 0)+1
            heuristic_disagreements += flags["base"] != ("birthUVOffset" in emitter)
            assets.append({"effectId": effect_id, "emitterIndex": index, "emitterName": emitter.get("emitterName"),
                           "sourceDefinitionSha256": sha(raw), "input": input_value, "flags": flags})
    result = {
        "schema": 1, "build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"],
        "definitionSha256": kernel.profile["vfxUvSha256"], "decoderImageSha256": kernel.profile["decoderImageSha256"],
        "effectsManifestSha256": sha(raw_manifest), "cases": cases, "assets": assets,
        "summary": {"controlledCases": len(cases), "emitters": len(assets), "recordFlagsHistogram": histogram,
                    "birthUVOffsetPresenceDisagreements": heuristic_disagreements},
        "originalBlocks": list(kernel.blocks.values()), "services": kernel.services,
        "sourceFiles": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
                        ["observe-vfx-uv.py", "vfx_uv_native.py", "vfx_spawn_native.py"]},
        "scope": "UV record admission only, not UV evolution or visual fidelity. Prepared authored constants and pointer presence supplied to pristine native link predicate. No replay, GPU, League process or browser."
    }
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({**result["summary"], "originalBlocks": len(kernel.blocks), "sha256": sha(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
