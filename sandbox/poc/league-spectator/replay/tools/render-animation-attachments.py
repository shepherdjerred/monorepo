"""Visualize static bone joins and controlled native request evidence."""
import argparse
from collections import Counter
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = (args.package / "animation-attachments.json").read_bytes()
    comparison_raw = args.comparison.read_bytes()
    meta, proof = json.loads(raw), json.loads(comparison_raw)
    if proof["definitionSha256"] != sha(raw) or proof["mismatchCount"]:
        raise ValueError("Unmatched native attachment evidence")
    fields = ["mBoneName", "mTargetBoneName"]
    counts = {f: Counter(p[f]["status"] for g in meta["groups"] for e in g["events"] for p in e["pairs"]) for f in fields}
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e8edf6", "axes.labelcolor": "#b9c6dc",
        "xtick.color": "#b9c6dc", "ytick.color": "#b9c6dc", "axes.edgecolor": "#3d4a63",
        "axes.facecolor": "#172237", "figure.facecolor": "#101827"})
    fig, (left, right) = plt.subplots(1, 2, figsize=(14, 8.4), gridspec_kw={"width_ratios": [1.1, 1]})
    fig.subplots_adjust(top=.76, bottom=.32, left=.1, right=.96, wspace=.22)
    fig.text(.06, .925, "Effect attachment: original activation and cleanup", fontsize=21, weight="bold")
    fig.text(.06, .87, "Build 16.21.829.8620  |  Serialized bone hashes → static rig joins → controlled native requests", fontsize=11, color="#a9bddb")
    offset = np.zeros(2)
    statuses = [("static-rig-joint", "Static rig joint", "#56cead"), ("root", "Zero hash / root", "#729de8"),
                ("unresolved-static-bone", "Unresolved bone", "#e2b56b")]
    for status, label, color in statuses:
        values = np.array([counts[f][status] for f in fields])
        left.barh([0, 1], values, left=offset, height=.5, color=color, label=label)
        for i, value in enumerate(values):
            if value > 20:
                left.text(offset[i]+value/2, i, str(value), ha="center", va="center", color="#101827", weight="bold", fontsize=12)
        offset += values
    left.set_yticks([0, 1], ["Source", "Target"])
    left.invert_yaxis()
    left.set_ylim(1.7, -.7)
    left.set_xlabel("Authored bone references (including repeated names)", labelpad=12)
    left.set_title("638 joint references · 630 roots · 2 unresolved", pad=18, color="#e8edf6", fontsize=12)
    left.spines[["top", "right"]].set_visible(False)
    left.legend(loc="upper left", bbox_to_anchor=(0, -.2), frameon=False, labelcolor="#b9c6dc", fontsize=9)
    right.set_axis_off()
    right.set_xlim(0, 1)
    right.set_ylim(0, 1)
    right.set_title("Original code decides these requests", pad=18, color="#e8edf6", fontsize=12)
    labels = ["Read supplied bone pose or owner position", "Request effect creation", "Select source / target / detached / afterimage",
              "Retain the returned event handle", "On cleanup: stop, release, clear handles"]
    for i, label in enumerate(labels):
        y = .91-i*.19
        right.text(.5, y, label, ha="center", va="center", fontsize=10,
            bbox={"boxstyle": "round,pad=.7", "facecolor": "#22334e", "edgecolor": "#56cead"})
        if i < len(labels)-1:
            right.annotate("", xy=(.5, y-.14), xytext=(.5, y-.05), arrowprops={"arrowstyle": "->", "color": "#729de8", "lw": 1.5})
    fig.text(.55, .19, f"{proof['cases']} cases · {proof['requests']:,} requests\n{proof['originalBlocks']} original blocks audited · zero mismatches", color="#56cead", fontsize=12, linespacing=1.6)
    fig.text(.06, .055, "Request evidence only. Authored cases now use original-constructed ELF keys; poses remain supplied and factories are sinks.\n"
        "World poses, dynamic bones, animation-speed context and attached particle rendering remain unverified.", fontsize=10, color="#a9bddb", linespacing=1.5)
    fig.savefig(args.output, dpi=150)
    plt.close(fig)
    args.output.with_suffix('.json').write_text(json.dumps({"schema": 1, "definitionSha256": sha(raw),
        "comparisonSha256": sha(comparison_raw), "rendererSha256": sha(Path(__file__).read_bytes()),
        "imageSha256": sha(args.output.read_bytes()), "boneReferences": {k: dict(v) for k,v in counts.items()},
        "scope": __doc__}, indent=2), encoding="utf-8")
    print(json.dumps({"file": str(args.output), "sha256": sha(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
