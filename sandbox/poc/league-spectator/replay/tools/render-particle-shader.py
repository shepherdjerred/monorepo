"""Render original translated quad shaders offscreen over recorded native vertices.

This is a shader diagnostic with explicit scene/resource inputs. It does not
recover original material bindings, render passes, or compare League pixels.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

adapter_spec = importlib.util.spec_from_file_location("shader_angle", Path(__file__).with_name("observe-shader-angle.py"))
adapter = importlib.util.module_from_spec(adapter_spec)
adapter_spec.loader.exec_module(adapter)
Angle, sha = adapter.Angle, adapter.sha


class Draw(Angle):
    def __init__(self, directory):
        super().__init__(directory)
        u, i, p, f, b = C.c_uint, C.c_int, C.c_void_p, C.c_float, C.c_ubyte
        for name, result, args in [
            ("glGenBuffers", None, [i, C.POINTER(u)]), ("glBindBuffer", None, [u, u]),
            ("glBufferData", None, [u, C.c_ssize_t, p, u]), ("glBindBufferBase", None, [u, u, u]),
            ("glDeleteBuffers", None, [i, C.POINTER(u)]),
            ("glGetUniformBlockIndex", u, [u, C.c_char_p]), ("glUniformBlockBinding", None, [u, u, u]),
            ("glGenTextures", None, [i, C.POINTER(u)]), ("glBindTexture", None, [u, u]),
            ("glTexImage2D", None, [u, i, i, i, i, i, u, u, p]),
            ("glTexParameteri", None, [u, u, i]), ("glActiveTexture", None, [u]),
            ("glDeleteTextures", None, [i, C.POINTER(u)]),
            ("glGenFramebuffers", None, [i, C.POINTER(u)]), ("glBindFramebuffer", None, [u, u]),
            ("glFramebufferTexture2D", None, [u, u, u, u, i]), ("glCheckFramebufferStatus", u, [u]),
            ("glDeleteFramebuffers", None, [i, C.POINTER(u)]),
            ("glGenVertexArrays", None, [i, C.POINTER(u)]), ("glBindVertexArray", None, [u]),
            ("glDeleteVertexArrays", None, [i, C.POINTER(u)]),
            ("glGetAttribLocation", i, [u, C.c_char_p]), ("glEnableVertexAttribArray", None, [u]),
            ("glVertexAttribPointer", None, [u, i, u, b, i, p]),
            ("glGetUniformLocation", i, [u, C.c_char_p]), ("glUniform1i", None, [i, i]),
            ("glUseProgram", None, [u]), ("glViewport", None, [i, i, i, i]),
            ("glClearColor", None, [f, f, f, f]), ("glClear", None, [u]),
            ("glEnable", None, [u]), ("glDisable", None, [u]), ("glBlendFunc", None, [u, u]),
            ("glReadPixels", None, [i, i, i, i, u, u, p]),
            ("glDrawElements", None, [u, i, u, p]), ("glFinish", None, []),
        ]:
            self.fn(self.gl, name, result, *args)
        self.buffers, self.textures = [], []
        self.framebuffer, self.vao = C.c_uint(), C.c_uint()
        self.gl.glGenFramebuffers(1, C.byref(self.framebuffer))
        self.gl.glBindFramebuffer(0x8d40, self.framebuffer)
        color = self.texture(np.zeros((512, 512, 4), dtype=np.uint8), "clamp", "nearest")
        self.gl.glFramebufferTexture2D(0x8d40, 0x8ce0, 0x0de1, color, 0)
        if self.gl.glCheckFramebufferStatus(0x8d40) != 0x8cd5:
            raise ValueError("Diagnostic framebuffer incomplete")
        self.gl.glGenVertexArrays(1, C.byref(self.vao))
        self.gl.glBindVertexArray(self.vao)

    def buffer(self, target, data):
        handle = C.c_uint()
        self.gl.glGenBuffers(1, C.byref(handle))
        self.gl.glBindBuffer(target, handle)
        raw = C.create_string_buffer(data)
        self.gl.glBufferData(target, len(data), raw, 0x88e4)
        self.buffers.append(handle)
        return handle

    def texture(self, rgba, address, filter_mode):
        handle = C.c_uint()
        self.gl.glGenTextures(1, C.byref(handle))
        self.gl.glBindTexture(0x0de1, handle)
        height, width, channels = rgba.shape
        if channels != 4 or rgba.dtype != np.uint8:
            raise ValueError("Diagnostic texture must be RGBA8")
        raw = C.create_string_buffer(rgba.tobytes())
        self.gl.glTexImage2D(0x0de1, 0, 0x8058, width, height, 0, 0x1908, 0x1401, raw)
        mode = {"repeat": 0x2901, "clamp": 0x812f, "mirror": 0x8370}[address]
        filtering = {"nearest": 0x2600, "linear": 0x2601}[filter_mode]
        for key, value in [(0x2802, mode), (0x2803, mode), (0x2801, filtering), (0x2800, filtering)]:
            self.gl.glTexParameteri(0x0de1, key, value)
        self.textures.append(handle)
        return handle

    def program(self, vertex, pixel):
        handles = []
        for source, stage in [(vertex, "vertex"), (pixel, "pixel")]:
            handle, success, log = self.compile(source["glsl"], stage)
            if not success:
                raise ValueError(f"Diagnostic shader failed: {log}")
            handles.append(handle)
        program = self.gl.glCreateProgram()
        for handle in handles:
            self.gl.glAttachShader(program, handle)
        self.gl.glLinkProgram(program)
        status = C.c_int()
        self.gl.glGetProgramiv(program, 0x8b82, C.byref(status))
        if not status.value:
            raise ValueError(self.log(program, True))
        for handle in handles:
            self.gl.glDeleteShader(handle)
        return program

    def draw(self, program, stages, vertices, indices, values, texture_values, blend=(0x0302, 1)):
        self.gl.glUseProgram(program)
        block_index = 0
        buffers = []
        for stage in stages:
            for block in stage["sidecar"]["blocks"]:
                data = bytearray(block["size"])
                for member in block["members"]:
                    if not member["used"]:
                        continue
                    key = block["glslName"] + "." + member["name"]
                    if key not in values:
                        raise ValueError(f"Unprovided diagnostic uniform {key}")
                    value = values[key]
                    code = {"float": "f", "uint": "I", "int": "i", "bool": "I"}[member["scalar"]]
                    if len(value) * 4 != member["size"]:
                        raise ValueError(f"Unexpected diagnostic uniform width: {key}")
                    struct.pack_into("<" + code * len(value), data, member["offset"], *value)
                location = self.gl.glGetUniformBlockIndex(program, block["glslName"].encode())
                if location == 0xffffffff:
                    raise ValueError("Reflected diagnostic block absent from linked shader")
                handle = self.buffer(0x8a11, bytes(data))
                self.gl.glUniformBlockBinding(program, location, block_index)
                self.gl.glBindBufferBase(0x8a11, block_index, handle)
                buffers.append({"name": block["glslName"], "sha256": sha(data), "bytes": len(data)})
                block_index += 1
        texture_index = 0
        for stage in stages:
            for texture in stage["sidecar"]["textures"]:
                if texture["dimension"] != "texture2d" or texture["name"] not in texture_values:
                    raise ValueError(f"Unprovided diagnostic texture: {texture['name']}")
                for sampler in texture["samplers"]:
                    location = self.gl.glGetUniformLocation(program, sampler["glslName"].encode())
                    if location < 0:
                        raise ValueError("Reflected diagnostic sampler absent from linked shader")
                    self.gl.glActiveTexture(0x84c0 + texture_index)
                    self.gl.glBindTexture(0x0de1, texture_values[texture["name"]])
                    self.gl.glUniform1i(location, texture_index)
                    texture_index += 1
        self.buffer(0x8892, vertices)
        layout = {"POSITION": (3, 0x1406, 0, 0), "COLOR": (4, 0x1401, 1, 12),
                  "TEXCOORD": (4, 0x140b, 0, 16), "TEXCOORD1": (2, 0x140b, 0, 24)}
        for attribute in stages[0]["sidecar"]["attributes"]:
            key = attribute["semantic"] + (str(attribute["index"]) if attribute["index"] else "")
            if key not in layout:
                raise ValueError(f"Unprovided diagnostic vertex semantic: {key}")
            size, kind, normalize, offset = layout[key]
            location = self.gl.glGetAttribLocation(program, attribute["glslName"].encode())
            if location < 0:
                raise ValueError("Reflected diagnostic attribute absent from linked shader")
            self.gl.glEnableVertexAttribArray(location)
            self.gl.glVertexAttribPointer(location, size, kind, normalize, 28, C.c_void_p(offset))
        self.buffer(0x8893, indices)
        self.gl.glViewport(0, 0, 512, 512)
        self.gl.glDisable(0x0b44)
        self.gl.glDisable(0x0b71)
        self.gl.glEnable(0x0be2)
        self.gl.glBlendFunc(*blend)
        self.gl.glClearColor(0.025, 0.035, 0.055, 1)
        self.gl.glClear(0x4000)
        self.gl.glDrawElements(4, len(indices) // 2, 0x1403, None)
        self.gl.glFinish()
        out = (C.c_ubyte * (512 * 512 * 4))()
        self.gl.glReadPixels(0, 0, 512, 512, 0x1908, 0x1401, out)
        error = self.gl.glGetError()
        if error:
            raise ValueError(f"Offscreen diagnostic GL error: {error:04x}")
        rgba = np.frombuffer(out, dtype=np.uint8).reshape(512, 512, 4)[::-1].copy()
        return rgba, buffers

    def close(self):
        for handle in self.buffers:
            self.gl.glDeleteBuffers(1, C.byref(handle))
        for handle in self.textures:
            self.gl.glDeleteTextures(1, C.byref(handle))
        self.gl.glDeleteVertexArrays(1, C.byref(self.vao))
        self.gl.glDeleteFramebuffers(1, C.byref(self.framebuffer))
        super().close()


def positions(raw):
    return np.array([struct.unpack_from("<3f", raw, offset) for offset in range(0, len(raw), 28)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["shaders", "pairs", "angle_observation", "decoder", "native", "comparison", "effects", "angle", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    refs = {}
    def read(path):
        raw = path.read_bytes()
        refs[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    shaders, pairs, observed = read(args.shaders / "package.json"), read(args.pairs), read(args.angle_observation)
    meta, native, proof = read(args.decoder / "vfx-bound-quads.json"), read(args.native), read(args.comparison)
    effects = read(args.effects / "manifest.json")
    if observed["shaderPackageSha256"] != refs[str((args.shaders / "package.json").resolve())] or observed["counts"]["compileFailures"] or observed["counts"]["linkFailures"]:
        raise ValueError("Shader observation changed or failed")
    if proof["mismatchCount"] or proof["nativeEvidenceSha256"] != refs[str(args.native.resolve())] or proof["definitionSha256"] != refs[str((args.decoder / "vfx-bound-quads.json").resolve())]:
        raise ValueError("Native geometry evidence changed or failed")
    pair_index, pair = next((i, p) for i, p in enumerate(pairs["programs"]) if p["family"] == "quad" and p["defines"] == [{"name": "DISABLE_FOW", "value": "1"}])
    if not any(p["index"] == pair_index and p["success"] for p in observed["programs"]):
        raise ValueError("Diagnostic shader pair was not linked in the recorded observation")
    stages = []
    for stage in ["vertex", "pixel"]:
        path = args.shaders / pair[stage]["file"]
        value = read(path)
        if refs[str(path.resolve())] != pair[stage]["sha256"]:
            raise ValueError("Diagnostic shader changed")
        stages.append(value)
    renderer = Draw(args.angle)
    if renderer.info != observed["context"]:
        raise ValueError("Diagnostic ANGLE context differs from compiler observation")
    dlls = {name: sha((args.angle / name).read_bytes()) for name in ["libEGL.dll", "libGLESv2.dll"]}
    if dlls != observed["libraries"]:
        raise ValueError("Diagnostic ANGLE libraries differ from compiler observation")
    program = renderer.program(*stages)
    white = renderer.texture(np.full((1, 1, 4), 255, dtype=np.uint8), "clamp", "nearest")
    black = renderer.texture(np.zeros((1, 1, 4), dtype=np.uint8), "clamp", "nearest")
    examples = [("champions/ornn/0/0299df86", 0, [.1, .3, .5], "Ornn · brazier glow"),
                ("champions/ornn/0/b6b9e7e8", 0, [1/60, .05, .1], "Ornn · forge fire ring")]
    samples, evidence = [], []
    try:
        for effect, index, times, title in examples:
            definition = effects["definitions"][effect]
            source = read(args.effects / definition["file"])
            if refs[str((args.effects / definition["file"]).resolve())] != definition["sha256"]:
                raise ValueError("Diagnostic emitter source changed")
            emitter = source["definition"]["complexEmitterDefinitionData"][index]
            if emitter.get("blendMode") != 4:
                raise ValueError("Diagnostic requires the declared alpha-add blend mode")
            if any(k in emitter for k in ["textureMult", "alphaErosionDefinition", "paletteDefinition", "numFrames", "texDiv", "particleColorTexture"]):
                raise ValueError("Diagnostic emitter requires an unprovided material feature")
            ref = next(r for r in meta["templates"] if r["effectId"] == effect and r["emitterIndex"] == index)
            graph = read(args.decoder / ref["file"])
            if refs[str((args.decoder / ref["file"]).resolve())] != ref["sha256"]:
                raise ValueError("Diagnostic native graph changed")
            if bytes.fromhex(graph["assetObjectHex"])[0xc9] != 0 or bytes.fromhex(graph["assetObjectHex"])[0x12] != 0:
                raise ValueError("Diagnostic texture requires native repeat/bilinear sampler")
            case = next(c for c in native["cases"] if c["graphSha256"] == ref["sha256"] and c["mode"] == 0)
            frames = [next(f for f in case["frames"] if f["input"]["time"] == time) for time in times]
            all_positions = np.concatenate([positions(bytes.fromhex(f["output"]["geometry"]["verticesHex"])) for f in frames])
            center = (all_positions.max(axis=0) + all_positions.min(axis=0)) / 2
            _, _, axes = np.linalg.svd(all_positions - center, full_matrices=False)
            right, up = axes[:2]
            extent = np.max(np.abs((all_positions - center) @ axes[:2].T)) * 1.15
            if extent <= 0:
                raise ValueError("Diagnostic emitter has no visible extent")
            projection = np.array([[* (right / extent), -np.dot(center, right) / extent],
                                   [* (up / extent), -np.dot(center, up) / extent], [0, 0, 0, .5], [0, 0, 0, 1]], dtype=np.float32)
            asset = effects["assets"][emitter["texture"].lower()]
            if asset["status"] != "prepared" or asset["kind"] != "texture":
                raise ValueError("Diagnostic base texture is unprepared")
            texture_path = args.effects / asset["file"]
            texture_raw = texture_path.read_bytes()
            refs[str(texture_path.resolve())] = sha(texture_raw)
            if sha(texture_raw) != asset["sha256"]:
                raise ValueError("Diagnostic base texture changed")
            texture = renderer.texture(np.array(Image.open(texture_path).convert("RGBA")), "repeat", "linear")
            values = {"Globals_vs.TEXTURE_INFO": [1, 1, 1, 1], "Globals_vs.PARTICLE_DEPTH_PUSH_PULL": [0],
                      "PerFrameVertexCB_vs.mProj": projection.ravel().tolist(), "PerFrameVertexCB_vs.vCamera": [0, 0, 1000],
                      "Globals_ps.DEBUG_RENDERTARGET_IS_SRGB_HANDLED": [0], "PerFramePixelCB_ps.RENDERTARGET_IS_SRGB": [0]}
            textures = {"TEXTURE__TX": texture, "PARTICLE_COLOR_TEXTURE__TX": white,
                        "PIXEL_COLOR_REMAP_RAMP_SharedTexture": black}
            row = []
            for frame in frames:
                vertices = bytes.fromhex(frame["output"]["geometry"]["verticesHex"])
                indices = bytes.fromhex(frame["output"]["geometry"]["indicesHex"])
                rgba, blocks = renderer.draw(program, stages, vertices, indices, values, textures)
                foreground = np.any(rgba[:, :, :3] > np.array([7, 9, 14]), axis=2)
                if foreground.sum() < 100:
                    raise ValueError("Diagnostic shader produced no visible particle area")
                row.append((frame["input"]["time"], rgba, len(vertices) // 112))
                evidence.append({"effectId": effect, "emitterIndex": index, "time": frame["input"]["time"],
                    "verticesSha256": sha(vertices), "indicesSha256": sha(indices), "rgbaSha256": sha(rgba.tobytes()),
                    "foregroundPixels": int(foreground.sum()), "buffers": blocks, "suppliedValues": values})
            samples.append((title, row))
    finally:
        renderer.gl.glDeleteProgram(program)
        renderer.close()
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e8edf6", "figure.facecolor": "#0e1828"})
    fig, axes = plt.subplots(2, 3, figsize=(16, 12))
    fig.subplots_adjust(top=.79, bottom=.23, left=.05, right=.97, hspace=.26, wspace=.08)
    fig.text(.05, .95, "League's translated particle shaders now render native quad output", fontsize=22, weight="bold")
    fig.text(.05, .905, "Installed build 16.21.829.8620 · offscreen ANGLE / D3D11 WARP · no browser or League process", fontsize=12, color="#b3c6e2")
    for row_index, (title, row) in enumerate(samples):
        for column, (time, rgba, particles) in enumerate(row):
            axes[row_index, column].imshow(rgba)
            axes[row_index, column].axis("off")
            axes[row_index, column].set_title(f"{title}\n{time:.3f}s · {particles} native quads", color="#e8edf6", fontsize=12)
    fig.text(.05, .17, "Original inputs: native positions, packed colors, half-float UVs, indices and prepared game texture.", fontsize=12)
    fig.text(.05, .135, "Supplied diagnostic inputs: fitted camera, identity atlas, zero push/pull, linear RGBA8 target, SRC_ALPHA + ONE blending.", fontsize=11, color="#c5b58f")
    fig.text(.05, .10, "White particle-color lookup and transparent remap texture are explicit neutral inputs; fog is disabled for this diagnostic.", fontsize=11, color="#c5b58f")
    fig.text(.05, .055, "Material/resource acquisition, game render passes, browser output and reference pixel comparison remain unverified.", fontsize=11, color="#c5b58f")
    fig.savefig(args.output, dpi=125, facecolor=fig.get_facecolor())
    result = {"schema": 1, "kind": "translated-particle-shader-visual", "build": shaders["build"],
        "sources": refs, "imageSha256": sha(args.output.read_bytes()), "rendererSha256": sha(Path(__file__).read_bytes()),
        "angleAdapterSha256": sha(Path(__file__).with_name("observe-shader-angle.py").read_bytes()),
        "context": renderer.info, "libraries": dlls, "shaderPairIndex": pair_index, "samples": evidence,
        "scope": {"nativeBindingsRecovered": False, "browserRendered": False, "referencePixelsCompared": False,
            "materialFeatures": ["DISABLE_FOW=1"], "blend": "SRC_ALPHA + ONE", "particleColorLookup": "supplied 1x1 white",
            "colorRemapLookup": "supplied 1x1 transparent black", "mainViewerIntegrated": False}}
    args.output.with_suffix(".json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"imageSha256": result["imageSha256"], "samples": len(evidence)}))


if __name__ == "__main__":
    main()
