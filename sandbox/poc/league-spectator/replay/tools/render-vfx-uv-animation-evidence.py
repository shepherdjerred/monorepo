"""Plot native UV matrices over time; this is not a game/GPU render."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import PillowWriter
from matplotlib.patches import Rectangle
import numpy as np

from vfx_spawn_native import sha
from vfx_uv_animation_native import NativeUvAnimation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "client", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    comparison = json.loads(args.comparison.read_bytes())
    if comparison["mismatches"]:
        raise ValueError("Refusing mismatched UV animation diagnostic")
    kernel = NativeUvAnimation(args.package, args.client)
    meta = kernel.checked_json("vfx-uv-animation.json", "vfxUvAnimationSha256")
    if comparison["definitionSha256"] != kernel.profile["vfxUvAnimationSha256"]:
        raise ValueError("UV diagnostic package changed")
    selections = [("base/combined/clamp0/flip0", "Base: wrap + rotation", "base"),
                  ("base/combined/clamp1/flip0", "Base: clamp + rotation", "base"),
                  ("mult/combined/clamp0/flip1", "Second layer: wrap + flips", "mult"),
                  ("mult/combined/clamp1/flip1", "Second layer: clamp + flips", "mult")]
    times = np.linspace(0, 1.5, 49)
    corpus = []
    for case_id, title, layer in selections:
        binding = next(v for v in meta["controlledBindings"] if v["id"] == case_id)
        reference = next(v for v in meta["templates"] if v["sha256"] == binding["graphSha256"])
        raw = (args.package / reference["file"]).read_bytes()
        if sha(raw) != reference["sha256"]:
            raise ValueError("UV diagnostic graph changed")
        graph = json.loads(raw)
        kernel.restore_graph(graph)
        birth_input = {"emitterAge": .65, "chance": .6875}
        birth = kernel.birth(birth_input)
        frames = []
        for time in times:
            value = {"age": float(time), "normalizedAge": min(1, float(time)/.75), "lifetime": .75, "chance": .6875}
            actual = kernel.sample(birth["records"], value)
            frames.append({"input": value, "output": actual})
        corpus.append({"id": case_id, "title": title, "layer": layer, "graphSha256": reference["sha256"],
                       "birthInput": birth_input, "birth": birth, "frames": frames})
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e5edf8", "axes.labelcolor": "#a4b9d5",
                         "xtick.color": "#a4b9d5", "ytick.color": "#a4b9d5", "font.size": 10})
    fig, axes = plt.subplots(2, 2, figsize=(12.8, 9), dpi=100, facecolor="#0c1423")
    fig.subplots_adjust(left=.07, right=.97, bottom=.16, top=.84, wspace=.25, hspace=.38)
    fig.text(.05, .94, "Native UV motion", fontsize=24, weight="bold")
    fig.text(.05, .895, "Original base/secondary texture transforms  /  build 16.21.829.8620", fontsize=12, color="#a4b9d5")
    clock = fig.text(.8, .935, "", fontsize=17, color="#62dbb4")
    grid = []
    for coordinate in np.linspace(0, 1, 5):
        grid += [np.array([[coordinate, coordinate], [0., 1.]]), np.array([[0., 1.], [coordinate, coordinate]])]
    bounds = [np.array([[0., 1.], [0., 1.]])]
    corners = np.array([[0., 1., 1., 0.], [0., 0., 1., 1.]])
    for item in corpus:
        for frame in item["frames"]:
            values = np.frombuffer(bytes.fromhex(frame["output"]["matrices"][item["layer"]]), dtype="<f4").astype(float)
            a, b, c, d, tx, ty = values
            bounds.append(np.array([[a, c], [b, d]])@corners+np.array([[tx], [ty]]))
    bounds = np.concatenate(bounds, axis=1)
    low, high = bounds.min(axis=1)-.2, bounds.max(axis=1)+.2
    lines, markers = [], []
    for ax, item in zip(axes.flat, corpus):
        ax.set_facecolor("#101e30")
        ax.set_title(item["title"], loc="left", fontsize=12, color="#e5edf8", pad=9)
        ax.set_aspect("equal", adjustable="box")
        ax.set_xlim(low[0], high[0]); ax.set_ylim(low[1], high[1])
        ax.add_patch(Rectangle((0, 0), 1, 1, fill=True, facecolor="#2b3a4f", edgecolor="#ffcc83", linewidth=1.2))
        ax.set_xlabel("U"); ax.set_ylabel("V")
        for spine in ax.spines.values(): spine.set_color("#34485f")
        color = "#59b5e8" if item["layer"] == "base" else "#b58cfc"
        lines.append([ax.plot([], [], color=color, linewidth=1.6, alpha=.9)[0] for _ in grid])
        markers.append(ax.plot([], [], marker="o", color="#62dbb4", markersize=5)[0])
    fig.text(.05, .07, "Colored grid: native affine matrix applied to a unit UV grid. Gold square: reference unit tile.", fontsize=10)
    fig.text(.05, .035, "Controlled inputs; negative scale, 72 degrees/s, supplied age/chance. Software diagram, not texture sampling or game footage.",
             fontsize=9, color="#a4b9d5")
    def draw(index):
        clock.set_text(f"age {times[index]:.2f}s")
        for n, item in enumerate(corpus):
            raw = bytes.fromhex(item["frames"][index]["output"]["matrices"][item["layer"]])
            a, b, c, d, tx, ty = np.frombuffer(raw, dtype="<f4").astype(float)
            matrix = np.array([[a, c], [b, d]])
            offset = np.array([[tx], [ty]])
            for line, source in zip(lines[n], grid):
                target = matrix@source+offset
                line.set_data(target[0], target[1])
            markers[n].set_data([tx], [ty])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    writer = PillowWriter(fps=16)
    with writer.saving(fig, str(args.output), 100):
        for index in range(len(times)):
            draw(index); writer.grab_frame(facecolor=fig.get_facecolor())
    draw(16)
    png = args.output.with_suffix(".png")
    fig.savefig(png, facecolor=fig.get_facecolor())
    plt.close(fig)
    evidence = {"schema": 1, "definitionSha256": kernel.profile["vfxUvAnimationSha256"],
                "nativeSha256": comparison["nativeSha256"], "moduleSha256": comparison["moduleSha256"],
                "rendererSha256": sha(Path(__file__).read_bytes()),
                "scope": "Original CPU matrices on controlled inputs, plotted with an explicitly chosen 2x3 column-major UV-grid convention. No GPU or texture sampling.",
                "cases": corpus, "artifacts": {name.name: sha(name.read_bytes()) for name in [args.output, png]}}
    args.output.with_suffix(".json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({"gif": str(args.output), "png": str(png), "nativeMatrices": len(corpus)*len(times)}))


if __name__ == "__main__":
    main()
