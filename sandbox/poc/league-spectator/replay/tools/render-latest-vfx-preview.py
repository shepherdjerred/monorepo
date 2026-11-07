"""Software orthographic preview of the browser sampler's actual quad draw data.

This is a diagnostic asset rendering, not a WebGL screenshot or League reference.
"""
import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("effects", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    evidence_bytes = args.evidence.read_bytes()
    evidence = json.loads(evidence_bytes)
    sample = evidence["softwarePreview"]
    draws = sample["draws"]
    if not draws:
        raise ValueError("No preview draw data")
    textures = {}

    def texture(asset):
        if asset["file"] not in textures:
            path = (args.effects / asset["file"]).resolve()
            if not path.is_relative_to(args.effects.resolve()):
                raise ValueError("VFX texture escapes asset root")
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != asset["sha256"]:
                raise ValueError("VFX preview texture hash mismatch")
            textures[asset["file"]] = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float64) / 255
        return textures[asset["file"]]

    def bilinear(data, uv, sampler):
        if sampler["pixelated"]:
            raise ValueError("Pixelated preview sampling is unimplemented")
        height, width = data.shape[:2]
        xy = uv * [width, height] - .5
        floor = np.floor(xy).astype(np.int64)
        weight = xy - floor
        def address(indices, size):
            if sampler["name"] == "repeat":
                return indices % size
            if sampler["name"] == "clamp":
                return np.clip(indices, 0, size-1)
            if sampler["name"] == "mirror":
                tile = indices % (2*size)
                return np.where(tile<size, tile, 2*size-1-tile)
            raise ValueError("Unknown software texture address mode")
        x, y = address(floor[..., 0], width), address(floor[..., 1], height)
        xx, yy = address(floor[..., 0]+1, width), address(floor[..., 1]+1, height)
        wx, wy = weight[..., 0, None], weight[..., 1, None]
        return (data[y, x] * (1-wx) + data[y, xx] * wx) * (1-wy) + (data[yy, x] * (1-wx) + data[yy, xx] * wx) * wy

    width, height, header, footer = 1500, 1120, 150, 120
    pixels = np.empty((height, width, 3), dtype=np.float64)
    pixels[:] = np.array([12, 20, 31]) / 255
    corners = np.asarray([point for draw in draws for point in draw["positions"]])[:, [0, 2]]
    center = (corners.min(axis=0) + corners.max(axis=0)) * .5
    span = np.maximum(corners.max(axis=0) - corners.min(axis=0), 1)
    scale = min((width-160)/span[0], (height-header-footer-100)/span[1])
    origin = np.array([width*.5, header+(height-header-footer)*.5])

    def project(value):
        return (np.asarray(value)[:, [0, 2]] - center) * [scale, -scale] + origin

    for draw in sorted(draws, key=lambda draw: draw["pass"]):
        quad = project(draw["positions"])
        lo = np.maximum(np.floor(quad.min(axis=0)).astype(int), [0, header])
        hi = np.minimum(np.ceil(quad.max(axis=0)).astype(int), [width-1, height-footer-1])
        if np.any(lo > hi):
            continue
        xx, yy = np.meshgrid(np.arange(lo[0], hi[0]+1)+.5, np.arange(lo[1], hi[1]+1)+.5)
        points = np.stack([xx, yy], axis=-1)
        inside = np.zeros(xx.shape, dtype=bool)
        sampled_uv = np.zeros((*xx.shape, 2))
        multi_uv = np.zeros_like(sampled_uv)
        indices = np.asarray(draw["indices"]).reshape(-1, 3)
        for triangle in indices:
            tri = quad[triangle]
            basis = np.column_stack([tri[1]-tri[0], tri[2]-tri[0]])
            if abs(np.linalg.det(basis)) < 1e-8:
                continue
            local = (points-tri[0]) @ np.linalg.inv(basis).T
            mask = (local[..., 0] >= 0) & (local[..., 1] >= 0) & (local.sum(axis=-1) <= 1)
            for key, target_uv in [("uv", sampled_uv), ("multUv", multi_uv)]:
                uv = np.asarray(draw[key])[triangle]
                interpolated = uv[0] + local[..., 0, None]*(uv[1]-uv[0]) + local[..., 1, None]*(uv[2]-uv[0])
                target_uv[:] = np.where(mask[..., None], interpolated, target_uv)
            inside |= mask
        color = bilinear(texture(draw["texture"]), sampled_uv, draw["baseSampler"]) * draw["color"]
        if draw["multTexture"]:
            color *= bilinear(texture(draw["multTexture"]), multi_uv, draw["multSampler"])
        alpha = np.clip(color[..., 3, None], 0, 1)
        target = pixels[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
        result = color[..., :3]*alpha + target * (1 if draw["blend"] == 4 else 1-alpha)
        target[:] = np.where(inside[..., None], np.clip(result, 0, 1), target)
    image = Image.fromarray(np.rint(np.clip(pixels, 0, 1)*255).astype(np.uint8))
    text = ImageDraw.Draw(image)
    font_path = Path(matplotlib.get_data_path()) / "fonts/ttf/DejaVuSans.ttf"
    title, body, small = [ImageFont.truetype(str(font_path), size) for size in [34, 20, 17]]
    text.text((48, 25), "Experimental missile particles", font=title, fill="#eff5fc")
    missile_count = len({draw["entityId"] for draw in draws})
    text.text((48, 82), f"LoL {evidence['build']}  |  {sample['time']:.3f}s  |  {missile_count} missile instances  |  {len(draws)} textured quads",
              font=body, fill="#9de0ca")
    text.text((48, height-103), "SOFTWARE ORTHOGRAPHIC PREVIEW — NOT A BROWSER OR LEAGUE SCREENSHOT", font=small, fill="#ffc47b")
    text.text((48, height-72), "Decoded tracks and skin textures; original birth/update and quad writer supply particle state and vertices.", font=small, fill="#aec0d3")
    text.text((48, height-42), "Partial emitters and preview shader/basis/linger conventions. WebGL appearance and reference fidelity remain unverified.",
              font=small, fill="#aec0d3")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output)
    print(json.dumps({"output":str(args.output), "textures":len(textures), "quads":len(draws),
        "evidenceSha256":hashlib.sha256(evidence_bytes).hexdigest(),
        "sha256":hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
