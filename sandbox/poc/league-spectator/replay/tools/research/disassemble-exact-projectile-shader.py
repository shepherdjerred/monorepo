"""Read one pinned Windows quad shader with the system DXBC disassembler."""

import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import sys


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    stage, = sys.argv[1:]
    shader_id, archive_offset, length, digest = {
        "vertex": (1, 22213, 22216, "cad9787f486b62aaf4928859674d8f3f21315197b4f1175f9d844cbf0243f3a4"),
        "pixel": (6, 26070, 4472, "876c2e284a8a8f4e39804e0aa0dffd20e358d7e54247c7e10c794b8f7f65697c"),
    }[stage]
    data = sys.stdin.buffer.read(length + 1)
    if len(data) != length or sha256(data) != digest:
        raise ValueError("Expected the exact admitted DXBC container")

    dll = Path(os.environ["SystemRoot"]) / "System32" / "d3dcompiler_47.dll"
    disassemble = c.WinDLL(str(dll)).D3DDisassemble
    disassemble.argtypes = [c.c_void_p, c.c_size_t, c.c_uint, c.c_char_p, c.POINTER(c.c_void_p)]
    disassemble.restype = c.c_int32
    blob = c.c_void_p()
    status = disassemble(data, len(data), 0, None, c.byref(blob))
    if status != 0 or not blob.value:
        raise ValueError(f"System D3DDisassemble returned HRESULT {status & 0xFFFFFFFF:#x}")
    table = c.cast(blob, c.POINTER(c.POINTER(c.c_void_p)))[0]
    try:
        address = c.WINFUNCTYPE(c.c_void_p, c.c_void_p)(table[3])(blob)
        size = c.WINFUNCTYPE(c.c_size_t, c.c_void_p)(table[4])(blob)
        assembly = c.string_at(address, size).rstrip(b"\0")
    finally:
        c.WINFUNCTYPE(c.c_uint32, c.c_void_p)(table[2])(blob)
    text = assembly.decode("ascii")
    instructions = [line.strip() for line in text.splitlines() if line and not line.startswith("//")]
    if stage == "vertex":
        required = [
            "vs_5_0", "dcl_input v0.xyz", "dcl_input v1.xyzw", "dcl_input v2.xyz",
            "dcl_input v3.xy", "dcl_input_sgv v4.x, instance_id", "if_nz cb3[2].w",
            "mov o1.xyzw, v1.zyxw", "mov o2.zw, v3.xxxy",
            "dp4 o0.w, r1.xyzw, cb2[3].xyzw", "mul o2.x, r0.x, cb1[0].y",
            "mul o2.y, r0.x, cb1[0].z", "mad o3.xy, r10.xyxx, cb2[19].xyxx, cb2[19].zwzz",
        ]
        attributes = ["POSITION", "COLOR", "TEXCOORD", "SV_InstanceID"]
        result = {
            "vertexInputs": {"position": "POSITION0.xyz", "packedColor": "COLOR0.xyzw",
                             "baseUvAndFrame": "TEXCOORD0.xyz", "paletteUv": "TEXCOORD1.xy",
                             "instanceId": "SV_InstanceID"},
            "nonInstancedBranch": {
                "control": "CB3[2].w == 0", "tintOutput": "TEXCOORD0 = COLOR0.zyxw",
                "paletteUvOutput": "TEXCOORD1.zw = TEXCOORD1.xy from vertex input",
                "baseUvOutput": "TEXCOORD1.xy from base UV/frame and CB1[0].xyz atlas layout",
                "requires": ["camera position", "camera pushback", "view-projection matrix", "fog transform"],
            },
        }
    else:
        required = [
            "ps_5_0",
            "sample_indexable(texture2d)(float,float,float,float) r0.xyzw, v2.xyxx, t2.xyzw, s0",
            "sample_indexable(texture2d)(float,float,float,float) r1.xyzw, v2.zwzz, t3.xyzw, s1",
            "mul r0.xyzw, r0.xyzw, r1.xyzw", "mad r1.x, v1.w, r0.w, -cb0[0].x",
            "mul r0.xyzw, r0.xyzw, v1.xyzw", "lt r1.x, r1.x, l(0.000000)", "discard_nz r1.x",
            "dp3 r1.x, r0.xyzx, l(0.212600, 0.715200, 0.072200, 0.000000)",
            "sample_indexable(texture2d)(float,float,float,float) r1.xyzw, r1.xyxx, t1.xyzw, s15",
            "mov o0.w, r0.w",
            "sample_indexable(texture2d)(float,float,float,float) r0.w, v3.xyxx, t0.xyzw, s15",
            "mul r0.xyz, r0.wwww, r0.xyzx", "ieq r0.w, cb0[0].y, l(1234)",
            "ine r0.w, cb1[32].x, l(0)",
        ]
        attributes = ["TEXTURE__TX", "PARTICLE_COLOR_TEXTURE__TX", "FOW_MAP_SharedTexture",
                      "PIXEL_COLOR_REMAP_RAMP_SharedTexture", "AlphaTestReferenceValue"]
        result = {
            "textureBindings": {
                "base": {"texture": "t2", "sampler": "s0", "uv": "TEXCOORD1.xy"},
                "palette": {"texture": "t3", "sampler": "s1", "uv": "TEXCOORD1.zw"},
                "fog": {"texture": "t0", "sampler": "s15", "uv": "TEXCOORD2.xy", "channel": "a"},
                "remap": {"texture": "t1", "sampler": "s15", "uv": ["tint-weighted RGB luminance", 0.5]},
            },
            "alpha": "base.a * palette.a * interpolated tint.a",
            "discard": "tint.a * (base.a * palette.a) - CB0[0].x < 0",
            "alphaCutoffConstant": "CB0[0].x / AlphaTestReferenceValue",
            "colorStages": ["base × palette × tint", "replace RGB when remap ramp alpha is positive",
                            "multiply RGB by fog alpha", "apply render-target/debug sRGB branch"],
        }
    expected = iter(instructions)
    if not all(any(line == instruction for line in expected) for instruction in required):
        raise ValueError("Original DXBC disassembly instruction sequence differs")
    if not all(attribute in text for attribute in attributes):
        raise ValueError("Original DXBC signature or resource bindings differ")
    print(json.dumps({"shaderId": shader_id, "bundleOffset": archive_offset,
                      "dxbcBytes": length, "dxbcSha256": digest,
                      "systemCompilerSha256": sha256(dll.read_bytes()),
                      "disassemblySha256": sha256(assembly), **result}, allow_nan=False))


if __name__ == "__main__":
    main()
