"""Prepare a build-specific packet function image. Does not read any replay."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

from rofllens.decoders.emulator import UnicornDecoderEngine

EXE_SHA = "34de26710352fcf4360b27691cecf77843a0ea338cd455be4fabb63fb467984f"
RUNTIME_SHA = "643adbbb0c77eadb71182f116c9da0860814221a25194dac3ed561589929ef6d"
RUNTIME_URL = "https://cdn.jsdelivr.net/npm/@alexaltea/unicorn-js@2.1.4/dist/unicorn_x86.js"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("research", type=Path)
    parser.add_argument("cache", type=Path)
    args = parser.parse_args()
    executable = args.research / "League of Legends.exe"
    if hashlib.sha256(executable.read_bytes()).hexdigest() != EXE_SHA:
        raise ValueError("Unsupported executable hash")
    profile = args.research / "rofllens/src/rofllens/profiles/16.14.794.5912-34de26710352/profile.json"
    engine = UnicornDecoderEngine(profile, executable)
    size = (engine.profile["sizeOfImage"] + 4095) & ~4095
    image = bytes(engine._uc.mem_read(engine.profile["imageBase"], size))
    output = args.cache / "public/decoder"
    output.mkdir(parents=True, exist_ok=True)
    (output / "image.bin").write_bytes(image)
    (output / "profile.json").write_text(json.dumps({**engine.profile, "decoderImageSha256": hashlib.sha256(image).hexdigest()}))
    with urlopen(RUNTIME_URL, timeout=60) as response:
        runtime = response.read()
    if hashlib.sha256(runtime).hexdigest() != RUNTIME_SHA:
        raise ValueError("Unicorn WASM runtime hash mismatch")
    vendor = args.cache / "public/vendor"
    vendor.mkdir(parents=True, exist_ok=True)
    (vendor / "unicorn_x86.mjs").write_bytes(runtime + b"\nexport default MUnicorn;\n")
    print(f"Prepared {size:,} bytes of exact-build decoder image and pinned Unicorn.js runtime")

if __name__ == "__main__":
    main()
