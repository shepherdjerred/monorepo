"""Record whole native legacy-quad emitter lifecycles on controlled inputs."""
import argparse
import json
import math
from pathlib import Path

import unicorn
from vfx_legacy_quad_native import NativeLegacyQuad
from vfx_spawn_native import sha


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
TURNED = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    k = NativeLegacyQuad(args.package, args.client)
    meta = k.checked_json("vfx-legacy-quads.json", "vfxLegacyQuadsSha256")
    active, global_writes = [False], []
    def write(uc, kind, at, count, value, user):
        if active[0]:
            global_writes.append({"rva": at-k.base, "bytes": count})
    k.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, write, begin=k.base, end=k.base+len(k.image)-1)
    cases, frames, births, vertices, indices, math_calls = [], 0, 0, 0, 0, 0
    times = [0, 0, 0.00001, 1/60, .05, .1, .2, .299999, .3, .30001, .4, .56, .6, 1]
    for ref in meta["templates"]:
        graph_raw = (args.package/ref["file"]).read_bytes()
        if sha(graph_raw) != ref["sha256"]:
            raise ValueError("Legacy quad graph hash mismatch")
        graph = json.loads(graph_raw)
        for mode, seed in [(0, 0), (0, 1), (1, 987654321), (2, 0xffffffffffffffff), (3, 1), (4, 2)]:
            k.reset_quad(graph, seed)
            records, previous = [], [0, 0, 0]
            for tick, time in enumerate(times):
                current = ([time*350, 30+time*15, time*100] if mode in [1, 2] else
                           [12000, 250, 8500] if mode == 4 else [0, 0, 0])
                value = {"time": time, "previous": previous, "current": current,
                         "basis": TURNED if mode == 3 or mode == 2 and tick > 4 else IDENTITY,
                         "viewPosition": [0, 1000, 0]}
                active[0] = True
                try:
                    actual = k.frame_quad(value)
                finally:
                    active[0] = False
                uv_outputs = []
                def owned_state():
                    return (bytes(k.u.mem_read(0x10020000, 0x10000)),
                            bytes(k.u.mem_read(0x10400000, k.next_heap-0x10400000)),
                            bytes(k.u.mem_read(k.base+0x2516698, 8)))
                before_render = owned_state()
                for uv in [
                    {"base": None, "mult": None, "multBound": False},
                    {"base": [.5, .2, -.3, 2, .25, .5], "mult": None, "multBound": False},
                    {"base": None, "mult": [0, -1, 1, 0, .5, -.25], "multBound": True},
                    {"base": [1, 0, 0, 1, -.125, .25], "mult": [2, .1, -.1, 2, .125, -.5], "multBound": True},
                ]:
                    uv_outputs.append({"input": uv, "geometry": k.render_with_uv(value["viewPosition"], uv)})
                    if owned_state() != before_render:
                        raise ValueError("Render-only UV composition changed persistent state")
                records.append({"input": value, "output": actual, "uvOutputs": uv_outputs})
                frames += 1
                births += len(actual["state"]["births"])
                vertices += len(actual["geometry"]["verticesHex"])//56
                indices += len(actual["geometry"]["indicesHex"])//4
                math_calls += len(actual["state"]["mathCalls"])+len(actual["geometry"]["mathCalls"])
                previous = current
            cases.append({"graphSha256": ref["sha256"], "mode": mode, "seedHex": f"{seed:016x}", "frames": records})
    unexpected = [w for w in global_writes if not 0x2516698 <= w["rva"] <= 0x25166a0-w["bytes"]]
    if unexpected:
        raise ValueError(f"Unexpected global writes: {unexpected[:8]}")
    result = {"schema": 1, "build": meta["build"], "protocol": meta["protocol"],
              "definitionSha256": k.profile["vfxLegacyQuadsSha256"],
              "decoderImageSha256": k.profile["decoderImageSha256"], "cases": cases,
              "summary": {"graphs": len(meta["templates"]), "cases": len(cases), "frames": frames,
                          "births": births, "vertices": vertices, "indices": indices, "mathCalls": math_calls},
              "executableGlobalWrites": sorted({(v["rva"], v["bytes"]) for v in global_writes}),
              "originalBlocks": list(k.blocks.values()), "compilerSources": meta["compilerSources"],
              "observerSha256": sha(Path(__file__).read_bytes()),
              "scope": meta["scope"]}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({**result["summary"], "originalBlocks": len(k.blocks), "unexpectedGlobals": len(unexpected)}))


if __name__ == "__main__":
    main()
