"""Prepare exact-build UV record predicates and original constructor defaults."""
import argparse
import json
from pathlib import Path

from vfx_spawn_native import sha
from vfx_uv_native import NativeUv, BLOCKS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeUv(args.package, args.client)
    profile = kernel.profile
    # Exercise the lazy default mult initializer through the original predicate.
    if kernel.evaluate({}) != {"base": False, "mult": False}:
        raise ValueError("Unexpected native default UV records")
    result = {
        "schema": 1, "build": profile["clientVersion"], "protocol": profile["protocolDigest"],
        "sliceSha256": profile["sliceSha256"], "decoderImageSha256": profile["decoderImageSha256"],
        "predicateRva": 0x16e1d6d, "predicateEndRva": 0x16e1dbe,
        "linkFlagOffsets": [0xe8, 0xe9], "fieldLayout": kernel.layout,
        "defaultDefinitionHex": kernel.default_definition.hex(), "defaultMultHex": kernel.default_mult.hex(),
        "sourceBlocks": [{"startRva": a, "endRva": b, "sha256": sha(kernel.image[a:b])} for a, b in BLOCKS],
        "executedOriginalBlocks": list(kernel.blocks.values()),
        "compilerSources": {name: sha(Path(__file__).with_name(name).read_bytes())
                            for name in ["prepare-vfx-uv.py", "vfx_uv_native.py", "vfx_spawn_native.py"]},
        "scope": "Complex-emitter base/mult UV record admission only. Original numeric constructors, field registrations and link predicate. Dynamics represented by pointer presence, never sampled. No texture acquisition, atlas evaluation, UV evolution, material/shader binding or rendered A/V claim. Non-UV emitter fields are outside this predicate."
    }
    raw = json.dumps(result, indent=2).encode()
    (args.package / "vfx-uv.json").write_bytes(raw)
    profile["vfxUvSha256"] = sha(raw)
    (args.package / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": sha(raw), "fields": sum(map(len, kernel.layout.values()))}))


if __name__ == "__main__":
    main()
