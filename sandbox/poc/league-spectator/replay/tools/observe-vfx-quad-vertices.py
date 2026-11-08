"""Record original quad vertex/index buffers on controlled inputs."""
import argparse
import json
from pathlib import Path

import unicorn
from vfx_spawn_native import sha
from vfx_quad_native import NativeQuad, controlled


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeQuad(args.package, args.client)
    meta = kernel.checked_json("vfx-quad-vertices.json", "vfxQuadVerticesSha256")
    writes = []
    kernel.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, lambda uc, kind, at, count, value, user: writes.append({"rva": at-kernel.base, "bytes": count}),
                      begin=kernel.base, end=kernel.base+len(kernel.image)-1)
    cases = []
    vertices = indices = math_calls = 0
    for name, value in controlled():
        actual = kernel.render(value)
        vertices += len(value["particles"])*4
        indices += len(value["particles"])*6
        math_calls += len(actual["mathCalls"])
        cases.append({"id": name, "input": value, "output": actual})
    if writes:
        raise ValueError(f"Unexpected quad executable-global write {writes[:8]}")
    result = {"schema": 1, "build": meta["build"], "protocol": meta["protocol"],
              "definitionSha256": kernel.profile["vfxQuadVerticesSha256"], "decoderImageSha256": kernel.profile["decoderImageSha256"],
              "cases": cases, "summary": {"cases": len(cases), "vertices": vertices, "indices": indices, "mathCalls": math_calls,
                                         "executableGlobalWrites": len(writes)},
              "originalBlocks": list(kernel.blocks.values()),
              "observerSources": {name: sha(Path(__file__).with_name(name).read_bytes()) for name in
                                  ["observe-vfx-quad-vertices.py", "vfx_quad_native.py", "vfx_emitter_native.py", "vfx_spawn_native.py"]},
              "scope": meta["scope"]}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({**result["summary"], "originalBlocks": len(kernel.blocks)}))


if __name__ == "__main__":
    main()
