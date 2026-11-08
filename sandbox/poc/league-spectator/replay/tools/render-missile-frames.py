"""Plot native versus browser controller traces; this is not a game render."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    evidence_bytes = args.evidence.read_bytes()
    evidence = json.loads(evidence_bytes)
    if evidence["mismatches"] or evidence["framesMatched"] != evidence["frames"]:
        raise ValueError("Refusing to plot unadmitted frame comparison")
    traces = evidence["representativeTraces"]
    if not traces:
        raise ValueError("No controller traces to plot")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
        "figure.facecolor": "#0f1824", "axes.facecolor": "#152436", "text.color": "#edf3fb",
        "axes.labelcolor": "#b4c7dc", "xtick.color": "#b4c7dc", "ytick.color": "#b4c7dc",
        "axes.edgecolor": "#3a5066", "grid.color": "#30475d", "legend.facecolor": "#152436",
        "legend.edgecolor": "#3a5066", "savefig.facecolor": "#0f1824"})
    with_phases = bool(evidence.get("actorDefinitionSha256"))
    columns = 3 if with_phases else 2
    fig, axes = plt.subplots(len(traces), columns, figsize=(17 if with_phases else 13, 3.4 * len(traces) + 2.1), squeeze=False)
    fig.subplots_adjust(left=.085, right=.97, top=.80, bottom=.13, hspace=.72, wspace=.25)
    fig.suptitle("Missile movement, phase and stop" if with_phases else "Complete missile controller frames",
        x=.06, y=.97, ha="left", fontsize=23, weight="bold")
    fig.text(.06, .915, f"LoL {evidence['build']}  |  {evidence['eligibleRecords']} sampled records  |  "
        f"{evidence['framesMatched']:,} frames matched bit for bit", color="#8ee3c5", fontsize=12)
    fig.text(.06, .875, "Original executable routines vs browser-compatible translation. "
        "Representative traces at a supplied 60 Hz clock.", color="#b4c7dc", fontsize=10)
    for row, trace in enumerate(traces):
        frames = trace["frames"]
        times = [0] + [frame["time"] for frame in frames]
        native = [trace["source"]] + [frame["nativePosition"] for frame in frames]
        browser = [trace["source"]] + [frame["browserPosition"] for frame in frames]
        title = trace["spell"].replace("/", " · ")
        axes[row, 0].set_title(title, loc="left", pad=14, weight="bold")
        for ax, lane, ylabel in [(axes[row, 0], 0, "X position (game units)"),
                                (axes[row, 1], 1, "Height Y (game units)")]:
            ax.plot(times, [point[lane] for point in native], color="#8ee3c5", linewidth=2.4,
                    label="Original routine + declared adapters")
            ax.plot(times, [point[lane] for point in browser], color="#ffb86c", linewidth=0,
                    marker="o", markersize=3.7, markerfacecolor="none", label="Browser translation")
            ax.set_xlabel("Seconds since snapshot (supplied clock)")
            ax.set_ylabel(ylabel)
            ax.grid(alpha=.65)
        axes[row, 1].set_title(f"Recorded packet age: {trace['elapsedSeconds']:.3f}s", loc="left", pad=14)
        if with_phases:
            ax = axes[row, 2]
            phase_times = [frame["time"] for frame in frames]
            for side, color, marker in [("native", "#8ee3c5", None), ("browser", "#ffb86c", "o")]:
                speed = [math.hypot(frame["actor"][side]["velocity"][0], frame["actor"][side]["velocity"][2]) for frame in frames]
                ax.plot(phase_times, speed, color=color, linewidth=2.4 if side == "native" else 0,
                    marker=marker, markersize=3.7, markerfacecolor="none")
            last = frames[-1]["actor"]["native"]
            ax.set_title(f"Endpoint: phase {last['phase']}, stopped={str(last['stopped']).lower()}", loc="left", pad=14)
            ax.set_ylabel("Planar speed after phase callbacks")
            ax.set_xlabel("Seconds since snapshot (supplied clock)")
            ax.grid(alpha=.65)
    axes[0, 0].legend(fontsize=8.5, loc="best")
    fig.text(.06, .062, "CONTROLLER DIAGNOSTIC — NOT A GAME RENDER", fontsize=11, weight="bold", color="#ffb86c")
    fig.text(.06, .035, "Windows CRT powf adapter; bounds notification skipped. " +
        ("Presentation-stop callback counted; collision, children, particle lifetime, VFX and reference playback are not validated."
         if with_phases else "Actor collision, phase/lifetime, VFX and reference playback are not validated."), fontsize=9, color="#b4c7dc")
    fig.savefig(args.output, dpi=150, metadata={"Description": "Evidence SHA-256 " + hashlib.sha256(evidence_bytes).hexdigest()})
    plt.close(fig)
    print(json.dumps({"traces": len(traces), "output": str(args.output),
                      "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
