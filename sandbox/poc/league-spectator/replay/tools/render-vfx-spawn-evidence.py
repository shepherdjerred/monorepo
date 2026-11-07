"""Plot compared native birth/pool data; no game or browser rendering claim."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def floats(value, offset, width):
    return struct.unpack_from("<"+"f"*width, bytes.fromhex(value), offset)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.native.read_bytes()
    comparison = json.loads(args.comparison.read_bytes())
    if hashlib.sha256(raw).hexdigest() != comparison["nativeEvidenceSha256"] or comparison["mismatches"]:
        raise ValueError("Unmatched native/WASM spawn evidence")
    samples = comparison["samples"]
    indices = sorted({sample["emitterIndex"] for sample in samples})
    if len(indices) != 3:
        raise ValueError("Diagnostic requires three compared emitter graphs")
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e4edf5", "axes.labelcolor": "#a9bfd0",
                         "xtick.color": "#a9bfd0", "ytick.color": "#a9bfd0"})
    figure, axes = plt.subplots(1, 3, figsize=(16, 7), facecolor="#0b1420")
    for axis in axes:
        axis.set_facecolor("#102131")
        for spine in axis.spines.values():
            spine.set_color("#345166")
        axis.grid(alpha=.12)
    selected = [sample for sample in samples if sample["emitterIndex"] == indices[0]]
    last = selected[-1]["output"]
    vector = last["vectors"]["particle"]
    points = np.array([floats(vector["hex"], i*0xac+0x80, 3) for i in range(vector["count"])])
    axes[0].plot(points[:,0], points[:,2], "o-", color="#7de4bc", markersize=7)
    for ordinal, point in enumerate(points):
        axes[0].annotate(str(ordinal+1), (point[0], point[2]), xytext=(0,10), textcoords="offset points", ha="center", color="#d6f7e9")
    axes[0].set_title("Native pool: birth origins", fontsize=15, pad=17)
    axes[0].set_xlabel("World X"); axes[0].set_ylabel("World Z")
    axes[0].set_xlim(52,128); axes[0].set_ylim(23,72)
    axes[0].text(.05,.92,"7 births across 3 nonempty updates\nSame placement for all 3 emitters", transform=axes[0].transAxes, color="#a2cbbd", fontsize=10, va="top")
    colors = ["#f8a7c5", "#e7e9a0", "#b0a8ff"]
    for emitter_index, color in zip(indices, colors):
        values = [s for s in samples if s["emitterIndex"] == emitter_index and s["output"]["births"]]
        ages, alphas = [], []
        for sample in values:
            ages.append(sample["input"]["normalizedAge"])
            alphas.append(floats(sample["output"]["births"][0]["birthHex"], 0x4c, 1)[0])
        width = floats(values[0]["output"]["births"][0]["birthHex"], 0x68, 1)[0]
        axes[1].plot(ages, alphas, "o--" if emitter_index == indices[-1] else "o-", color=color,
                     linewidth=2, label=f"Emitter {emitter_index} · birth scale X {width:g}", markersize=6)
    axes[1].set_title("Native birth-alpha samples", fontsize=15, pad=17)
    axes[1].set_xlabel("Supplied normalized emitter age"); axes[1].set_ylabel("Native birth alpha")
    axes[1].set_xlim(0,1); axes[1].set_ylim(-.04,.85)
    axes[1].legend(frameon=False, loc="upper right", labelcolor="#c6d8e4", fontsize=9)
    pool = last["vectors"]
    count = pool["uv"]["count"]
    chance = np.array([floats(pool["motion"]["hex"], i*0x24+0x20, 1)[0] for i in range(count)])
    uv = np.array([floats(pool["uv"]["hex"], i*0x20, 1)[0] for i in range(count)])
    if not np.array_equal(chance, uv):
        raise ValueError("Selected authored UV curve did not reuse shared particle chance")
    axes[2].plot([0,1],[0,1],"--",color="#547c93",linewidth=1)
    axes[2].scatter(chance,uv,s=60,color="#80c9fa",edgecolor="#d4eeff",zorder=3)
    axes[2].set_title("Shared random value → UV", fontsize=15, pad=17)
    axes[2].set_xlabel("Particle random value");axes[2].set_ylabel("Native initial UV offset U")
    axes[2].set_xlim(0,1);axes[2].set_ylim(0,1)
    axes[2].text(.06,.91,"Seed 0x1 · 7 draws for 7 births\nUV sampling consumes no extra draw",transform=axes[2].transAxes,color="#b4d8f0",fontsize=10,va="top")
    figure.suptitle("Native particle birth and pool insertion in WASM",x=.055,y=.96,ha="left",fontsize=23,color="#e9f2f8")
    figure.text(.055,.875,f"LoL {comparison['build']} · {comparison['graphs']} authored emitters · {comparison['births']:,} births · {comparison['steps']} matched updates · zero byte mismatches",fontsize=12,color="#84dfbc")
    figure.text(.055,.135,"CONTROLLED INPUTS — NOT MATCH FOOTAGE OR A BROWSER SCREENSHOT",fontsize=11,color="#f0bd77")
    figure.text(.055,.085,"Original birth and insertion instructions execute with owned memory, explicit clocks/poses/seeds, adapted allocation/TLS and supplied math.",fontsize=10,color="#a6bdcd")
    figure.text(.055,.045,"Particle ageing/removal, original replay clock and random order, attachments, materials/shaders and synchronized A/V remain unverified.",fontsize=10,color="#a6bdcd")
    figure.subplots_adjust(left=.055,right=.97,top=.79,bottom=.27,wspace=.32)
    args.output.parent.mkdir(exist_ok=True,parents=True)
    figure.savefig(args.output,dpi=130,facecolor=figure.get_facecolor())
    print(json.dumps({"output":str(args.output),"sha256":hashlib.sha256(args.output.read_bytes()).hexdigest(),"births":comparison["births"]}))


if __name__ == "__main__":
    main()
