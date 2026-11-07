"""Static RGBA8 inputs for complete-parent materials; no replay data."""
import hashlib
import json
import pathlib
import sys
from PIL import Image

cache = pathlib.Path(sys.argv[1]).resolve()
assets = cache / "public"
target = assets / "latest-parent-textures"
target.mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
packages = {}
for name in ["latest-parent-frame-caches/package.json", "latest-complete-quad-gpu/package.json", "latest-trail-particles/gpu.json"]:
    data = (assets / name).read_bytes()
    packages[name] = {"sha256": sha(data), "value": json.loads(data)}
roots = {v["effectId"] for v in packages["latest-parent-frame-caches/package.json"]["value"]["caches"]}
textures = {}
for name in ["latest-complete-quad-gpu/package.json", "latest-trail-particles/gpu.json"]:
    for emitter in packages[name]["value"]["emitters"]:
        if emitter["effectId"] not in roots:
            continue
        for binding in emitter["textures"].values():
            if binding["kind"] != "prepared-texture":
                if binding["kind"] not in ["supplied-white-lookup", "supplied-transparent-remap"]:
                    raise ValueError("Unknown parent texture binding")
                continue
            key = binding["sha256"]
            if key in textures:
                if textures[key]["sourceFile"] != binding["file"]:
                    raise ValueError("Ambiguous parent texture source")
                continue
            source = assets / "latest-effects" / binding["file"]
            if sha(source.read_bytes()) != key:
                raise ValueError("Parent PNG source changed")
            with Image.open(source) as image:
                image.load()
                rgba = image.convert("RGBA")
                width, height = rgba.size
                data = rgba.tobytes()
            digest = sha(data)
            filename = f"rgba-{digest}.bin"
            (target / filename).write_bytes(data)
            textures[key] = {"sourceFile": binding["file"], "sourceSha256": key,
                             "file": filename, "sha256": digest, "bytes": len(data),
                             "width": width, "height": height}
result = {"schema": 1, "kind": "prepared-parent-rgba8-textures",
          "build": "16.21.829.8620", "protocol": "20e09df23c66b85e",
          "packages": {k: v["sha256"] for k, v in packages.items()},
          "preparerSha256": sha(pathlib.Path(__file__).read_bytes()),
          "effects": sorted(roots), "textures": textures,
          "scope": {"containsReplayData": False, "pixelFormat": "RGBA8",
                    "rowOrder": "source-top-to-bottom", "premultiplied": False,
                    "colorSpaceConversion": False, "mipmaps": False}}
data = (json.dumps(result, indent=2) + "\n").encode()
(target / "package.json").write_bytes(data)
print(json.dumps({"sha256": sha(data), "textures": len(textures),
                  "bytes": sum(t["bytes"] for t in textures.values())}))
