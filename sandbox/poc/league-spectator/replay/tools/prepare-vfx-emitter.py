"""Bind complete native emitter frame/removal and trail geometry, without ROFL input."""
import argparse
import json
from pathlib import Path

from vfx_spawn_native import NativeSpawn, sha
from vfx_emitter_native import GEOMETRY


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeSpawn(args.package, args.client)
    profile = kernel.profile
    spawn = kernel.checked_json("vfx-spawn.json", "vfxSpawnSha256")
    trails = kernel.checked_json("vfx-trails.json", "vfxTrailsSha256")
    blocks = [(0x1757f10, 0x1758680), (0x175cac0, 0x175cbf3), (0x175d030, 0x175d7f0),
              (0x175d890, 0x175e880), (0x175e880, 0x175ee60), (0x175ee60, 0x175fae0)]
    for start, end in blocks:
        if kernel.image[start:end] != kernel.source.image[start:end]:
            raise ValueError("Emitter frame code differs from pristine client")
    if kernel.source.imports[0x1feea6e] != "_modff" or kernel.source.imports[0x1fee81c] != "_expf":
        raise ValueError("Emitter math import identity changed")
    result = {"schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
              "decoderImageSha256": profile["decoderImageSha256"], "sliceSha256": profile["sliceSha256"],
              "runtimeSha256": spawn["runtimeSha256"], "vfxSpawnSha256": profile["vfxSpawnSha256"],
              "vfxTrailsSha256": profile["vfxTrailsSha256"], "frameRva": 0x1757f10, "writerRva": 0x1737570,
              "poolUpdateRva": 0x175cac0, "removalRva": 0x175d030, "maximumPoints": 1024,
              "geometryAddresses": GEOMETRY, "initializedGlobals": trails["initializedGlobals"],
              "additionalMathImports": {"_modff": 0x1feea6e, "_expf": 0x1fee81c},
              "checkpointLayout": {"ownedAddress": 0x10020000, "ownedBytes": 0x10000,
                                   "heapAddress": 0x10400000, "heapLimit": 0x12000000,
                                   "globals": [{"rva": kernel.birth_meta["random"]["seedStorageRva"], "bytes": 8}]},
              "templates": spawn["templates"],
              "sourceBlocks": [{"startRva": start, "endRva": end, "sha256": sha(kernel.image[start:end])} for start, end in blocks],
              "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes())
                                  for name in ["prepare-vfx-emitter.py", "vfx_emitter_native.py"]},
              "ownedInputs": "Identity system/root transforms; unit system scale/color and six quality multipliers; no mesh/bone/attachments or material acquisition; smoothing quality explicit; elapsed emitter clock and poses supplied",
              "scope": "Whole original emitter frame, pool update/removal and CPU CameraTrail geometry for three admitted static graphs. Controlled clock/seed/poses and supplied external math, allocator and TLS. Original replay activation/clock/random order, threads, attachments, full primitive/material/shader system and browser/League A/V remain unverified."}
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-emitter.json").write_bytes(raw)
    profile["vfxEmitterSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": sha(raw), "templates": len(result["templates"])}))


if __name__ == "__main__":
    main()
