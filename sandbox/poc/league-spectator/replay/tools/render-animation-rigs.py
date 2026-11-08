"""Visualize native rig key construction and the observed duplicate-name policy."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package", "comparison", "attachments", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = (args.package / "animation-rigs.json").read_bytes()
    proof_raw, attachment_raw = args.comparison.read_bytes(), args.attachments.read_bytes()
    meta, proof, attachments = json.loads(raw), json.loads(proof_raw), json.loads(attachment_raw)
    if (proof["definitionSha256"] != sha(raw) or proof["mismatchCount"] or attachments["mismatchCount"] or
        attachments["animationRigsSha256"] != sha(raw) or attachments["rigJoinedCases"] != 617):
        raise ValueError("Unmatched rig/attachment evidence")
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e8edf6", "axes.labelcolor": "#b9c6dc",
        "xtick.color": "#b9c6dc", "ytick.color": "#b9c6dc", "axes.edgecolor": "#3d4a63",
        "axes.facecolor": "#172237", "figure.facecolor": "#101827"})
    fig, (left, right) = plt.subplots(1, 2, figsize=(14, 9), gridspec_kw={"width_ratios": [1, 1.15]})
    fig.subplots_adjust(top=.78, bottom=.28, left=.19, right=.96, wspace=.18)
    fig.text(.06, .93, "Native bone keys replace authored placeholders", fontsize=21, weight="bold")
    fig.text(.06, .875, f"Build {meta['build']}  |  {proof['rigs']} complete rig constructions · {proof['joints']:,} joints · {proof['originalBlocks']} original blocks", fontsize=11, color="#a9bddb")
    graphs = list(meta["graphs"].values())
    labels = [g["actor"].split('/', 1)[1] for g in graphs]
    values = [len(g["joints"]) for g in graphs]
    colors = ["#56cead" if g["actor"].startswith('champions/') else "#729de8" for g in graphs]
    left.barh(range(len(graphs)), values, color=colors, height=.65)
    left.set_yticks(range(len(graphs)), labels, fontsize=8)
    left.invert_yaxis()
    left.set_xlabel("Constructed joints", labelpad=10)
    left.set_title("Champions and prepared world actors", color="#e8edf6", fontsize=11, pad=15)
    left.spines[["top", "right"]].set_visible(False)
    right.set_axis_off()
    right.set_xlim(0, 1)
    right.set_ylim(0, 1)
    ornn = next(g for g in graphs if g["actor"] == 'champions/ornn/0')
    hand = next(b for b in ornn["bindings"] if b["name"].lower() == 'l_hand')
    right.text(.5, .97, "Observed name → key → pose selection", ha="center", fontsize=12, weight="bold")
    for y, label in [(.85, f"l_hand: event FNV 0x{hand['fnvHash']:08x}"),
                     (.65, f"Original constructor + rig lookup\nStored ELF key 0x{hand['resolvedBoneKey']:08x}"),
                     (.45, f"Name and ELF getters select pose {hand['nativePoseIndex']}")]:
        right.text(.5, y, label, ha="center", va="center", fontsize=11,
            bbox={"boxstyle": "round,pad=.7", "facecolor": "#22334e", "edgecolor": "#56cead"})
    for y in [.79, .58]:
        right.annotate("", xy=(.5, y-.08), xytext=(.5, y), arrowprops={"arrowstyle": "->", "color": "#729de8", "lw": 1.5})
    alias = proof["aliases"][0]
    right.text(.5, .24, "Duplicate minion weapon-bone name", ha="center", fontsize=11, color="#a9bddb")
    for x, index in zip([.3, .7], alias["candidates"]):
        color = "#56cead" if index == alias["selected"] else "#69778d"
        right.scatter([x], [.13], s=1000, color=color)
        right.text(x, .13, str(index), ha="center", va="center", fontsize=13, color="#101827", weight="bold")
    right.text(.5, .01, f"Native map selects joint {alias['selected']}", ha="center", fontsize=11, color="#56cead")
    fig.text(.19, .165, f"{proof['lookups']:,} key lookups + {proof['poseSelections']:,} supplied-pose selections\nZero mismatches", color="#56cead", fontsize=12, linespacing=1.6)
    fig.text(.61, .165, f"617 authored attachment cases now use native keys\nAll {attachments['requests']:,} requests still match", color="#56cead", fontsize=12, linespacing=1.6)
    fig.text(.06, .055, "Static construction and request evidence only. Allocation/copy and bounded libc++ next-prime are explicit services.\n"
        "Pose transforms are supplied; native world-pose production, dynamic bones and actual attached particle rendering remain unverified.", fontsize=10, color="#a9bddb", linespacing=1.5)
    fig.savefig(args.output, dpi=150)
    plt.close(fig)
    args.output.with_suffix('.json').write_text(json.dumps({"schema": 1, "definitionSha256": sha(raw),
        "comparisonSha256": sha(proof_raw), "attachmentEvidenceSha256": sha(attachment_raw),
        "rendererSha256": sha(Path(__file__).read_bytes()), "imageSha256": sha(args.output.read_bytes()),
        "scope": __doc__}, indent=2), encoding="utf-8")
    print(json.dumps({"file": str(args.output), "sha256": sha(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
