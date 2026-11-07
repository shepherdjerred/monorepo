"""Render a numeric UV admission diagnostic; never a frame of the game."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("comparison", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.comparison.read_bytes())
    if data["mismatches"]:
        raise ValueError("Refusing mismatched UV diagnostic")
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e5edf8", "axes.labelcolor": "#b4c5db",
                         "xtick.color": "#b4c5db", "ytick.color": "#b4c5db", "font.size": 12})
    fig = plt.figure(figsize=(16, 9), dpi=120, facecolor="#0c1423")
    fig.text(.06, .92, "Recovering League's effect texture setup", fontsize=25, weight="bold")
    fig.text(.06, .87, "Exact build 16.21.829.8620  /  original CPU predicate versus JavaScript", fontsize=13, color="#a4b9d5")
    ax = fig.add_axes([.22, .40, .30, .36], facecolor="#0c1423")
    keys = ["00", "10", "01", "11"]
    labels = ["No extra UV records", "Base layer only", "Second layer only", "Both layers"]
    counts = [data["recordFlagsHistogram"][key] for key in keys]
    colors = ["#536782", "#59b5e8", "#b58cfc", "#62dbb4"]
    ax.barh(labels, counts, color=colors, height=.58)
    ax.invert_yaxis()
    ax.set_xlim(0, max(counts)*1.25)
    ax.set_xlabel("Prepared complex emitters")
    ax.tick_params(length=0)
    for spine in ax.spines.values(): spine.set_visible(False)
    for i, count in enumerate(counts):
        ax.text(count+35, i, f"{count:,}", va="center", weight="bold")
    fig.text(.57, .73, f'{data["emitters"]:,}', fontsize=37, weight="bold", color="#62dbb4")
    fig.text(.57, .68, "authored emitter inputs agree", fontsize=16)
    fig.text(.57, .59, f'{data["controlledCases"]:,} controlled cases  |  {data["originalBlocks"]} original CPU blocks', fontsize=13)
    fig.text(.57, .51, f'{data["birthUVOffsetPresenceDisagreements"]:,} cases disagree with checking', fontsize=16, color="#ffcc83")
    fig.text(.57, .47, "only whether birthUVOffset is present", fontsize=14, color="#ffcc83")
    fig.text(.06, .27, "Recovered inputs", fontsize=16, weight="bold")
    fig.text(.06, .22, "Offset  /  scroll  /  rotation  /  scale  /  flips  /  flex values", fontsize=14, color="#b4c5db")
    fig.text(.06, .15, "Native nuance: an empty base flex object enables UV records; an empty second-layer flex object does not.", fontsize=12)
    fig.text(.06, .08, "Numeric research diagnostic. Curves are not sampled here. Texture loading, UV evolution and shaders remain separate.",
             fontsize=11, color="#a4b9d5")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(args.output)


if __name__ == "__main__":
    main()
