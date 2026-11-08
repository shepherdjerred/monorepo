"""Compile surveyed beacons on an isolated sandbox, keeping private captures outside Git."""

import argparse
import json
import os
import re
import shutil
import subprocess
from itertools import pairwise
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
BLUEPRINT = Path(__file__).with_name("towers")
CATALOG = ROOT / "packages/the-storm/server/owned/plugins/TheStorm/skytravel.json"


def expand(waypoints: list[list[int]]) -> list[list[int]]:
    result = [waypoints[0]]
    for before, after in pairwise(waypoints):
        dx, dy, dz = [after[i] - before[i] for i in range(3)]
        steps = abs(dx) + abs(dz)
        if steps == 0 or (dx and dz) or abs(dy) > steps or dy % steps:
            raise ValueError("Approaches must have cardinal, integral, walkable steps")
        step = [dx // steps, dy // steps, dz // steps]
        result.extend([[before[i] + step[i] * n for i in range(3)] for n in range(1, steps + 1)])
    return result


def command(workspace: Path, instance: str, args: list[str]) -> str:
    env = dict(os.environ)
    env.pop("OP_SERVICE_ACCOUNT_TOKEN", None)
    env["TOOLKIT_MC_INSTANCE"] = instance
    log = workspace / (args[0] + ".log")
    print(workspace.name, args[0], flush=True)
    with log.open("w") as stream:
        completed = subprocess.run(
            ["bun", str(ROOT / "packages/toolkit/src/index.ts"), "mc", "build", *args],
            cwd=ROOT,
            env=env,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if completed.returncode:
        raise RuntimeError(f"{args[0]} failed: {log}\n{log.read_text()[-3000:]}")
    return log.read_text()


def prepare(args: argparse.Namespace, tower: dict[str, Any], approach: dict[str, Any]) -> None:
    workspace = args.workspaces / ("hub" if tower["id"] == "H" else tower["id"])
    workspace.mkdir(parents=True, exist_ok=True)
    base = tower["base"]
    anchor = ",".join(str(base[key]) for key in ("x", "y", "z"))
    if not (workspace / "build.json").exists():
        command(
            workspace,
            args.instance,
            [
                "init",
                str(workspace),
                "--name",
                "beacon-" + tower["id"].lower(),
                "--world",
                "skylands",
                "--anchor=" + anchor,
                "--seed",
                "1",
            ],
        )
    manifest = json.loads((workspace / "build.json").read_text())
    if manifest["anchor"] != base or manifest["world"] != "skylands":
        raise ValueError("Existing workspace belongs to a different site")
    points = expand(approach["waypoints"])
    if "site" not in manifest:
        min_x = base["x"] + min(-48, min(p[0] for p in points) - 10)
        max_x = base["x"] + max(48, max(p[0] for p in points) + 10)
        min_z = base["z"] + min(-48, min(p[2] for p in points) - 10)
        max_z = base["z"] + max(48, max(p[2] for p in points) + 10)
        command(
            workspace,
            args.instance,
            [
                "capture",
                str(workspace),
                "--target",
                args.target,
                "--world",
                "skylands",
                f"{min_x},{base['y'] - 16},{min_z}",
                f"{max_x},{base['y'] + 40},{max_z}",
            ],
        )
    shutil.copyfile(BLUEPRINT / "beacon.ts", workspace / "beacon.ts")
    (workspace / "approach.ts").write_text("export const approach = " + json.dumps(points) + " as const;\n")
    (workspace / "build.ts").write_text(
        'import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";\n'
        'import { beacon } from "./beacon.ts";\n'
        'import { approach } from "./approach.ts";\n'
        "export default ((ctx) => beacon(ctx, {path:approach,palette:"
        + json.dumps(approach["palette"])
        + "})) satisfies BuildProgram;\n"
    )
    command(workspace, args.instance, ["compile", str(workspace)])
    command(workspace, args.instance, ["render", str(workspace), "--source", "compiled", "--name", "network"])
    command(
        workspace,
        args.instance,
        [
            "render",
            str(workspace),
            f"{base['x'] - 16},{base['y'] - 5},{base['z'] - 16}",
            f"{base['x'] + 16},{base['y'] + 35},{base['z'] + 16}",
            "--source",
            "compiled",
            "--name",
            "tower",
        ],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--instance", required=True)
    parser.add_argument("--workspaces", type=Path, required=True)
    parser.add_argument("--phase", choices=("prepare", "place", "replay", "promote"), required=True)
    parser.add_argument("--only", help="Comma-separated tower IDs; absence selects all 19")
    args = parser.parse_args()
    if not re.fullmatch(r"sbx-[a-z0-9]{6}", args.target):
        raise ValueError("Tower authoring accepts disposable sandbox IDs only")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", args.instance):
        raise ValueError("Invalid isolated harness instance")
    if not args.workspaces.is_absolute() or args.workspaces.resolve().is_relative_to(ROOT):
        raise ValueError("Keep private captures in an absolute directory outside the repository")
    catalog = json.loads(CATALOG.read_text())
    layout = json.loads((BLUEPRINT / "approaches.json").read_text())
    approaches = {entry["id"]: entry for entry in layout["towers"]}
    if set(approaches) != {tower["id"] for tower in catalog["towers"]}:
        raise ValueError("Tower catalog and approach plan differ")
    selected = set(args.only.split(",")) if args.only else set(approaches)
    if not selected.issubset(approaches):
        raise ValueError("Unknown tower selection")
    for tower in catalog["towers"]:
        if tower["id"] not in selected:
            continue
        if args.phase == "prepare":
            prepare(args, tower, approaches[tower["id"]])
        else:
            workspace = args.workspaces / ("hub" if tower["id"] == "H" else tower["id"])
            if args.phase == "promote":
                plan = json.loads(
                    command(workspace, args.instance, ["promote", str(workspace), "--target", args.target, "--json"])
                )
                command(
                    workspace,
                    args.instance,
                    ["promote", str(workspace), "--target", args.target, "--confirm", plan["planHash"], "--json"],
                )
                continue
            verb = "run" if args.phase == "place" else "replay"
            command(workspace, args.instance, [verb, str(workspace), "--target", args.target])


if __name__ == "__main__":
    main()
