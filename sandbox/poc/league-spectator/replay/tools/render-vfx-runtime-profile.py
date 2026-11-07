"""Render CLI runtime measurements, with exact source/package provenance."""
import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["decoder", "profile", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.profile.read_bytes()
    data = json.loads(raw)
    decoder = json.loads((args.decoder/"profile.json").read_bytes())
    if (data["kind"] != "vfx-runtime-profile" or data["build"] != decoder["clientVersion"] or
        data["protocol"] != decoder["protocolDigest"]):
        raise ValueError("VFX profile build mismatch")
    for name, digest in data["definitionHashes"].items():
        if decoder[name] != digest:
            raise ValueError(f"Stale VFX profile definition {name}")
    for name, digest in data["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes()) != digest:
            raise ValueError(f"Stale VFX profile source {name}")
    if sha(Path(__file__).with_name("inspect-latest-vfx-playback.mjs").read_bytes()) != data["inspectorSha256"]:
        raise ValueError("Stale VFX profile inspector")
    plt.rcParams.update({"figure.facecolor":"#0c141f", "axes.facecolor":"#101e2c", "axes.edgecolor":"#66809a",
                         "text.color":"#e8f1fa", "axes.labelcolor":"#b8cee0", "xtick.color":"#a7bed3",
                         "ytick.color":"#a7bed3", "grid.color":"#3c5267", "font.size":10})
    colors = ["#80e8cc", "#ffd18a", "#b6a2ff"]
    fig, axes = plt.subplots(2, 1, figsize=(13, 8.5), dpi=150)
    stats, peak_particles, peak_bytes, total = [], 0, 0, 0
    for row, color in zip(data["passes"], colors, strict=True):
        samples = row["samples"]
        times = np.asarray([s["time"] for s in samples])
        ms = np.asarray([s["milliseconds"] for s in samples])
        counts = np.asarray([s["particles"] for s in samples])
        if not np.all(np.isfinite(ms)) or np.any(ms < 0) or np.any(np.diff(times)<0):
            raise ValueError("Invalid VFX profile samples")
        live = ms[counts > 0]
        if not len(live):
            raise ValueError("VFX profile lacks live samples")
        summary = {"pass":row["pass"], "liveSamples":len(live), "liveMedianMs":float(np.median(live)),
                   "liveP95Ms":float(np.quantile(live,.95)), "maximumMs":float(ms.max())}
        stats.append(summary)
        peak_particles = max(peak_particles, int(counts.max()))
        peak_bytes = max(peak_bytes, max(s["checkpointBytes"] for s in samples))
        total += len(samples)
        label = f"Pass {row['pass']+1}" + (" (first traversal)" if row["pass"] == 0 else " (warm caches)")
        axes[0].plot(times-times[0], ms, "o-", color=color, label=label, markersize=3)
    budget_ms = 1000/60
    axes[0].axhline(budget_ms, color="#ff92a1", linestyle="--", linewidth=1, label="16.67 ms total budget at 60 Hz")
    axes[0].set(xlabel="Supplied replay time since first admitted missile (s)", ylabel="CPU draw sampling (ms)",
                title="Full lifecycle + UV + vertex sampling; WebGL and GPU work excluded", ylim=(0,None))
    axes[0].grid(alpha=.3)
    axes[0].legend(fontsize=8, facecolor="#172a3b", labelcolor="#d5e6f6")
    x = np.arange(len(stats))
    axes[1].bar(x-.18,[s["liveMedianMs"] for s in stats],.36,color=colors, label="Live-sample median")
    axes[1].bar(x+.18,[s["liveP95Ms"] for s in stats],.36,color=colors,alpha=.45,label="Live-sample P95")
    for i, summary in enumerate(stats):
        axes[1].text(i-.18,summary["liveMedianMs"]+2,f"{summary['liveMedianMs']:.1f}",ha="center",fontsize=9)
        axes[1].text(i+.18,summary["liveP95Ms"]+2,f"{summary['liveP95Ms']:.1f}",ha="center",fontsize=9)
    axes[1].axhline(budget_ms,color="#ff92a1",linestyle="--",linewidth=1)
    axes[1].set(xticks=x,xticklabels=[f"Pass {s['pass']+1}" for s in stats],ylabel="CPU draw sampling (ms)",
                title="Live samples only; each request retains the admitted particle set")
    axes[1].set_ylim(0,max(s["liveP95Ms"] for s in stats)*1.18)
    axes[1].grid(axis="y",alpha=.3)
    axes[1].legend(fontsize=8,facecolor="#172a3b",labelcolor="#d5e6f6")
    fig.suptitle(f"Replay VFX runtime cost | LoL {data['build']}",fontsize=20,x=.055,ha="left",y=.98)
    fig.text(.055,.925,f"{total} draw requests · peak {peak_particles} quads · peak {peak_bytes/(2**20):.2f} MiB opaque checkpoints",color="#80e8cc",fontsize=12)
    host=data["host"]
    fig.text(.055,.895,f"Bun {host['bun']} · {host['platform']}/{host['arch']} · {', '.join(host['cpuModels'])}",color="#adc4d9",fontsize=9)
    fig.text(.055,.045,"CLI CPU measurements only. Browser/GPU performance and League-reference A/V fidelity remain unverified.",color="#ffd18a",fontsize=10)
    fig.subplots_adjust(left=.09,right=.97,top=.81,bottom=.12,hspace=.5)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(args.output,facecolor=fig.get_facecolor())
    plt.close(fig)
    evidence={"schema":1,"build":data["build"],"protocol":data["protocol"],"profileSha256":sha(raw),
              "rendererSha256":sha(Path(__file__).read_bytes()),"imageSha256":sha(args.output.read_bytes()),
              "stats":stats,"peakParticles":peak_particles,"peakCheckpointBytes":peak_bytes,"scope":data["scope"]}
    args.output.with_suffix(".json").write_text(json.dumps(evidence,indent=2),encoding="utf-8")
    print(json.dumps({"image":str(args.output),"sha256":evidence["imageSha256"],"stats":stats}))


if __name__ == "__main__":
    main()
