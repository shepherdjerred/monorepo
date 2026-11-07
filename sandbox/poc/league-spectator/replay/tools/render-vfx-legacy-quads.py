"""Plot measured native quad lifecycles; does not render a game or browser."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.native.read_bytes()
    native = json.loads(raw)
    comparison_raw = args.comparison.read_bytes()
    comparison = json.loads(comparison_raw)
    if comparison["nativeSha256"] != sha(raw) or comparison["mismatches"]:
        raise ValueError("Native quad visual requires current matching comparison")
    for name, digest in comparison["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes()) != digest:
            raise ValueError(f"Stale native quad visual source {name}")
    selected = native["cases"][0]["graphSha256"]
    cases = [c for c in native["cases"] if c["graphSha256"] == selected]
    moving = next(c for c in cases if c["mode"] == 1)
    turned = next(c for c in cases if c["mode"] == 2)
    stationary = cases[0]
    def samples(case):
        result = []
        for frame in case["frames"]:
            geometry = bytes.fromhex(frame["output"]["geometry"]["verticesHex"])
            if not geometry:
                result.append({"time": frame["input"]["time"], "alive": False})
                continue
            vertices = [list(struct.unpack_from("<3f", geometry, at)) for at in range(0, len(geometry), 28)]
            packed = struct.unpack_from("<I", geometry, 12)[0]
            result.append({"time": frame["input"]["time"], "alive": True, "vertices": vertices,
                           "center": np.mean(vertices, axis=0).tolist(),
                           "rgba": [((packed >> bit) & 255)/255 for bit in [16, 8, 0, 24]],
                           "size": struct.unpack_from("<2f", bytes.fromhex(frame["output"]["state"]["vectors"]["attributes"]["hex"]), 0x14),
                           "pose": frame["input"]["current"]})
        return result
    data = {name: samples(case) for name, case in [("stationary", stationary), ("moving", moving), ("turning", turned)]}
    plt.rcParams.update({"figure.facecolor": "#0c141f", "axes.facecolor": "#101e2c", "axes.edgecolor": "#66809a",
                         "text.color": "#e8f1fa", "axes.labelcolor": "#b8cee0", "xtick.color": "#a7bed3",
                         "ytick.color": "#a7bed3", "grid.color": "#3c5267", "font.size": 10})
    fig = plt.figure(figsize=(15, 9), dpi=150)
    ax = fig.add_subplot(221, projection="3d")
    plotted = set()
    for row in data["moving"]:
        if not row["alive"] or row["time"] not in [0, .05, .1, .2] or row["time"] in plotted:
            continue
        plotted.add(row["time"])
        v = np.asarray(row["vertices"])
        color = row["rgba"][:3]
        ax.add_collection3d(Poly3DCollection([v], facecolors=[(*color, .12)], edgecolors=[(*color, 1)], linewidths=1.3,
                                            label=f"{row['time']:.2f}s"))
    ax.set(xlim=(-220, 250), ylim=(-310, 150), zlim=(-50, 120), xlabel="World X", ylabel="World Y", zlabel="World Z",
           title="Original birth + update + quad writer\nSupplied moving pose, identity system basis")
    ax.view_init(elev=28, azim=-62)
    for axis in [ax.xaxis, ax.yaxis, ax.zaxis]:
        axis.pane.set_facecolor("#101e2c")
    ax.legend(fontsize=8, labelcolor="#d5e6f6", facecolor="#172a3b", loc="upper right")
    ax = fig.add_subplot(222)
    for name, color in [("moving", "#80e8cc"), ("turning", "#ff9ba8")]:
        live = [v for v in data[name] if v["alive"]]
        # Compare each measured center to the exact externally supplied pose.
        y = [np.linalg.norm(np.asarray(v["center"])-v["pose"]) for v in live]
        ax.plot([v["time"] for v in live], y, "o-", color=color, label=f"{name}: center-to-supplied-pose distance")
    ax.set(title="Native binding retains the authored 100-unit offset", xlabel="Supplied elapsed emitter time (s)", ylabel="Center-to-supplied-pose distance", xlim=(0,.34), ylim=(95,105))
    ax.ticklabel_format(axis="y", style="plain", useOffset=False)
    ax.grid(alpha=.3); ax.legend(fontsize=8, labelcolor="#d5e6f6", facecolor="#172a3b")
    ax = fig.add_subplot(223)
    live = [v for v in data["stationary"] if v["alive"]]
    times = [v["time"] for v in live]
    ax.plot(times, [v["size"][0] for v in live], "o-", color="#80e8cc", label="Native size X attribute")
    ax.plot(times, [v["size"][1] for v in live], "s-", color="#ffd18a", label="Native size Y attribute")
    ax.axvspan(.30001, .6, color="#67768a", alpha=.2, label="No vertices after native removal")
    ax.set(title="Authored scale sampling and lifecycle", xlabel="Supplied elapsed emitter time (s)", ylabel="Native size attribute", xlim=(0,.6))
    ax.grid(alpha=.3); ax.legend(fontsize=8, labelcolor="#d5e6f6", facecolor="#172a3b")
    ax = fig.add_subplot(224)
    for lane, name, color in [(0,"R","#ff879d"),(1,"G","#80e8cc"),(2,"B","#9daaff"),(3,"A","#ffd18a")]:
        ax.plot(times, [v["rgba"][lane] for v in live], "o-", label=name, color=color, markersize=3)
    ax.set(title="Color after the original ARGB packing", xlabel="Supplied elapsed emitter time (s)", ylabel="Byte / 255", xlim=(0,.34), ylim=(-.04,1.04))
    ax.grid(alpha=.3); ax.legend(ncol=4, fontsize=8, labelcolor="#d5e6f6", facecolor="#172a3b")
    fig.suptitle(f"Native legacy-quad lifecycle | LoL {native['build']}", fontsize=20, x=.04, ha="left", y=.98)
    fig.text(.04,.925,f"{comparison['graphs']} authored projections · {comparison['frames']} frames · {comparison['repeatFrames']} reset frames · zero native/WASM mismatches", color="#80e8cc", fontsize=12)
    fig.text(.04,.045,"CONTROLLED SOFTWARE DIAGNOSTIC — no match clock/orientation binding, textures, shader, browser or League reference.", color="#ffd18a", fontsize=10)
    fig.subplots_adjust(left=.07,right=.97,top=.84,bottom=.12,hspace=.42,wspace=.25)
    args.output.parent.mkdir(exist_ok=True, parents=True)
    fig.savefig(args.output, facecolor=fig.get_facecolor())
    plt.close(fig)
    evidence = {"schema": 1, "build": native["build"], "protocol": native["protocol"],
                "nativeSha256": sha(raw), "comparisonSha256": sha(comparison_raw),
                "rendererSha256": sha(Path(__file__).read_bytes()), "imageSha256": sha(args.output.read_bytes()),
                "graphSha256": selected, "samples": data, "scope": comparison["scope"]}
    args.output.with_suffix(".json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({"image": str(args.output), "sha256": evidence["imageSha256"]}))


if __name__ == "__main__":
    main()
