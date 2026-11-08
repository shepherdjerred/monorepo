"""Prepare exact-build parent scheduler/default identities, without reading ROFL."""
import argparse
import json
from pathlib import Path
import struct

from vfx_spawn_native import NativeSpawn, sha, name_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "effects"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeSpawn(args.package, args.client)
    profile = kernel.profile
    emitter = kernel.checked_json("vfx-emitter.json", "vfxEmitterSha256")
    effects_bytes = (args.effects / "manifest.json").read_bytes()
    effects = json.loads(effects_bytes)
    templates = []
    allowed = {"__type", "particleName", "particlePath", "objectPath", "complexEmitterDefinitionData", "simpleEmitterDefinitionData"}
    for reference in emitter["templates"]:
        path = (args.effects / effects["definitions"][reference["effectId"]]["file"]).resolve()
        if not path.is_relative_to(args.effects.resolve()):
            raise ValueError("System asset outside effects package")
        raw = path.read_bytes()
        if sha(raw) != reference["sourceDefinitionSha256"]:
            raise ValueError("System source definition mismatch")
        definition = json.loads(raw)["definition"]
        if definition.get("__type") != "VfxSystemDefinitionData" or set(definition)-allowed:
            continue
        templates.append({**reference, "omittedComplexSiblings": len(definition.get("complexEmitterDefinitionData", []))-1,
                          "omittedSimpleEmitters": len(definition.get("simpleEmitterDefinitionData", [])),
                          "rootPresentationMetadataOnly": sorted(set(definition)-{"__type", "complexEmitterDefinitionData", "simpleEmitterDefinitionData"})})
    if not templates:
        raise ValueError("No admitted native system roots")
    initializers = [
        {"startRva": 0x17608c4, "endRva": 0x1760a6b, "registers": {"RBX": "system", "R12": "resource", "RBP": 0}},
        {"startRva": 0x1760aae, "endRva": 0x1760ae1, "registers": {"RBX": "system", "R13": "manager"}},
        {"startRva": 0x1760b05, "endRva": 0x1760b0e, "registers": {"RBX": "system"}},
        {"startRva": 0x1745577, "endRva": 0x1745581, "registers": {"RBX": "manager"}},
        {"startRva": 0x1745693, "endRva": 0x17456a3, "registers": {"RBX": "manager"}},
    ]
    blocks = [(0x16e7640, 0x16e76f6), (0x1786e20, 0x1786e44), (0x1779b60, 0x1779cbd),
              (0x1762430, 0x17625e8), (0x1763220, 0x1763b40), (0x174bbb3, 0x174bbd5),
              (0x174bc15, 0x174bc8d), (0x17567a6, 0x17567b7), (0x17456b4, 0x17456cc)]
    blocks += [(block["startRva"], block["endRva"]) for block in initializers]
    for start, end in blocks:
        if kernel.image[start:end] != kernel.source.image[start:end]:
            raise ValueError("System code differs from pristine client")
    if struct.unpack_from("<I", kernel.image, 0x16e7698)[0] != name_hash("VfxSystemDefinitionData"):
        raise ValueError("System class registration changed")
    if 0x1786e3c + struct.unpack_from("<i", kernel.image, 0x1786e38)[0] != 0x1779b60:
        raise ValueError("System constructor binding changed")
    if struct.unpack_from("<Q", kernel.image, 0x1779c3f)[0] != 0x100d40000:
        raise ValueError("System default flags changed")
    quality = kernel.image[0x20ca070:0x20ca088]
    if list(struct.unpack("<ffffff", quality)) != [1, 1, 1, 1, 1, 0]:
        raise ValueError("Native quality constants changed")
    result = {"schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
              "decoderImageSha256": profile["decoderImageSha256"], "sliceSha256": profile["sliceSha256"],
              "runtimeSha256": emitter["runtimeSha256"], "vfxEmitterSha256": profile["vfxEmitterSha256"],
              "tickRva": 0x1763220, "rootConstructorRva": 0x1779b60, "basisRva": 0x1762430,
              "nativeRootFlags": 0xd4, "nativeTickRate": 30, "nativeMaxSubsteps": 20,
              "nativeQualityMultipliersHex": quality.hex(), "initializers": initializers,
              "actorListAddress": 0x1002f000, "positionInputAddress": 0x1002f008, "basisInputAddress": 0x1002f018,
              "effectsManifestSha256": sha(effects_bytes), "templates": templates,
              "sourceBlocks": [{"startRva": start, "endRva": end, "sha256": sha(kernel.image[start:end])} for start, end in blocks],
              "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in ["prepare-vfx-system.py", "vfx_system_native.py"]},
              "scope": "Original parent scheduler with native root/numeric defaults on one selected point/CameraTrail emitter. Caller supplies resolved creation clock/position, host clocks, current position, smoothing quality and substep budget. Siblings, attachments, material/audio registration, original replay clock/pose binding and global/thread RNG order are unimplemented. CPU state and geometry evidence, not rendered-game A/V proof."}
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-system.json").write_bytes(raw)
    profile["vfxSystemSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": sha(raw), "templates": len(templates)}))


if __name__ == "__main__":
    main()
