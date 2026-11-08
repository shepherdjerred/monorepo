"""Render actual compared trail buffers on controlled inputs; not a game screenshot."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import PolyCollection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native", "comparison", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.native.read_bytes()
    native, comparison = json.loads(raw), json.loads(args.comparison.read_bytes())
    if (hashlib.sha256(raw).hexdigest() != comparison["nativeEvidenceSha256"]
        or comparison["mismatches"] or comparison["mathMismatches"]):
        raise ValueError("Unmatched native/WASM trail evidence")
    selected = []
    for quality, cutoff in [(0, 0), (2, 0), (2, 25)]:
        candidates = []
        for case in native["cases"]:
            value = case["input"]
            if (value["count"] != 8 or value["mode"] != 1 or value["smoothingMode"] != 1
                or value["smoothingQuality"] != quality or value["cutoff"] != cutoff or value["viewForward"] != [0,-1,0]):
                continue
            first = struct.unpack_from("<fff", bytes.fromhex(value["particleHex"]), 0x80)
            if first[2] == 80:
                candidates.append(case)
        if len(candidates) != 1:
            raise ValueError("Ambiguous controlled curve example")
        selected.append(candidates[0])
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color":"#dce9f1", "axes.labelcolor":"#9fb3c3",
                         "xtick.color":"#9fb3c3", "ytick.color":"#9fb3c3"})
    figure, axes = plt.subplots(1, 3, figsize=(16, 8), facecolor="#0c141f")
    for axis, case, title in zip(axes, selected, ["Smoothing quality 0", "Smoothing quality 2", "Quality 2 + cutoff 25"]):
        axis.set_facecolor("#101d2a")
        data = bytes.fromhex(case["verticesHex"])
        points = np.array([struct.unpack_from("<fff", data, at) for at in range(0,len(data),28)])
        indices = np.frombuffer(bytes.fromhex(case["indicesHex"]), dtype="<u2").reshape(-1,3)
        path_bytes = bytes.fromhex(case["input"]["particleHex"])
        path = np.array([struct.unpack_from("<fff",path_bytes,index*0xac+0x80) for index in range(8)])
        axis.plot(path[:,0],path[:,2],"--o",color="#799db2",markersize=4,linewidth=1,label="Supplied particle centers")
        if len(indices):
            polygons = [points[triangle][:,[0,2]] for triangle in indices]
            axis.add_collection(PolyCollection(polygons,facecolor="#77d6ac",alpha=.5,edgecolor="#b7f5da",linewidth=.9))
        axis.scatter(points[:,0],points[:,2],s=14,color="#e6fff5",zorder=3,label="Native ribbon vertices")
        axis.set_title(title,color="#ddedf5",fontsize=14,pad=15)
        axis.set_xlabel("World X");axis.set_ylabel("World Z")
        axis.set_aspect("equal");axis.set_xlim(-9,91);axis.set_ylim(-74,90)
        for spine in axis.spines.values():spine.set_color("#354b5d")
        axis.grid(alpha=.12)
        axis.text(.02,.02,f"{len(points)} vertices · {len(indices)} triangles",transform=axis.transAxes,color="#b5d4c3",fontsize=10)
    axes[0].legend(loc="lower left",bbox_to_anchor=(0,-.21),frameon=False,labelcolor="#a9c1d0",fontsize=9)
    figure.suptitle("Original camera-trail geometry running in WASM",fontsize=24,x=.055,y=.965,ha="left",color="#e5eff5")
    figure.text(.055,.895,f"LoL {comparison['build']} · {comparison['cases']} matched buffer cases · {comparison['vertices']:,} vertices · zero mismatches",fontsize=12,color="#8ed8bf")
    figure.text(.055,.105,"CONTROLLED INPUTS — NOT A LEAGUE OR BROWSER SCREENSHOT",fontsize=11,color="#efbd73")
    figure.text(.055,.066,"Packed native vertex/index bytes match the browser-compatible WASM kernel. Geometry shown as a solid diagnostic mesh.",fontsize=10,color="#9fb3c3")
    figure.text(.055,.032,"Original macOS math, replay birth/pool order, attachments, game shaders and synchronized A/V remain unverified.",fontsize=10,color="#9fb3c3")
    figure.subplots_adjust(left=.055,right=.97,bottom=.24,top=.84,wspace=.3)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    figure.savefig(args.output,dpi=120,facecolor=figure.get_facecolor())
    print(json.dumps({"output":str(args.output),"sha256":hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
