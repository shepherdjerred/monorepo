"""Plot observed clock/pose changes; this is not a browser or game screenshot."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "comparison", "poses", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = (args.package / "animation-clock.json").read_bytes()
    comparison_raw, poses_raw = args.comparison.read_bytes(), args.poses.read_bytes()
    comparison, poses = json.loads(comparison_raw), json.loads(poses_raw)
    if (comparison["mismatchCount"] or poses["mismatchCount"] or
        comparison["definitionSha256"] != sha(raw) or poses["definitionSha256"] != sha(raw)):
        raise ValueError("Unmatched native clock and pose evidence")
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e8edf6", "axes.labelcolor": "#b9c6dc",
        "xtick.color": "#b9c6dc", "ytick.color": "#b9c6dc", "axes.edgecolor": "#3d4a63",
        "axes.facecolor": "#172237", "figure.facecolor": "#101827"})
    fig, axes = plt.subplots(1, 2, figsize=(14, 7.7))
    fig.subplots_adjust(top=.74, bottom=.30, left=.08, right=.96, wspace=.22)
    fig.text(.06, .92, "Animation clocks now drive scene pose selection", fontsize=21, weight="bold")
    fig.text(.06, .865, "Build 16.21.829.8620  |  Original frame-count, duration, event-frame and pose-time rules", fontsize=11, color="#a9bddb")
    for ax, curve in zip(axes, poses["curves"]):
        times = [s["elapsed"] for s in curve["samples"]]
        old_times = [curve["oldDuration"]*i/120 for i in range(121)]
        ax.plot(old_times, [min(curve["oldFrames"]-1, t*curve["oldFps"]) for t in old_times], color="#e2b56b", linestyle="--", linewidth=2, label="Previous direct clip time")
        ax.plot(times, [s["nativeFrame"] for s in curve["samples"]], color="#56cead", linewidth=2.5, label="Recovered pose clock")
        ax.scatter([times[-1]], [curve["samples"][-1]["nativeFrame"]], s=60, color="#56cead", zorder=3)
        actor = curve["actor"].split('/')[1].capitalize()
        ax.set_title(f"{actor}: {curve['name']}\nDuration {curve['oldDuration']:.3f}s → {curve['nativeDuration']:.3f}s", fontsize=12, color="#e8edf6", pad=16)
        ax.set_xlabel("Local animation time (seconds)", labelpad=10)
        ax.set_ylabel("Source pose frame")
        ax.grid(color="#33415a", alpha=.6)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].legend(loc="upper left", frameon=False, labelcolor="#b9c6dc", fontsize=9)
    fig.text(.08, .155, f"{comparison['samples']:,} native clock observations\nZero float32 bit mismatches", color="#56cead", fontsize=12, linespacing=1.6)
    fig.text(.54, .155, f"{poses['clipNames']} clip names / {poses['assets']} pose assets\n{poses['comparedPrefixValues']:,} existing pose values preserved", color="#56cead", fontsize=12, linespacing=1.6)
    fig.text(.06, .055, "Software evidence, not a game frame. Toolkit pose interpolation and graph transitions remain approximate.\n"
        "Recorded playback-rate semantics, particle attachment, browser/GPU output and League A/V comparison remain unverified.", fontsize=10, color="#a9bddb", linespacing=1.5)
    fig.savefig(args.output, dpi=150)
    plt.close(fig)
    args.output.with_suffix('.json').write_text(json.dumps({"schema": 1, "definitionSha256": sha(raw),
        "comparisonSha256": sha(comparison_raw), "poseEvidenceSha256": sha(poses_raw),
        "rendererSha256": sha(Path(__file__).read_bytes()), "imageSha256": sha(args.output.read_bytes()),
        "scope": __doc__}, indent=2), encoding="utf-8")
    print(json.dumps({"file": str(args.output), "sha256": sha(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
