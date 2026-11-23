"""Prove original UI named resources and exact default texture GPU bytes."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from unicorn import x86_const as r
from shader_global_registry_native import NativeShaderGlobalGraphics
from graphics_float4_texture_device import GraphicsFloat4TextureDevice
from ui_shared_constants_native import initialize_original_ui_shared_constants
from ui_shared_texture_native import initialize_original_ui_primary_texture
from vfx_graphics_native import DEVICE


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "fields", "raw", "typed", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--registration", type=Path, action="append", required=True)
    parser.add_argument("--graphics", type=Path, required=True)
    args = parser.parse_args()
    tools, sources = Path(__file__).resolve().parent, {}
    for module in list(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if filename is not None:
            path = Path(filename).resolve()
            if path.is_relative_to(tools) and path.suffix == ".py":
                sources[str(path)] = sha(path.read_bytes())
    inputs = {str((args.graphics / name).resolve()): sha((args.graphics / name).read_bytes())
              for name in ["libEGL.dll", "libGLESv2.dll"]}
    n = NativeShaderGlobalGraphics(args.assets / "decoder-16.21-macos", args.client)
    result, boundary = {}, None
    try:
        n.initialize_character_types()
        n.call(0x14AA3BF, {}, end=0x14AA5F9)
        result["graphics"] = n.initialize_character_graphics(args.graphics)
        backend = n.allocate(0xEC0)
        n.call(0x1922690, {r.UC_X86_REG_RDI: backend})
        table = n.allocate(0x300, 0xA5)
        n.u.mem_write(table, bytes(n.u.mem_read(n.q(DEVICE), 0x2B0)))
        n.put(backend, "Q", table)
        n.shared_backend = backend
        n.float4_texture_backend = GraphicsFloat4TextureDevice(n.device, n.image)
        result["constants"] = initialize_original_ui_shared_constants(n, backend, args.fields, args.registration)
        result["texture"] = initialize_original_ui_primary_texture(n, backend, args.raw, args.typed)
    except Exception as error:
        stack = n.u.reg_read(r.UC_X86_REG_RSP)
        boundary = {"kind": type(error).__name__, "message": str(error),
                    "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base,
                    "returnRva": n.q(stack) - n.base if n.library_pointer(stack, 8) else None,
                    "registers": {name: n.u.reg_read(getattr(r, "UC_X86_REG_" + name.upper()))
                                  for name in ["rax", "rbx", "rdi", "rsi", "rdx", "rcx", "r8", "r9", "rbp", "rsp"]}}
    finally:
        if n.device is not None:
            n.close_graphics()
    for path, expected in {**sources, **inputs}.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError("Original UI resource control source/input changed")
    report = {"schema": 1, "kind": "original-ui-shared-resource-registration-control", "sources": sources,
              "inputs": inputs, "imageSha256": sha(n.image), "result": result, "boundary": boundary,
              "originalBlocks": list(n.blocks.values()),
              "scope": "Original named CPU parameter/texture views and native default texture GPU readback; no constant-buffer upload, draw or native HUD admission"}
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "boundary": boundary,
                      "textureGpuVerified": result.get("texture", {}).get("scope", {}).get("exactGpuResourceReadback", False)}))
    if boundary:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
