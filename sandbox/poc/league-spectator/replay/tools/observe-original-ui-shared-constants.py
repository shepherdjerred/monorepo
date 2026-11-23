"""Prove original UI constant-row publication without GPU or scene claims."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from character_graphics_native import NativeCharacterGraphics
from ui_shared_constants_native import initialize_original_ui_shared_constants


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "fields", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--registration", action="append", type=Path, required=True)
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    sources = {}
    for module in list(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if filename is not None:
            path = Path(filename).resolve()
            if path.is_relative_to(tools) and path.suffix == ".py":
                sources[str(path)] = sha(path.read_bytes())
    n = NativeCharacterGraphics(args.assets / "decoder-16.21-macos", args.client)
    result, boundary = None, None
    try:
        n.initialize_character_types()
        n.call(0x14AA3BF, {}, end=0x14AA5F9)
        backend = n.allocate(0xEC0)
        n.call(0x1922690, {r.UC_X86_REG_RDI: backend})
        table = n.allocate(0x300)
        # Select original CPU virtual implementations; no native GPU operation
        # or synthetic parameter value is provided by this control.
        n.u.mem_write(table, bytes(n.u.mem_read(n.base + 0x2408570, 0x300)))
        n.put(backend, "Q", table)
        result = initialize_original_ui_shared_constants(n, backend, args.fields, args.registration)
    except Exception as error:
        boundary = {"kind": type(error).__name__, "message": str(error),
                    "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    for path, expected in sources.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError("Original UI constant control source changed during execution")
    report = {"schema": 1, "kind": "original-ui-shared-constant-cpu-registration-control",
              "imageSha256": sha(n.image), "sources": sources, "result": result, "boundary": boundary,
              "originalBlocks": list(n.blocks.values()),
              "scope": "Original Shared constant definitions and CPU parameter views only; no native GPU buffer, upload, scene or render admission"}
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "boundary": boundary,
                      "views": [row["name"] for row in result["rows"]] if result else []}))
    if boundary:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
