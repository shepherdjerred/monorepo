"""Execute original UV functions on prepared graphs and supplied particle ages."""
import argparse
import json
from pathlib import Path
import struct

import unicorn
from vfx_spawn_native import sha
from vfx_uv_animation_native import NativeUvAnimation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeUvAnimation(args.package, args.client)
    meta = kernel.checked_json("vfx-uv-animation.json", "vfxUvAnimationSha256")
    writes = []
    kernel.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, lambda uc, kind, at, size, value, user: writes.append({"rva": at-kernel.base, "bytes": size}),
                      begin=kernel.base, end=kernel.base+len(kernel.image)-1)
    cases = []
    births = samples = matrices = math_calls = 0
    for reference in meta["templates"]:
        raw = (args.package / reference["file"]).read_bytes()
        if sha(raw) != reference["sha256"]:
            raise ValueError("UV observation graph hash mismatch")
        graph = json.loads(raw)
        for emitter_age, chance, lifetime in [(0, 0, .75), (.65, .6875, 1.25)]:
            kernel.restore_graph(graph)
            kernel.services.clear()
            birth_input = {"emitterAge": emitter_age, "chance": chance}
            birth = kernel.birth(birth_input)
            if kernel.services:
                raise ValueError("Unexpected UV runtime service")
            frames = []
            for age in [0, .125, .375, .75, 1.125, .375]:
                value = {"age": age, "normalizedAge": min(1, age/lifetime), "lifetime": lifetime, "chance": chance}
                actual = kernel.sample(birth["records"], value)
                frames.append({"input": value, "output": actual})
                samples += 1
                matrices += sum(v is not None for v in actual["matrices"].values())
                math_calls += len(actual["mathCalls"])
            if writes or kernel.services:
                raise ValueError(f"Unexpected UV global write or service: {writes}, {kernel.services}")
            cases.append({"graphSha256": reference["sha256"], "birthInput": birth_input, "birth": birth, "frames": frames})
            births += 1
    result = {
        "schema": 1, "build": kernel.profile["clientVersion"], "protocol": kernel.profile["protocolDigest"],
        "definitionSha256": kernel.profile["vfxUvAnimationSha256"], "decoderImageSha256": kernel.profile["decoderImageSha256"],
        "cases": cases, "summary": {"graphs": len(meta["templates"]), "births": births, "samples": samples,
                                     "matrices": matrices, "mathCalls": math_calls, "executableGlobalWrites": len(writes)},
        "originalBlocks": list(kernel.blocks.values()),
        "sourceFiles": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
                        ["observe-vfx-uv-animation.py", "vfx_uv_animation_native.py", "vfx_uv_native.py", "vfx_spawn_native.py"]},
        "scope": meta["scope"],
    }
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({**result["summary"], "originalBlocks": len(kernel.blocks), "sha256": sha(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
