"""Observe whole original birth/pool code on explicit controlled clocks/poses/seeds."""
import argparse
import json
from pathlib import Path

from vfx_spawn_native import NativeSpawn, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    kernel = NativeSpawn(args.package, args.client)
    raw = (args.package / "vfx-spawn.json").read_bytes()
    metadata = json.loads(raw)
    if sha(raw) != kernel.profile["vfxSpawnSha256"]:
        raise ValueError("Spawn metadata mismatch")
    for name, digest in metadata["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != digest:
            raise ValueError("Spawn compiler changed; regenerate graphs")
    cases = []
    for reference in metadata["templates"]:
        graph_bytes = (args.package / reference["file"]).read_bytes()
        if sha(graph_bytes) != reference["sha256"]:
            raise ValueError("Spawn graph mismatch")
        graph = json.loads(graph_bytes)
        for seed in [0, 1, 0x915c, 0x8000000000000000, 0xffffffffffffffff]:
            for counts in [[0, 1, 2, 4], [8, 0, 32, 65]]:
                kernel.reset(graph, seed)
                steps = []
                for index, count in enumerate(counts):
                    value = {"count": count, "previous": [index*30, index*2, index*15],
                             "current": [(index+1)*30, (index+1)*2, (index+1)*15],
                             "time": (index+1)*.1, "dt": .1, "normalizedAge": [.0, .125, .55, .75][index]}
                    steps.append({"input": value, "output": kernel.step(value)})
                cases.append({"graphSha256": reference["sha256"], "seedHex": f"{seed:016x}", "steps": steps})
        kernel.reset(graph, 0x915c)
        value = {"count": 1000, "previous": [0, 0, 0], "current": [120, 8, 60],
                 "time": .1, "dt": .1, "normalizedAge": .125}
        cases.append({"graphSha256": reference["sha256"], "seedHex": "000000000000915c",
                      "steps": [{"input": value, "output": kernel.step(value)}]})
    result = {"schema": 1, "build": metadata["build"], "protocol": metadata["protocol"],
              "definitionSha256": sha(raw), "decoderImageSha256": sha(kernel.image),
              "observerSourceSha256": sha(Path(__file__).read_bytes()), "compilerSources": metadata["compilerSources"],
              "cases": cases, "executedOriginalBlocks": list(kernel.blocks.values()),
              "mathProvider": {"name": "Windows ucrtbase.dll float functions; Darwin sincos return ABI adapted",
                               "sha256": sha(Path("C:/Windows/System32/ucrtbase.dll").read_bytes()),
                               "originalMacOSLibmVerified": False}, "scope": metadata["scope"]}
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "steps": sum(len(case["steps"]) for case in cases),
                      "births": sum(len(step["output"]["births"]) for case in cases for step in case["steps"]),
                      "blocks": len(kernel.blocks)}))


if __name__ == "__main__":
    main()
