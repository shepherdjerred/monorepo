"""Build the structural decoder's Unicorn WASM runtime from pinned source.

Requires a separate Unicorn.js checkout (including its pinned submodule),
Emscripten 4.0.22, CMake, Ninja, Git Bash, pkgconf and strings on PATH.
This modifies only that explicitly supplied research checkout and output file.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

REVISION = "1220477c7fb0f8fe4b500f4bd211de52f6dfe638"
UNICORN_REVISION = "8028ec436f2d9376525352dd38ed9ed6b9f6be10"


def revision(path):
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    checkout, output = args.checkout.resolve(), args.output.resolve()
    if revision(checkout) != REVISION or revision(checkout / "unicorn") != UNICORN_REVISION:
        raise ValueError("Unicorn source revision mismatch")
    emcc = "emcc.bat" if os.name == "nt" else "emcc"
    version = subprocess.check_output([emcc, "--version"], text=True)
    if "4.0.22" not in version.splitlines()[0]:
        raise ValueError("Expected Emscripten 4.0.22")
    patch = Path(__file__).with_name("unicorn-adapter-temporaries.patch").resolve()
    original = Path.cwd()
    os.chdir(checkout)
    try:
        spec = importlib.util.spec_from_file_location("unicorn_build", checkout / "build.py")
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)
        if Path(build.UNICORN_BUILD_DIR).resolve() != checkout / "unicorn/build":
            raise ValueError("Unexpected build directory")
        build.patchUnicorn()
        submodule = checkout / "unicorn"
        applied = subprocess.run(["git", "apply", "--reverse", "--check", str(patch)], cwd=submodule,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if applied.returncode != 0:
            subprocess.run(["git", "apply", str(patch)], cwd=submodule, check=True)
        # Python subprocess on Windows needs the SDK's explicit batch suffix.
        run = build.subprocess.run

        def sdk_run(command, **kwargs):
            command = list(command)
            if os.name == "nt" and command[0] in ["emcmake", "emmake", "emcc"]:
                command[0] += ".bat"
            return run(command, **kwargs)

        build.subprocess.run = sdk_run
        os.environ["CMAKE_POLICY_VERSION_MINIMUM"] = "3.5"
        build.generateConstants()
        build.compileUnicorn(["x86"])
    finally:
        os.chdir(original)
    runtime = (checkout / "dist/unicorn_x86.js").read_bytes() + b"\nexport default MUnicorn;\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(runtime)
    manifest = {"schema": 1, "sourceRevision": REVISION, "unicornRevision": UNICORN_REVISION,
                "emscripten": "4.0.22", "sha256": hashlib.sha256(runtime).hexdigest(),
                "patchSha256": hashlib.sha256(patch.read_bytes()).hexdigest()}
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
