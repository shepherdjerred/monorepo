"""Compile and link prepared GLSL in an offscreen ANGLE ES3/WARP context.

Only the named EGL/GLES DLLs are loaded. No browser, window, desktop capture or
League process is used. This records compiler/linker observations, not pixels,
browser acceptance, reconstructed runtime bindings, or presentation fidelity.
"""
import argparse
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import time


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Angle:
    def __init__(self, directory):
        self.directory = directory.resolve()
        self.dll_directory = os.add_dll_directory(str(self.directory))
        self.egl = C.WinDLL(str(self.directory / "libEGL.dll"))
        self.gl = C.WinDLL(str(self.directory / "libGLESv2.dll"))
        self.fn(self.egl, "eglGetProcAddress", C.c_void_p, C.c_char_p)
        self.fn(self.egl, "eglInitialize", C.c_uint, C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int))
        self.fn(self.egl, "eglChooseConfig", C.c_uint, C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_void_p), C.c_int, C.POINTER(C.c_int))
        self.fn(self.egl, "eglCreateContext", C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_int))
        self.fn(self.egl, "eglCreatePbufferSurface", C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_int))
        self.fn(self.egl, "eglMakeCurrent", C.c_uint, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p)
        self.fn(self.egl, "eglQueryString", C.c_char_p, C.c_void_p, C.c_int)
        self.fn(self.egl, "eglGetError", C.c_uint)
        self.fn(self.egl, "eglDestroyContext", C.c_uint, C.c_void_p, C.c_void_p)
        self.fn(self.egl, "eglDestroySurface", C.c_uint, C.c_void_p, C.c_void_p)
        self.fn(self.egl, "eglTerminate", C.c_uint, C.c_void_p)
        address = self.egl.eglGetProcAddress(b"eglGetPlatformDisplayEXT")
        if not address:
            raise ValueError("ANGLE has no eglGetPlatformDisplayEXT")
        platform = C.WINFUNCTYPE(C.c_void_p, C.c_uint, C.c_void_p, C.POINTER(C.c_int))(address)
        self.display = platform(0x3202, None, self.ints(0x3203, 0x3208, 0x3209, 0x320b, 0x3038))
        self.check(self.display, "ANGLE D3D11/WARP display")
        major, minor = C.c_int(), C.c_int()
        self.check(self.egl.eglInitialize(self.display, C.byref(major), C.byref(minor)), "eglInitialize")
        extensions = self.egl.eglQueryString(self.display, 0x3055).decode().split()
        if "EGL_ANGLE_create_context_webgl_compatibility" not in extensions:
            raise ValueError("ANGLE has no explicit WebGL compatibility context option")
        config, count = C.c_void_p(), C.c_int()
        self.check(self.egl.eglChooseConfig(self.display,
            self.ints(0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3038),
            C.byref(config), 1, C.byref(count)), "eglChooseConfig")
        if count.value != 1:
            raise ValueError("No ES3 RGBA8 pbuffer configuration")
        self.context = self.egl.eglCreateContext(self.display, config, None, self.ints(0x3098, 3, 0x33ac, 1, 0x3038))
        self.check(self.context, "WebGL-compatible ES3 context")
        self.surface = self.egl.eglCreatePbufferSurface(self.display, config, self.ints(0x3057, 1, 0x3056, 1, 0x3038))
        self.check(self.surface, "offscreen pbuffer")
        self.check(self.egl.eglMakeCurrent(self.display, self.surface, self.surface, self.context), "eglMakeCurrent")
        for name, result, args in [
            ("glGetString", C.c_char_p, [C.c_uint]),
            ("glGetError", C.c_uint, []),
            ("glCreateShader", C.c_uint, [C.c_uint]),
            ("glShaderSource", None, [C.c_uint, C.c_int, C.POINTER(C.c_char_p), C.POINTER(C.c_int)]),
            ("glCompileShader", None, [C.c_uint]),
            ("glGetShaderiv", None, [C.c_uint, C.c_uint, C.POINTER(C.c_int)]),
            ("glGetShaderInfoLog", None, [C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_char_p]),
            ("glDeleteShader", None, [C.c_uint]),
            ("glCreateProgram", C.c_uint, []),
            ("glAttachShader", None, [C.c_uint, C.c_uint]),
            ("glLinkProgram", None, [C.c_uint]),
            ("glGetProgramiv", None, [C.c_uint, C.c_uint, C.POINTER(C.c_int)]),
            ("glGetProgramInfoLog", None, [C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_char_p]),
            ("glDeleteProgram", None, [C.c_uint]),
        ]:
            self.fn(self.gl, name, result, *args)
        self.info = {"egl": [major.value, minor.value], "version": self.gl.glGetString(0x1f02).decode(),
            "renderer": self.gl.glGetString(0x1f01).decode(), "vendor": self.gl.glGetString(0x1f00).decode(),
            "shadingLanguage": self.gl.glGetString(0x8b8c).decode(), "webglCompatibility": True,
            "surface": "1x1 RGBA8 pbuffer", "requestedBackend": "D3D11 WARP"}
        if "Microsoft Basic Render Driver" not in self.info["renderer"]:
            raise ValueError(f"Expected WARP renderer: {self.info['renderer']}")

    @staticmethod
    def fn(library, name, result, *args):
        function = getattr(library, name)
        function.restype, function.argtypes = result, args

    @staticmethod
    def ints(*values):
        return (C.c_int * len(values))(*values)

    def check(self, result, action):
        if not result:
            raise ValueError(f"{action} failed: EGL {self.egl.eglGetError():04x}")

    def log(self, handle, program):
        size = C.c_int()
        query = self.gl.glGetProgramiv if program else self.gl.glGetShaderiv
        query(handle, 0x8b84, C.byref(size))
        out = C.create_string_buffer(max(size.value, 1))
        read = self.gl.glGetProgramInfoLog if program else self.gl.glGetShaderInfoLog
        read(handle, len(out), None, out)
        return out.value.decode("utf-8", errors="strict")

    def compile(self, source, stage):
        if stage not in ["vertex", "pixel"]:
            raise ValueError(f"Unknown shader stage: {stage}")
        handle = self.gl.glCreateShader(0x8b31 if stage == "vertex" else 0x8b30)
        if not handle:
            raise ValueError("ANGLE could not create the diagnostic shader object")
        text = source.encode("utf-8")
        self.gl.glShaderSource(handle, 1, C.byref(C.c_char_p(text)), C.byref(C.c_int(len(text))))
        self.gl.glCompileShader(handle)
        status = C.c_int()
        self.gl.glGetShaderiv(handle, 0x8b81, C.byref(status))
        return handle, bool(status.value), self.log(handle, False)

    def link(self, vertex, pixel):
        handle = self.gl.glCreateProgram()
        self.gl.glAttachShader(handle, vertex)
        self.gl.glAttachShader(handle, pixel)
        self.gl.glLinkProgram(handle)
        status = C.c_int()
        self.gl.glGetProgramiv(handle, 0x8b82, C.byref(status))
        log = self.log(handle, True)
        self.gl.glDeleteProgram(handle)
        return bool(status.value), log

    def close(self):
        self.egl.eglMakeCurrent(self.display, None, None, None)
        self.egl.eglDestroySurface(self.display, self.surface)
        self.egl.eglDestroyContext(self.display, self.context)
        self.egl.eglTerminate(self.display)
        self.dll_directory.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "pairs", "angle", "output"]:
        parser.add_argument(name, type=Path)
    parser.add_argument("--families", nargs="+", required=True,
                        help="Exact program families to link; stage compilation still covers the complete package")
    args = parser.parse_args()
    manifest_raw = (args.package / "package.json").read_bytes()
    manifest = json.loads(manifest_raw)
    pair_raw = args.pairs.read_bytes()
    pairs = json.loads(pair_raw)
    if manifest["build"] != "16.21.829.8620" or manifest["kind"] != "installed-particle-shader-translations" or pairs["shaderPackageSha256"] != sha(manifest_raw):
        raise ValueError("Shader pair inventory changed")
    if len(set(args.families)) != len(args.families) or not set(args.families).issubset({g["name"] for g in pairs["groups"]}):
        raise ValueError("Unknown or duplicate shader family")
    selected = [(i, p) for i, p in enumerate(pairs["programs"]) if p["family"] in args.families]
    dlls = {name: sha((args.angle / name).read_bytes()) for name in ["libEGL.dll", "libGLESv2.dll"]}
    angle = Angle(args.angle)
    compiled, stages, links = {}, [], []
    started = time.perf_counter()
    print(json.dumps(angle.info), flush=True)
    try:
        for i, ref in enumerate(manifest["translations"]):
            raw = (args.package / ref["file"]).read_bytes()
            dxbc = (args.package / ref["dxbc"]).read_bytes()
            if sha(raw) != ref["sha256"] or sha(dxbc) != ref["dxbcSha256"]:
                raise ValueError("Prepared shader bytes changed")
            handle, success, log = angle.compile(json.loads(raw)["glsl"], ref["stage"])
            key = ref["stage"] + ":" + ref["dxbcSha256"]
            compiled[key] = (handle, success)
            stages.append({"key": key, "sha256": ref["sha256"], "success": success, "log": log})
            if (i + 1) % 100 == 0:
                print(json.dumps({"compiled": i + 1, "of": len(manifest["translations"])}), flush=True)
        linked_pairs = {}
        for observed_index, (i, program) in enumerate(selected):
            vertex = compiled["vertex:" + program["vertex"]["dxbcSha256"]]
            pixel = compiled["pixel:" + program["pixel"]["dxbcSha256"]]
            pair_key = (program["vertex"]["dxbcSha256"], program["pixel"]["dxbcSha256"])
            if pair_key in linked_pairs:
                success, log = linked_pairs[pair_key]
            elif vertex[1] and pixel[1]:
                success, log = angle.link(vertex[0], pixel[0])
                linked_pairs[pair_key] = (success, log)
            else:
                success, log = False, "Stage compilation failed; link not attempted"
            links.append({"index": i, "family": program["family"], "success": success, "log": log})
            if (observed_index + 1) % 100 == 0:
                print(json.dumps({"linked": observed_index + 1, "of": len(selected)}), flush=True)
        error = angle.gl.glGetError()
        if error:
            raise ValueError(f"GL error after observations: {error:04x}")
    finally:
        for handle, _ in compiled.values():
            angle.gl.glDeleteShader(handle)
        angle.close()
    if any(sha((args.angle / name).read_bytes()) != digest for name, digest in dlls.items()):
        raise ValueError("ANGLE libraries changed during observation")
    result = {"schema": 1, "kind": "offscreen-angle-shader-observation", "build": manifest["build"],
        "shaderPackageSha256": sha(manifest_raw), "pairInventorySha256": sha(pair_raw),
        "observerSha256": sha(Path(__file__).read_bytes()), "libraries": dlls, "context": angle.info,
        "selectedFamilies": args.families,
        "unobservedFamilies": [g["name"] for g in pairs["groups"] if g["name"] not in args.families],
        "elapsedSeconds": time.perf_counter() - started, "stages": stages, "programs": links,
        "counts": {"compiled": len(stages), "compileFailures": sum(not s["success"] for s in stages),
            "linked": len(links), "uniqueLinks": len(linked_pairs),
            "unobservedPrograms": len(pairs["programs"]) - len(links),
            "linkFailures": sum(not p["success"] for p in links)},
        "scope": {"browserRun": False, "gameRun": False, "desktopUsed": False,
            "pixelsCompared": False, "runtimeBindingsRecovered": False, "mainViewerIntegrated": False}}
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result["counts"]), flush=True)
    if result["counts"]["compileFailures"] or result["counts"]["linkFailures"]:
        raise SystemExit("Shader compiler/linker failures recorded; do not mark the package GPU-ready")


if __name__ == "__main__":
    main()
