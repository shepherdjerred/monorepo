"""Render static bindings and native event-request observations, not game frames."""
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
    for name in ["package", "native", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = (args.package / "animation-events.json").read_bytes()
    native_raw, comparison_raw = args.native.read_bytes(), args.comparison.read_bytes()
    meta, native, comparison = json.loads(raw), json.loads(native_raw), json.loads(comparison_raw)
    if (comparison["mismatchCount"] or comparison["definitionSha256"] != sha(raw)
        or native["definitionSha256"] != sha(raw) or comparison["nativeEvidenceSha256"] != sha(native_raw)):
        raise ValueError("Unmatched animation scheduling evidence")
    counts = {source["actor"]: Counter() for source in meta["assets"]["graphs"]}
    for group in meta["groups"]:
        actor = group["actor"]
        counts.setdefault(actor, Counter()).update(e["binding"]["status"] for e in group["events"])
    actors = list(counts)
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e8edf6", "axes.labelcolor": "#b9c6dc",
        "xtick.color": "#b9c6dc", "ytick.color": "#b9c6dc", "axes.edgecolor": "#3d4a63",
        "axes.facecolor": "#172237", "figure.facecolor": "#101827"})
    fig, (left, right) = plt.subplots(1, 2, figsize=(14, 8.4), gridspec_kw={"width_ratios": [1, 1.08]})
    fig.subplots_adjust(top=.78, bottom=.30, left=.13, right=.97, wspace=.25)
    fig.text(.06, .93, "Animation effects: binding and activation requests", fontsize=20, weight="bold")
    fig.text(.06, .875, f"Exact build {meta['build']}  |  624 authored particle events across 10 equipped champion skins", fontsize=11, color="#a9bddb")
    statuses = [("prepared-definition", "Prepared definition", "#56cead"),
                ("null-object-link", "Explicit null resource", "#e2b56b"),
                ("no-declared-effect-key", "No declared effect key", "#b6a2ed")]
    offset = np.zeros(len(actors))
    for status, label, color in statuses:
        values = np.array([counts[a][status] for a in actors])
        left.barh(range(len(actors)), values, left=offset, color=color, label=label, height=.65)
        offset += values
    left.set_yticks(range(len(actors)), [a.split('/')[1].capitalize()+" / "+a.split('/')[2] for a in actors])
    left.invert_yaxis()
    left.set_xlabel("Authored events (asset resolution, not rendered effects)", labelpad=10)
    left.set_title("602 prepared  /  21 null  /  1 missing key", color="#e8edf6", pad=15, fontsize=12)
    left.legend(loc="upper left", bbox_to_anchor=(0, -.22), frameon=False, labelcolor="#b9c6dc", fontsize=9)
    left.spines[["top", "right"]].set_visible(False)
    group = next(g for g in meta["groups"] if g["actor"] == "champions/ornn/0" and g["path"][-1] == "Spell2")
    sequence = next(s for s in native["sequences"] if s["name"] == "authored" and s["actor"] == group["actor"] and s["path"] == group["path"])
    labels = [e["authored"]["mEffectKey"] for e in group["events"]]
    indices = {e["id"]: i for i, e in enumerate(group["events"])}
    plotted = []
    for frame in sequence["frames"]:
        if frame["input"]["resync"]:
            continue
        for request in frame["output"]["requests"]:
            if request["kind"] != "activate-request":
                continue
            x, y = frame["input"]["frame"], indices[request["event"]]
            right.plot([0, x], [y, y], color="#445e82", linewidth=2)
            right.scatter([x], [y], color="#56cead", s=110, zorder=3)
            right.annotate(f"frame {x:g}", (x, y), (0, 14), textcoords="offset points", ha="center", color="#e8edf6", fontsize=11)
            plotted.append({"event": request["event"], "frame": x})
    right.set_xlim(-1, 29)
    right.set_ylim(-.6, len(labels)-.2)
    right.set_yticks(range(len(labels)), [label.replace("Ornn_", "") for label in labels])
    right.set_xlabel("Native scheduler input frame (not replay seconds)", labelpad=10)
    right.set_title("Ornn Spell2: original forward-dispatch requests", color="#e8edf6", pad=15, fontsize=12)
    right.grid(axis="x", color="#33415a", alpha=.6)
    right.spines[["top", "right"]].set_visible(False)
    fig.text(.56, .15, f"{comparison['frames']:,} observations + {comparison['restoredFrames']:,} restored frames\n"
        f"+ {comparison['resetFrames']:,} reset frames: zero mismatches", fontsize=11, color="#56cead", linespacing=1.6)
    fig.text(.06, .055, "Component evidence only. Effect creation, bone attachment, replay-time binding, interruption/loop policy,\n"
        "sound, browser/GPU rendering and comparison against League playback remain unverified.", fontsize=10, color="#a9bddb", linespacing=1.5)
    fig.savefig(args.output, dpi=150)
    plt.close(fig)
    args.output.with_suffix('.json').write_text(json.dumps({"schema": 1, "build": meta["build"],
        "definitionSha256": sha(raw), "nativeEvidenceSha256": sha(native_raw), "comparisonSha256": sha(comparison_raw),
        "rendererSha256": sha(Path(__file__).read_bytes()), "imageSha256": sha(args.output.read_bytes()),
        "plotted": plotted, "scope": __doc__}, indent=2), encoding="utf-8")
    print(json.dumps({"file": str(args.output), "sha256": sha(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
