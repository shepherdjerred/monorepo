"""Plot reference-position residuals from the independent native replay probe."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("report", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
report = json.loads(args.report.read_text())
observations = report["observations"]
if not observations or any("baselineDistance" not in item or "distance" not in item for item in observations):
    raise ValueError("Expected complete paired movement observations")
baseline = sorted(item["baselineDistance"] for item in observations)
current = sorted(item["distance"] for item in observations)
plt.style.use("dark_background")
fig, (distribution, timeline) = plt.subplots(1, 2, figsize=(12, 5))
fig.patch.set_facecolor("#091823")
for axis in (distribution, timeline):
    axis.set_facecolor("#102634")
    axis.grid(alpha=0.2)
percentiles = [(index+1)/len(observations)*100 for index in range(len(observations))]
distribution.plot(percentiles, baseline, color="#e8b678", label="Waypoint packets only")
distribution.plot(percentiles, current, color="#68d8e7", label="Including motion packets")
distribution.set(xlabel="Cumulative observations (%)", ylabel="XZ error (game units)", yscale="symlog", title="Same native observations; two reconstructions")
distribution.legend(frameon=False, loc="upper left")
times = sorted(set(item["time"] for item in observations))
for key, label, color in [("baselineDistance", "Waypoint packets only", "#e8b678"), ("distance", "Including motion packets", "#68d8e7")]:
    timeline.plot(times, [max(item[key] for item in observations if item["time"] == time) for time in times], marker="o", markersize=3, label=label, color=color)
timeline.set(xlabel="Replay time (seconds)", ylabel="Largest sampled champion error", yscale="symlog", title="Remaining outliers stay visible")
summary = report["summary"]
fig.suptitle(f'Build {report["build"]} · {len(observations)} position samples', fontsize=15)
fig.text(0.5, 0.035, f'Median {summary["median"]:.2f} · P90 {summary["p90"]:.2f} · Maximum {summary["max"]:.2f} game units\nContinuous native playback at 1x. One ARAM replay; XZ positions only. Not an A/V fidelity percentage.', ha="center", fontsize=10, color="#c4d6df")
fig.tight_layout(rect=(0, 0.12, 1, 0.94))
fig.savefig(args.output, dpi=160, facecolor=fig.get_facecolor())
print(json.dumps({"output": str(args.output), "samples": len(observations)}))
