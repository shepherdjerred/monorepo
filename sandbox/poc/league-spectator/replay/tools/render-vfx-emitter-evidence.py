"""Render compared native trail mesh/time samples, not game shaders or match footage."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.native.read_bytes()
    comparison = json.loads(args.comparison.read_bytes())
    if (hashlib.sha256(raw).hexdigest() != comparison["nativeEvidenceSha256"]
        or comparison["mismatches"] or comparison["matches"] != comparison["frames"]):
        raise ValueError("Unmatched emitter frame/geometry evidence")
    samples = [sample for sample in comparison["samples"] if sample["emitterIndex"] == 0]
    if len(samples) != 5:
        raise ValueError("Expected five controlled time samples")
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e3eef5", "axes.labelcolor": "#a9c0d0",
                         "xtick.color": "#a9c0d0", "ytick.color": "#a9c0d0"})
    figure = plt.figure(figsize=(17, 9), facecolor="#0b1420")
    grid = figure.add_gridspec(2, 5, height_ratios=[2.3,1],left=.055,right=.98,bottom=.21,top=.75,hspace=.5,wspace=.25)
    for i, sample in enumerate(samples):
        axis = figure.add_subplot(grid[0,i])
        axis.set_facecolor("#102131")
        geometry = sample["output"]["geometry"]
        vb = bytes.fromhex(geometry["verticesHex"])
        points = np.array([struct.unpack_from("<fff",vb,at) for at in range(0,len(vb),28)])
        colors = []
        for at in range(0,len(vb),28):
            packed = struct.unpack_from("<I",vb,at+12)[0]
            colors.append([(packed>>16&255)/255, (packed>>8&255)/255, (packed&255)/255, (packed>>24)/255])
        colors = np.array(colors)
        indices = np.frombuffer(bytes.fromhex(geometry["indicesHex"]),dtype="<u2").reshape(-1,3)
        if len(indices):
            polygons = [points[triangle][:,[0,2]] for triangle in indices]
            facecolors = np.array([np.mean(colors[triangle],axis=0) for triangle in indices])
            axis.add_collection(PolyCollection(polygons,facecolors=facecolors,edgecolors="#b1b9dd22",linewidth=.25))
        state = sample["output"]["state"]
        particle = bytes.fromhex(state["vectors"]["particle"]["hex"])
        count = state["vectors"]["life"]["count"]
        path = np.array([struct.unpack_from("<fff",particle,j*0xac+0x80) for j in range(count)])
        if count:
            axis.plot(path[:,0],path[:,2],"--",linewidth=.7,color="#bfd6e861",label="Native centers")
        else:
            axis.text(.5,.5,"Pool empty",transform=axis.transAxes,ha="center",color="#a6b9c9",fontsize=12)
        axis.set_title(f"{sample['input']['time']:.2f}s",fontsize=15,color="#e5edf4",pad=10)
        axis.text(.04,.97,f"{count} particles\n{len(points)} vertices",transform=axis.transAxes,va="top",fontsize=9,color="#9fc9c1")
        axis.set_xlim(-30,140);axis.set_ylim(-75,130)
        axis.set_aspect("equal");axis.set_xlabel("World X",fontsize=9)
        if i == 0:axis.set_ylabel("World Z",fontsize=9)
        else:axis.tick_params(labelleft=False)
        axis.tick_params(labelsize=8);axis.grid(alpha=.09)
        for spine in axis.spines.values():spine.set_color("#355064")
    axis = figure.add_subplot(grid[1,:])
    axis.set_facecolor("#102131")
    lifecycle = [entry for entry in comparison["lifecycles"] if entry["emitterIndex"] == 0
                 and entry["seedHex"] == "000000000000915c" and entry["clock"] == 0]
    if len(lifecycle) != 1:
        raise ValueError("Ambiguous native lifecycle")
    values = lifecycle[0]["values"]
    axis.step([v["time"] for v in values],[v["pool"] for v in values],where="post",color="#85dfc3",linewidth=1.8,label="Native pool size")
    axis.vlines([v["time"] for v in values if v["births"]],0,[v["births"] for v in values if v["births"]],color="#f6cf83",alpha=.8,label="Native births per update")
    axis.set_xlim(0,2);axis.set_ylim(-1,max(v["pool"] for v in values)+4)
    axis.set_xlabel("Supplied elapsed emitter clock (seconds)",fontsize=10);axis.set_ylabel("Particles",fontsize=10)
    axis.legend(frameon=False,labelcolor="#bbd2df",fontsize=9,loc="upper right")
    axis.grid(alpha=.1)
    for spine in axis.spines.values():spine.set_color("#355064")
    figure.suptitle("Native emitter lifecycle → native ribbon geometry",x=.055,y=.965,ha="left",fontsize=24,color="#e7f1f7")
    figure.text(.055,.903,f"LoL {comparison['build']} · {comparison['frames']:,} matched frames · {comparison['births']:,} births · {comparison['vertices']:,} vertices · zero byte mismatches",fontsize=12,color="#8ce1bc")
    figure.text(.055,.855,"Original emission gates, birth, position/color/scale updates, expiry/removal and trail writer run together in browser-compatible WASM.",fontsize=11,color="#adc8da")
    figure.text(.055,.816,f"State restoration: {len(comparison['checkpoints'])} checkpoints · {comparison['checkpointMatches']:,} resumed frames · zero byte mismatches after unrelated resets",fontsize=11,color="#b6cbf0")
    figure.text(.055,.125,"CONTROLLED INPUTS — ONE AUTHORED EMITTER — DIAGNOSTIC MESH COLORS",fontsize=11,color="#edbe7c")
    figure.text(.055,.081,"Native packed colors are averaged per triangle; faint wire edges show mesh topology. Textures and game shaders are not rendered.",fontsize=10,color="#a6bdcd")
    figure.text(.055,.043,"Supplied clocks/poses/seeds, unit quality/scale and adapted math/TLS/allocation. Original replay activation/order, attachment and browser A/V remain unverified.",fontsize=10,color="#a6bdcd")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    figure.savefig(args.output,dpi=130,facecolor=figure.get_facecolor())
    print(json.dumps({"output":str(args.output),"sha256":hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
