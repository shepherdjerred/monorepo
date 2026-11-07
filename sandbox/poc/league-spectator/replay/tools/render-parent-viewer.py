"""Offscreen view of actual THREE-committed buffers, materials and texture pixels."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

spec = importlib.util.spec_from_file_location("parent_draw", Path(__file__).with_name("render-particle-shader.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
cache, angle = map(lambda s: Path(s).resolve(), sys.argv[1:3])
assets = cache / "public"
inputs = {}
def raw(path):
    data = path.read_bytes()
    inputs[str(path.resolve())] = adapter.sha(data)
    return data
def read(path):
    return json.loads(raw(path))
proof_path = cache / "research/parent-viewer.json"
proof = read(proof_path)
if proof["kind"] != "complete-parent-viewer-flow-comparison" or proof["mismatchCount"] or proof["counts"]["canonicalFrames"] != 37:
    raise ValueError("Actual viewer flow lacks native comparison")
for name, digest in proof["sources"].items():
    if adapter.sha(raw(Path(__file__).parent.parent / name)) != digest:
        raise ValueError("Viewer flow source changed: " + name)
for name, digest in proof["inputs"].items():
    if adapter.sha(raw(Path(name))) != digest:
        raise ValueError("Viewer flow input changed: " + name)
catalog = read(assets / "latest-parent-textures/package.json")
rgba_refs = {t["sha256"]: t for t in catalog["textures"].values()}
reference = read(cache / "research/parent-frames-native.json")
renderer = adapter.Draw(angle)
if renderer.info != reference["context"]:
    raise ValueError("Viewer diagnostic context changed")
for name, digest in reference["libraries"].items():
    if adapter.sha(raw(angle / name)) != digest:
        raise ValueError("Viewer diagnostic graphics library changed")
programs, textures, panels, draws = {}, {}, [], []
clear = renderer.gl.glClear
try:
    for capture in proof["captures"]:
        renderer.gl.glClearColor(.025, .035, .055, 1)
        clear(0x4000)
        renderer.gl.glClear = lambda mask: None
        rgba = None
        for geometry in sorted(capture["geometry"], key=lambda g: g["sortPass"]):
            material = proof["materials"][geometry["materialKey"]]
            key = geometry["materialKey"]
            if key not in programs:
                stages = []
                for stage, field in [("vertex", "vertexShader"), ("pixel", "fragmentShader")]:
                    ref = material["shaders"][stage]
                    data = raw(assets / "latest-shaders" / ref["file"])
                    if adapter.sha(data) != ref["sha256"]:
                        raise ValueError("Actual material's game shader source changed")
                    shader = json.loads(data)
                    if shader["glsl"] != "#version 300 es\n" + material[field]:
                        raise ValueError("Actual THREE material shader differs from prepared game source")
                    stages.append(shader)
                programs[key] = renderer.program(*stages), stages
            program, stages = programs[key]
            blocks = {b["name"]: bytes.fromhex(b["bytesHex"]) for b in geometry["blocks"]}
            values = {}
            for shader in stages:
                for block in shader["sidecar"]["blocks"]:
                    data = blocks[block["glslName"]]
                    if len(data) != block["size"]:
                        raise ValueError("Actual uniform buffer has the wrong size")
                    for member in block["members"]:
                        if member["used"]:
                            code = {"float": "f", "uint": "I", "int": "i", "bool": "I"}[member["scalar"]]
                            values[block["glslName"] + "." + member["name"]] = list(struct.unpack_from("<" + code * (member["size"] // 4), data, member["offset"]))
            bound = {}
            for shader in stages:
                for texture in shader["sidecar"]["textures"]:
                    choices = [geometry["textures"][s["glslName"]] for s in texture["samplers"]]
                    if not choices or any(c != choices[0] for c in choices):
                        raise ValueError("Actual texture has ambiguous sampler bindings")
                    binding = choices[0]
                    tk = json.dumps(binding, sort_keys=True)
                    if tk not in textures:
                        digest = binding["sha256"]
                        if digest in rgba_refs:
                            ref = rgba_refs[digest]
                            data = raw(assets / "latest-parent-textures" / ref["file"])
                            width, height = ref["width"], ref["height"]
                        else:
                            # Only the two explicit neutral shader resources.
                            candidates = [bytes([255] * 4), bytes(4)]
                            data = next((d for d in candidates if adapter.sha(d) == digest), None)
                            if data is None:
                                raise ValueError("Actual texture pixels lack a static resource")
                            width = height = 1
                        if adapter.sha(data) != digest or [width, height] != [binding["width"], binding["height"]]:
                            raise ValueError("Actual texture pixels or dimensions changed")
                        if binding["wrapS"] != binding["wrapT"] or binding["minFilter"] != binding["magFilter"]:
                            raise ValueError("Diagnostic adapter requires matching texture axes and filters")
                        address = {1000: "repeat", 1001: "clamp", 1002: "mirror"}[binding["wrapS"]]
                        filtering = {1003: "nearest", 1006: "linear"}[binding["minFilter"]]
                        pixels = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 4)
                        textures[tk] = renderer.texture(pixels, address, filtering)
                    bound[texture["name"]] = textures[tk]
            blend = material["blend"]
            if blend[0] != blend[1] or blend[2] != blend[3]:
                raise ValueError("Diagnostic adapter requires shared color/alpha factors")
            vertices, indices = bytes.fromhex(geometry["verticesHex"]), bytes.fromhex(geometry["indicesHex"])
            rgba, buffers = renderer.draw(program, stages, vertices, indices, values, bound, blend=(blend[0], blend[2]))
            draws.append({"time": capture["time"], "sequence": geometry["sequence"], "emitterIndex": geometry["emitterIndex"],
                          "verticesSha256": adapter.sha(vertices), "indicesSha256": adapter.sha(indices), "uniformBuffers": buffers})
        renderer.gl.glClear = clear
        if rgba is None:
            raise ValueError("Actual committed capture produced no draws")
        foreground = np.any(rgba[:, :, :3] > np.array([7, 9, 14]), axis=2)
        if foreground.sum() < 100:
            raise ValueError("Actual committed capture produced no visible particle area")
        linear = rgba[:, :, :3].astype(np.float64) / 255
        display = np.clip(np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055), 0, 1)
        panels.append({"time": capture["time"], "draws": len(capture["geometry"]), "foregroundPixels": int(foreground.sum()),
                       "rgbaSha256": adapter.sha(rgba.tobytes()), "display": display})
finally:
    renderer.gl.glClear = clear
    for program, _ in programs.values():
        renderer.gl.glDeleteProgram(program)
    renderer.close()
fig, axes = plt.subplots(1, 2, figsize=(14, 8), facecolor="#101822")
for ax, panel in zip(axes.flat, panels):
    ax.imshow(panel["display"])
    ax.axis("off")
    ax.set_title(f'{panel["time"]:.3f}s · {panel["draws"]} committed draws', color="#e9eef7", fontsize=12)
fig.suptitle("Replay viewer → complete native parents → committed THREE geometry", color="#e9eef7", fontsize=17, y=.97)
fig.text(.5, .91, "Real material loading, workers, seekable playback, frame commit and RGBA textures", ha="center", color="#a9bacf", fontsize=11)
fig.text(.5, .06, "Offscreen ANGLE rendering of actual committed buffers; browser GPU submission and League parity unverified.", ha="center", color="#d8bd8b", fontsize=10)
fig.text(.5, .025, "Supplied activation, stop, seeds, independent contexts, scene and fitted camera. Diagnostic depth/culling disabled.", ha="center", color="#d8bd8b", fontsize=9)
fig.subplots_adjust(top=.85, bottom=.11, left=.025, right=.985, wspace=.09)
output = assets / "evidence/latest-parent-viewer.png"
fig.savefig(output, dpi=110, facecolor=fig.get_facecolor())
plt.close(fig)
result = {"schema": 1, "kind": "committed-parent-viewer-offscreen-diagnostic", "flowProofSha256": inputs[str(proof_path)],
          "inputs": inputs, "rendererSha256": adapter.sha(Path(__file__).read_bytes()), "imageSha256": adapter.sha(output.read_bytes()),
          "context": renderer.info, "counts": {"panels": len(panels), "draws": len(draws), "programs": len(programs)},
          "draws": draws, "panels": [{k: v for k, v in p.items() if k != "display"} for p in panels],
          "scope": {"actualCommittedThreeBuffersAndUniforms": True, "actualDataTexturePixels": True, "translatedGameShaders": True,
                    "suppliedSceneAndCamera": True, "diagnosticDepthAndCullingDisabled": True,
                    "browserExecuted": False, "threeGpuSubmissionObserved": False, "referenceCompared": False}}
output.with_suffix(".json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({"image": str(output), "sha256": result["imageSha256"], "counts": result["counts"]}))
