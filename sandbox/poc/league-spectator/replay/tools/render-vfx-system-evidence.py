"""Render compared native scheduler/mesh samples; not match footage or game shaders."""
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
    native = json.loads(raw)
    comparison = json.loads(args.comparison.read_bytes())
    if (hashlib.sha256(raw).hexdigest() != comparison["nativeEvidenceSha256"] or comparison["mismatches"]
        or comparison["matches"] != comparison["ticks"] or comparison["checkpointMatches"] != comparison["checkpointTicks"]):
        raise ValueError("Unmatched scheduler/geometry evidence")
    graph = native["cases"][0]["graphSha256"]
    profiles = ["regular-offset", "irregular", "budget-four"]
    cases = [next(case for case in native["cases"] if case["graphSha256"] == graph
                  and case["seedHex"] == "000000000000915c" and case["profile"] == profile) for profile in profiles]
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e5edf4", "axes.labelcolor": "#aac1d1",
                         "xtick.color": "#aac1d1", "ytick.color": "#aac1d1"})
    figure = plt.figure(figsize=(17,10),facecolor="#0b1420")
    grid = figure.add_gridspec(2,3,height_ratios=[2,1.25],left=.055,right=.98,top=.79,bottom=.21,hspace=.45,wspace=.25)
    titles = ["60 Hz requests · budget 20 · Q2", "Irregular requests · budget 20 · Q0", "Irregular requests · budget 4 · Q2"]
    for index, (case, title) in enumerate(zip(cases,titles)):
        step = next(step for step in case["steps"] if step["input"]["time"] == case["creation"]["createdAt"]+.8)
        axis = figure.add_subplot(grid[0,index]); axis.set_facecolor("#102131")
        output, origin = step["output"], case["creation"]["position"]
        vb = bytes.fromhex(output["geometry"]["verticesHex"])
        points = np.array([struct.unpack_from("<fff",vb,at) for at in range(0,len(vb),28)])
        colors = []
        for at in range(0,len(vb),28):
            packed = struct.unpack_from("<I",vb,at+12)[0]
            colors.append([(packed>>16&255)/255, (packed>>8&255)/255, (packed&255)/255, (packed>>24)/255])
        colors = np.array(colors)
        triangles = np.frombuffer(bytes.fromhex(output["geometry"]["indicesHex"]),dtype="<u2").reshape(-1,3)
        if len(triangles):
            projected = points[:,[0,2]]-np.array(origin)[[0,2]]
            polygons = [projected[triangle] for triangle in triangles]
            facecolors = np.array([np.mean(colors[triangle],axis=0) for triangle in triangles])
            axis.add_collection(PolyCollection(polygons,facecolors=facecolors,edgecolors="#b4bee526",linewidth=.28))
        count = output["state"]["vectors"]["life"]["count"]
        age = output["substeps"][-1]["time"] if output["substeps"] else float("nan")
        axis.set_title(title,fontsize=12,pad=13)
        axis.text(.035,.96,f"Requested age 0.80s\n{count} particles · {len(points)} vertices\nLast native emitter age {age:.6f}s",
                  transform=axis.transAxes,va="top",fontsize=9,color="#b3d8cd")
        axis.set_xlim(-40,145);axis.set_ylim(-90,140);axis.set_aspect("equal")
        axis.set_xlabel("X relative to supplied creation position",fontsize=9)
        if index == 0:axis.set_ylabel("Relative Z",fontsize=9)
        axis.grid(alpha=.1);axis.tick_params(labelsize=8)
        for spine in axis.spines.values():spine.set_color("#355064")
    axis = figure.add_subplot(grid[1,:2]);axis.set_facecolor("#102131")
    irregular = cases[1];origin = irregular["creation"]["createdAt"]
    x,y = [],[]
    for step in irregular["steps"]:
        for native_step in step["output"]["substeps"]:
            x.append(step["input"]["time"]-origin);y.append(native_step["time"])
    axis.plot([0,2],[0,2],"--",color="#608499",linewidth=1,label="Requested clock")
    axis.scatter(x,y,s=18,color="#85ddc0",label="Original emitter calls",zorder=3)
    axis.set_xlim(-.03,2.03);axis.set_ylim(-.03,2.03)
    axis.set_xlabel("Requested host clock − creation clock (s)",fontsize=10);axis.set_ylabel("Native emitter elapsed clock (s)",fontsize=10)
    axis.set_title("Irregular updates dispatch multiple native steps",fontsize=12,pad=10)
    axis.legend(frameon=False,labelcolor="#c0d8e3",fontsize=9,loc="upper left");axis.grid(alpha=.1)
    for spine in axis.spines.values():spine.set_color("#355064")
    axis = figure.add_subplot(grid[1,2]);axis.set_facecolor("#102131")
    for case,color,label in zip(cases,["#84e0bf","#a8bafa","#edc985"],["60 Hz / 20","Irregular / 20","Irregular / 4"]):
        times = [step["input"]["time"]-case["creation"]["createdAt"] for step in case["steps"]]
        counts = [step["output"]["state"]["vectors"]["life"]["count"] for step in case["steps"]]
        axis.step(times,counts,where="post",color=color,linewidth=1.6,label=label)
    axis.set_xlim(0,2);axis.set_xlabel("Requested elapsed clock (s)",fontsize=10);axis.set_ylabel("Native pool size",fontsize=10)
    axis.set_title("Different supplied update histories",fontsize=12,pad=10)
    axis.legend(frameon=False,labelcolor="#c0d8e3",fontsize=8);axis.grid(alpha=.1)
    for spine in axis.spines.values():spine.set_color("#355064")
    figure.suptitle("Native particle-system scheduling and restoration",x=.055,y=.965,ha="left",fontsize=24)
    figure.text(.055,.91,f"LoL {comparison['build']} · {comparison['ticks']:,} matched host updates · {comparison['substeps']:,} emitter steps · zero byte mismatches",fontsize=12,color="#8ce1bd")
    figure.text(.055,.868,f"{len(comparison['checkpoints'])} system checkpoints · {comparison['checkpointMatches']:,} resumed updates · complete owned context/arena hashes match",fontsize=11,color="#b3c9ed")
    figure.text(.055,.13,"CONTROLLED INPUTS · ONE SELECTED EMITTER · NATIVE CPU GEOMETRY",fontsize=11,color="#edbe7e")
    figure.text(.055,.086,"Each panel uses its listed clock/budget/quality and camera inputs. Packed colors are averaged per triangle; wire edges show topology.",fontsize=10,color="#a7becd")
    figure.text(.055,.045,"Sibling emitters, original replay activation/pose/random order, textures, materials, game shaders and browser A/V remain unverified.",fontsize=10,color="#a7becd")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    figure.savefig(args.output,dpi=130,facecolor=figure.get_facecolor())
    print(json.dumps({"output":str(args.output),"sha256":hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
