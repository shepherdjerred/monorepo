"""Observe original system scheduling, owned state and ribbon bytes on controlled input."""
import argparse
import json
import math
from pathlib import Path

import unicorn
from vfx_spawn_native import sha
from vfx_system_native import NativeSystem


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeSystem(args.package, args.client)
    raw = (args.package / "vfx-system.json").read_bytes()
    metadata = json.loads(raw)
    if sha(raw) != kernel.profile["vfxSystemSha256"]:
        raise ValueError("System package hash mismatch")
    emitter = kernel.checked_json("vfx-emitter.json", "vfxEmitterSha256")
    spawn = kernel.checked_json("vfx-spawn.json", "vfxSpawnSha256")
    sources = {**metadata["compilerSources"], **emitter["compilerSources"], **spawn["compilerSources"]}
    for name, digest in sources.items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError("System preparation source changed")
    global_writes = {}
    def observe_write(uc, access, address, size, value, user):
        key = (address-kernel.base, size)
        global_writes[key] = global_writes.get(key, 0)+1
        if not any(item["rva"] <= key[0] and key[0]+size <= item["rva"]+item["bytes"]
                   for item in emitter["checkpointLayout"]["globals"]):
            raise ValueError(f"System global write missing from checkpoint layout: {key}")
    kernel.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, observe_write, begin=kernel.base, end=kernel.base+len(kernel.image)-1)
    regular = [i/60 for i in range(121)]
    profiles = [
        {"name": "regular-zero", "createdAt": 0, "position": [0, 0, 0], "times": regular, "maxSubsteps": 20, "smoothingQuality": 2},
        {"name": "regular-offset", "createdAt": 90, "position": [5000, 20, 6000], "times": regular, "maxSubsteps": 20, "smoothingQuality": 2},
        {"name": "irregular", "createdAt": 90, "position": [5000, 20, 6000], "times": [0,.017,.017,.033,.08,.08,.13,.21,.28,.4,.6,.79,.8,.81,1,1.4,1.81,2], "maxSubsteps": 20, "smoothingQuality": 0},
        {"name": "budget-four", "createdAt": 90, "position": [5000, 20, 6000], "times": [0,.1,.5,.5,.79999995,.8,.80000007,1.5,1.8,2], "maxSubsteps": 4, "smoothingQuality": 2},
        {"name": "budget-one", "createdAt": 0, "position": [10, 5, -10], "times": [0,.1,.4,.4,.8,1.2,1.8,2], "maxSubsteps": 1, "smoothingQuality": 0},
    ]
    cases = []
    layout = emitter["checkpointLayout"]
    for reference in metadata["templates"]:
        graph_bytes = (args.package / reference["file"]).read_bytes()
        if sha(graph_bytes) != reference["sha256"]:
            raise ValueError("System graph mismatch")
        graph = json.loads(graph_bytes)
        for seed in [1, 0x915c]:
            for profile in profiles:
                kernel.reset_system(graph, seed, metadata, profile["smoothingQuality"], profile["createdAt"], profile["position"])
                steps = []
                for time in profile["times"]:
                    position = profile["position"]
                    value = {"time": profile["createdAt"]+time,
                             "current": [position[0]+math.sin(time*2)*90, position[1]+time*3, position[2]+time*170],
                             "viewForward": [0,-1,0] if profile["smoothingQuality"] == 2 else [.3,-.8,.5],
                             "maxSubsteps": profile["maxSubsteps"]}
                    output = kernel.tick(value, metadata)
                    output["memory"] = {
                        "contextSha256": sha(bytes(kernel.u.mem_read(layout["ownedAddress"], layout["ownedBytes"]))),
                        "arenaSha256": sha(bytes(kernel.u.mem_read(layout["heapAddress"], kernel.next_heap-layout["heapAddress"]))),
                        "globalsHex": [bytes(kernel.u.mem_read(kernel.base+item["rva"], item["bytes"])).hex() for item in layout["globals"]],
                        "allocationSha256": sha(json.dumps(sorted(kernel.allocations.items()), separators=(",", ":")).encode()),
                        "nextHeap": kernel.next_heap}
                    steps.append({"input": value, "output": output})
                cases.append({"graphSha256": reference["sha256"], "seedHex": f"{seed:016x}", "profile": profile["name"],
                              "creation": {"createdAt": profile["createdAt"], "position": profile["position"]},
                              "smoothingQuality": profile["smoothingQuality"], "steps": steps})
                print(json.dumps({"emitter": reference["emitterIndex"], "seed": hex(seed), "profile": profile["name"],
                                  "ticks": len(steps), "substeps": sum(len(step["output"]["substeps"]) for step in steps),
                                  "finalPool": output["state"]["vectors"]["life"]["count"]}), flush=True)
    result = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"],
              "definitionSha256": sha(raw), "decoderImageSha256": sha(kernel.image),
              "observerSourceSha256": sha(Path(__file__).read_bytes()), "compilerSources": sources, "cases": cases,
              "executedOriginalBlocks": list(kernel.blocks.values()),
              "globalWrites": [{"rva": rva, "bytes": size, "writes": count} for (rva, size), count in sorted(global_writes.items())],
              "mathProvider": {"name": "Windows ucrtbase.dll float functions; Darwin sincos return ABI adapted",
                               "sha256": sha(Path("C:/Windows/System32/ucrtbase.dll").read_bytes()), "originalMacOSLibmVerified": False},
              "scope": metadata["scope"]}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "ticks": sum(len(case["steps"]) for case in cases),
                      "substeps": sum(len(step["output"]["substeps"]) for case in cases for step in case["steps"]), "blocks": len(kernel.blocks)}))


if __name__ == "__main__":
    main()
