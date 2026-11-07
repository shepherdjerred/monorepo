"""Prepare a standalone offline compiler from an exact cached Hexshade checkout.

The two upstream crates are copied unchanged. The upstream lockfile supplies
dependency versions. Cargo may prune unrelated workspace packages when building.
This command does not fetch source, build the compiler, or start League.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

REVISION = "a3e5ef85ca4cf50486f2dcd9024831432ec9921b"
SUBMODULES = {
    "crates/dxbc-spirv-sys/vendor/dxbc-spirv": "bf14419e5fa7eacb817b7b632f03cb61d61bbad7",
    "crates/dxbc-spirv-sys/vendor/dxbc-spirv/submodules/spirv_headers": "c8ad050fcb29e42a2f57d9f59e97488f465c436d",
}
WORKSPACE = '''[workspace]
members = ["hexshade", "dxbc-spirv-sys", "scout-shader-prepare"]
resolver = "2"

[workspace.dependencies]
fs-err = "3"
regex = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
specta = { version = "=2.0.0-rc.25", features = ["derive", "chrono", "indexmap"] }
thiserror = "2"
tracing = "0.1"
xxhash-rust = { version = "0.8", features = ["xxh64"] }
ltk_wad = "0.5.10"
tempfile = "3"
'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not output.is_relative_to(Path.cwd().resolve() / ".cache"):
        raise ValueError("Compiler preparation must stay inside this worktree's .cache")
    git = ["git", "-c", "core.longpaths=true"]
    revision = subprocess.check_output([*git, "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise ValueError("Hexshade checkout revision mismatch")
    changed = subprocess.check_output([*git, "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True)
    if changed.strip():
        raise ValueError("Hexshade checkout contains modified tracked files")
    for path, expected in SUBMODULES.items():
        actual = subprocess.check_output([*git, "-C", str(source / path), "rev-parse", "HEAD"], text=True).strip()
        modified = subprocess.check_output([*git, "-C", str(source / path), "status", "--porcelain", "--untracked-files=no"], text=True)
        if actual != expected or modified.strip():
            raise ValueError(f"Compiler submodule changed: {path}")
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for crate in ["hexshade", "dxbc-spirv-sys"]:
        root = source / "crates" / crate
        for path in sorted(root.rglob("*")):
            if not path.is_file() or ".git" in path.parts or path.name == ".git":
                continue
            relative = path.relative_to(root)
            dest = output / crate / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            data = path.read_bytes()
            dest.write_bytes(data)
            files.append({"path": f"{crate}/{relative.as_posix()}", "sha256": sha(data)})
    cli = Path(__file__).resolve().parent / "hexshade-cli"
    for name in ["Cargo.toml", "src/main.rs"]:
        dest = output / "scout-shader-prepare" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cli / name, dest)
        files.append({"path": f"scout-shader-prepare/{name}", "sha256": sha(dest.read_bytes())})
    (output / "Cargo.toml").write_text(WORKSPACE, encoding="utf-8")
    if not (output / "Cargo.lock").exists():
        shutil.copyfile(source / "Cargo.lock", output / "Cargo.lock")
    shutil.copyfile(source / "LICENSE", output / "HEXShade-LICENSE")
    manifest = {"schema": 1, "revision": REVISION, "submodules": SUBMODULES,
                "pipelineVersion": 4, "files": files,
                "upstreamLockSha256": sha((source / "Cargo.lock").read_bytes()),
                "workspaceSha256": sha((output / "Cargo.toml").read_bytes()),
                "preparerSha256": sha(Path(__file__).read_bytes())}
    (output / "sources.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"revision": REVISION, "files": len(files), "output": str(output)}))


if __name__ == "__main__":
    main()
