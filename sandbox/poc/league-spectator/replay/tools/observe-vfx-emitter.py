"""Observe native emitter frames, expiry/removal and resulting trail geometry."""
import argparse
import json
import math
from pathlib import Path
import unicorn

from vfx_spawn_native import sha
from vfx_emitter_native import NativeEmitter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeEmitter(args.package, args.client)
    raw = (args.package / "vfx-emitter.json").read_bytes()
    metadata = json.loads(raw)
    if sha(raw) != kernel.profile["vfxEmitterSha256"]:
        raise ValueError("Emitter package hash mismatch")
    for name, digest in metadata["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError("Emitter preparation source changed")
    global_writes = {}
    def observe_global_write(uc, access, address, size, value, user):
        key = (address-kernel.base, size)
        global_writes[key] = global_writes.get(key, 0)+1
        if not any(item["rva"] <= key[0] and key[0]+size <= item["rva"]+item["bytes"]
                   for item in metadata["checkpointLayout"]["globals"]):
            raise ValueError(f"Native emitter global write missing from checkpoint layout: {key}")
    kernel.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, observe_global_write,
                     begin=kernel.base, end=kernel.base+len(kernel.image)-1)
    clocks = [list(i/60 for i in range(121)),
              [0, .017, .017, .033, .08, .08, .13, .21, .28, .4, .6, .79, .8, .81, 1, 1.4, 1.81, 2],
              [0, .1, .5, .5, .79999995, .8, .80000007, 1.5, 1.8, 2]]
    cases = []
    for reference in metadata["templates"]:
        graph_bytes = (args.package / reference["file"]).read_bytes()
        if sha(graph_bytes) != reference["sha256"]:
            raise ValueError("Emitter static graph mismatch")
        graph = json.loads(graph_bytes)
        for seed in [1, 0x915c]:
            for clock_index, times in enumerate(clocks):
                quality = 2 if clock_index == 0 else 0
                kernel.reset_emitter(graph, seed, metadata, quality)
                steps, previous = [], [0, 0, 0]
                for time in times:
                    current = [math.sin(time*2)*90, time*3, time*170]
                    value = {"time": time, "previous": previous, "current": current,
                             "viewForward": [0, -1, 0] if quality == 2 else [.3, -.8, .5]}
                    output = kernel.frame(value)
                    steps.append({"input": value, "output": output})
                    previous = current
                cases.append({"graphSha256": reference["sha256"], "seedHex": f"{seed:016x}",
                              "clockIndex": clock_index, "smoothingQuality": quality, "steps": steps})
                print(json.dumps({"graph": reference["emitterIndex"], "seed": hex(seed), "clock": clock_index,
                                  "frames": len(steps), "finalPool": output["state"]["vectors"]["life"]["count"]}), flush=True)
    result = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"],
              "definitionSha256": sha(raw), "decoderImageSha256": sha(kernel.image),
              "observerSourceSha256": sha(Path(__file__).read_bytes()), "compilerSources": metadata["compilerSources"],
              "spawnCompilerSources": kernel.checked_json("vfx-spawn.json", "vfxSpawnSha256")["compilerSources"],
              "cases": cases, "executedOriginalBlocks": list(kernel.blocks.values()),
              "globalWrites": [{"rva": rva, "bytes": size, "writes": count} for (rva, size), count in sorted(global_writes.items())],
              "mathProvider": {"name": "Windows ucrtbase.dll float functions; Darwin sincos return ABI adapted",
                               "sha256": sha(Path("C:/Windows/System32/ucrtbase.dll").read_bytes()),
                               "originalMacOSLibmVerified": False}, "scope": metadata["scope"]}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "frames": sum(len(case["steps"]) for case in cases),
                      "births": sum(len(step["output"]["state"]["births"]) for case in cases for step in case["steps"]),
                      "blocks": len(kernel.blocks)}))


if __name__ == "__main__":
    main()
