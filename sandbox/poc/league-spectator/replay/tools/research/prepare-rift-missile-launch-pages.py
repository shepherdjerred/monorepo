"""Trace reviewed .8428 missile launch pages using the archived reader oracle."""

import argparse
import contextlib
import io
import json
import runpy
import sys
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from unicorn import UC_HOOK_BLOCK, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE, Uc

BUILD = "16.23.841.8428"
BASE = 0x100000000
PAGE_SIZE = 4096
READER = Path(__file__).with_name("exact-projectile-reader.py")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("corpora", nargs="+", type=Path)
    args = parser.parse_args()
    cache = Path(__file__).resolve().parents[6] / ".cache"
    output = args.output.resolve()
    if cache not in output.parents or output.exists():
        raise ValueError("Use a fresh missile profile directory inside .cache")

    page_offsets = set()
    original_map = Uc.mem_map

    def trace_map(machine, address, size, *options, **named_options):
        original_map(machine, address, size, *options, **named_options)
        if address != BASE:
            return

        def record(address, length):
            offset = address - BASE
            page_offsets.update(range(offset & -PAGE_SIZE, offset + length, PAGE_SIZE))

        def block(_machine, address, length, _data):
            record(address, length)

        def access(_machine, _access, address, length, _value, _data):
            record(address, length)

        bounds = {"begin": address, "end": address + size - 1}
        machine.hook_add(UC_HOOK_BLOCK, block, **bounds)
        machine.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, access, **bounds)

    reports = []
    argv = [str(READER), str(args.archive), BUILD]
    with patch.object(Uc, "mem_map", trace_map), patch.object(sys, "argv", argv):
        for corpus in args.corpora:
            inputs = json.loads(corpus.read_bytes())
            if inputs.get("selectMaokaiR") is not True or inputs["components"] or inputs["controller"]:
                raise ValueError("Expected a Maokai R creation corpus")
            with (
                corpus.open(encoding="utf-8") as source,
                patch.object(sys, "stdin", source),
                contextlib.redirect_stdout(io.StringIO()) as stdout,
            ):
                namespace = runpy.run_path(str(READER), run_name="__main__")
            reports.append(json.loads(stdout.getvalue()))

    archive = args.archive.read_bytes()
    image = namespace["MachImage"](archive)
    guards = [offset for offset, name in image.data_imports.items() if name == "___stack_chk_guard"]
    page_offsets.update(offset & -PAGE_SIZE for offset in guards)
    ordered = sorted(page_offsets)
    binary = b"".join(image.image[offset : offset + PAGE_SIZE] for offset in ordered)
    profile = {
        "base": image.base,
        "pages": ordered,
        "guard": guards,
        "imports": {offset: name for offset, name in image.imports.items() if offset & -PAGE_SIZE in page_offsets},
        "archiveSha256": sha256(archive).hexdigest(),
        "pageSha256": sha256(binary).hexdigest(),
    }
    output.mkdir()
    (output / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    (output / "pages.bin").write_bytes(binary)
    (output / "reports.json").write_text(json.dumps(reports), encoding="utf-8")
    print(
        json.dumps(
            {
                "pages": len(ordered),
                "pageSha256": profile["pageSha256"],
                "launches": [len(report["records"]) for report in reports],
            }
        )
    )


if __name__ == "__main__":
    main()
