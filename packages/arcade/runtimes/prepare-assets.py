"""Build private runtime assets from pinned source and an operator-owned dump.

Outputs contain game data. Keep the output directory outside this repository.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

RUNTIMES = Path(__file__).resolve().parent
REPOSITORY = RUNTIMES.parents[2]
PINS = {
    "mkwii": "b19270fb9c1590673528a52d34ce4afb780cbee5",
    "melee": "5bc531aafcc941866f2c916afebc38ee75543222",
    "brawl": "2614969fa80dfeb87d2a4ad3bdaa703237127074",
}


def digest(file: Path, algorithm: str = "sha256") -> str:
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def run(command: list[str], source: Path, environment: dict[str, str]) -> None:
    subprocess.run(command, cwd=source, env=environment, check=True)


def prepare(args: argparse.Namespace) -> None:
    destination = args.output.resolve()
    if destination == REPOSITORY or REPOSITORY in destination.parents:
        raise ValueError("Private assets must be outside the repository")
    if destination.exists():
        raise ValueError("Choose a new output directory; existing assets are immutable")
    if args.game == "brawl":
        with args.disc.open("rb") as stream:
            if stream.read(4) != b"WBFS":
                raise ValueError("Brawl requires a WBFS dump; Dolphin checks RSBE01 revision 2")
        destination.mkdir(parents=True)
        shutil.copyfile(args.disc, destination / "disc.wbfs")
    else:
        if args.source is None or args.emsdk is None:
            raise ValueError("WASM builds require --source and --emsdk")
        source = args.source.resolve()
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        if revision != PINS[args.game]:
            raise ValueError(f"Expected source revision {PINS[args.game]}")
        if subprocess.check_output(["git", "status", "--porcelain"], cwd=source, text=True).strip():
            raise ValueError("Use a clean, dedicated upstream checkout")
        environment = dict(os.environ)
        environment.pop("OP_SERVICE_ACCOUNT_TOKEN", None)
        patch = RUNTIMES / args.game / "integration.patch"
        run(["git", "apply", "--check", str(patch)], source, environment)
        if args.game == "melee" and digest(args.disc, "sha1") != "d4e70c064cc714ba8400a849cf299dbd1aa326fc":
            raise ValueError("Melee requires the clean NTSC-U 1.02 ISO")
        run(["git", "apply", str(patch)], source, environment)
        if args.game == "melee":
            shutil.copyfile(RUNTIMES / "melee/probe.c", source / "platforms/browser/arcade_probe.c")
            environment["MELEE_EMSDK"] = str(args.emsdk.resolve())
            run([sys.executable, "tools/browser/build.py", "--jobs", str(args.jobs)], source, environment)
            artifact = source / "build/browser/runtime/platforms/browser"
            destination.mkdir(parents=True)
            shutil.copytree(artifact, destination / "engine")
            (destination / "engine/upstream").mkdir(exist_ok=True)
            shutil.copyfile(
                source / "platforms/browser/initial_pipeline_cache.db",
                destination / "engine/upstream/initial_pipeline_cache.db",
            )
            shutil.copyfile(args.disc, destination / "disc.iso")
        else:
            shutil.copyfile(RUNTIMES / "mkwii/probe.cpp", source / "runtime/src/platform/web/arcade_probe.cpp")
            environment["EMSDK"] = str(args.emsdk.resolve())
            run(
                ["bash", "web/build.sh", str(args.disc.resolve()), "--out", str(destination), "--jobs", str(args.jobs)],
                source,
                environment,
            )
    files = [
        {"path": file.relative_to(destination).as_posix(), "sha256": digest(file)}
        for file in sorted(destination.rglob("*"))
        if file.is_file()
    ]
    manifest = {"version": 1, "gameId": args.game, "sourceRevision": PINS[args.game], "files": files}
    (destination / "arcade-assets.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Prepared {args.game} assets in {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", choices=PINS, required=True)
    parser.add_argument("--disc", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--emsdk", type=Path)
    parser.add_argument("--jobs", type=int, default=6)
    prepare(parser.parse_args())
