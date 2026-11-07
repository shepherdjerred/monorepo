"""Render decoded path anchors as a diagnostic, not a spectator screenshot."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text())
    if report["coordinateSpace"] != "signed16-relative-grid" or report["movementOrigin"] is not None:
        raise ValueError("Expected explicitly unaligned movement report")
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e3edf6", "axes.labelcolor": "#a8b9cd",
                         "xtick.color": "#8ea3bb", "ytick.color": "#8ea3bb", "axes.edgecolor": "#354252"})
    figure, axes = plt.subplots(2, 5, figsize=(16, 8.2), facecolor="#101822", sharex=True, sharey=True)
    points = None
    for hero, axis in zip(report["heroes"], axes.flat):
        records = [r for r in report["movement"] if r["entityId"] == hero["entityId"]]
        anchors = [r["encodedWaypoints"][0] for r in records]
        x, z = [p[0] * 2 for p in anchors], [p[1] * 2 for p in anchors]
        color = "#6ac6ff" if hero["team"] == 100 else "#ff9a9e"
        axis.set_facecolor("#15212e")
        if anchors:
            axis.plot(x, z, color=color, alpha=0.35, linewidth=0.7)
            points = axis.scatter(x, z, c=[r["time"] for r in records], cmap="viridis", s=5, vmin=0, vmax=report["endTime"])
            axis.scatter(x[0], z[0], marker="o", facecolors="none", edgecolors="white", s=60, linewidths=1)
        axis.set_title(f"{hero['champion']}\n0x{hero['entityId']:08x}  ·  {len(records)} records", color=color, fontsize=10, pad=10)
        axis.grid(color="#2a394a", alpha=0.65, linewidth=0.5)
        axis.set_aspect("equal", adjustable="box")
        axis.tick_params(labelsize=8)
    figure.suptitle(f"Latest-build decoded movement  |  first {report['endTime']:g} seconds", fontsize=21, x=0.06, ha="left", y=0.98)
    figure.text(0.06, 0.915, f"{report['summary']['heroes']} decoded champion identities  ·  {report['summary']['heroMovementRecords']:,} champion path records  ·  build {report['build']}", color="#a8b9cd", fontsize=11)
    figure.supxlabel("Relative X (game units; map origin unresolved)", y=0.085, fontsize=10)
    figure.supylabel("Relative Z (game units)", x=0.015, fontsize=10)
    figure.text(0.06, 0.025, "Diagnostic only. Dots are recorded path anchors; lines connect observations. No map alignment, animation, or visual fidelity claim.", color="#a8b9cd", fontsize=10)
    figure.subplots_adjust(left=0.06, right=0.94, bottom=0.14, top=0.85, hspace=0.4, wspace=0.18)
    if points is not None:
        color_axis = figure.add_axes([0.955, 0.19, 0.012, 0.61])
        bar = figure.colorbar(points, cax=color_axis)
        bar.set_label("Replay time (seconds)", fontsize=9)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(args.output, dpi=130, facecolor=figure.get_facecolor())
    plt.close(figure)
    print(str(args.output))


if __name__ == "__main__":
    main()
