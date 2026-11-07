"""Plot original world-pose results, with supplied animation and root inputs explicit."""
import argparse
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from vfx_spawn_native import sha


def positions(case):
    return np.array([struct.unpack("<10f",bytes.fromhex(h))[:3] for h in case["output"]["worldHex"]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["package","native","comparison","output"]:
        parser.add_argument(name,type=Path)
    args = parser.parse_args()
    meta_raw=(args.package/"animation-world-poses.json").read_bytes()
    native_raw,proof_raw=args.native.read_bytes(),args.comparison.read_bytes()
    meta,native,proof=map(json.loads,[meta_raw,native_raw,proof_raw])
    if proof["definitionSha256"]!=sha(meta_raw) or proof["nativeEvidenceSha256"]!=sha(native_raw) or proof["mismatchCount"]:
        raise ValueError("Unmatched world-pose visual evidence")
    plt.rcParams.update({"font.family":"DejaVu Sans","text.color":"#edf3ff","axes.labelcolor":"#b9c6dc",
        "xtick.color":"#b9c6dc","ytick.color":"#b9c6dc","axes.edgecolor":"#3d4a63",
        "axes.facecolor":"#172237","figure.facecolor":"#101827"})
    fig=plt.figure(figsize=(16,10))
    fig.text(.055,.945,"Local animation → native world-space skeleton",fontsize=24,weight="bold")
    fig.text(.055,.9,f"Build {meta['build']}  ·  {proof['rigs']} rigs  ·  {proof['cases']} supplied pose cases  ·  {proof['comparedFloatLanes']:,} matching float32 lanes",fontsize=12,color="#a9bddb")
    grid=fig.add_gridspec(2,4,left=.055,right=.96,bottom=.22,top=.83,wspace=.28,hspace=.34)
    actors=["champions/ornn/0","champions/karthus/10","champions/hecarim/0","world/ha_chaosminionmelee/0"]
    for col,actor in enumerate(actors):
        graph_file,graph=next((k,g) for k,g in meta["graphs"].items() if g["actor"]==actor)
        c=next(c for c in native["cases"] if c["input"]["graph"]==graph_file and c["label"]=="bind/identity")
        p=positions(c)
        ax=fig.add_subplot(grid[0,col],projection="3d")
        for i,parent in enumerate(graph["parents"]):
            if parent>=0:
                points=p[[parent,i]]
                ax.plot(points[:,0],points[:,2],points[:,1],color="#56cead",lw=1,alpha=.7)
        ax.scatter(p[:,0],p[:,2],p[:,1],s=3,color="#78b2ff",alpha=.65)
        midpoint=(p.max(axis=0)+p.min(axis=0))/2
        radius=max(np.ptp(p,axis=0).max()*.55,1)
        ax.set_xlim(midpoint[0]-radius,midpoint[0]+radius)
        ax.set_ylim(midpoint[2]-radius,midpoint[2]+radius)
        ax.set_zlim(midpoint[1]-radius,midpoint[1]+radius)
        ax.set_box_aspect((1,1,1));ax.set_axis_off();ax.view_init(15,-55)
        ax.set_title(actor.split("/")[1]+f"\n{len(p)} joints",fontsize=11,color="#edf3ff",pad=2)
    ax=fig.add_subplot(grid[1,:2])
    graph_file,graph=next((k,g) for k,g in meta["graphs"].items() if g["actor"]=="champions/ornn/0")
    clips=[c for c in native["cases"] if c["input"]["graph"]==graph_file and "run" in c["label"].lower()]
    if len(clips)<2:raise ValueError("Missing observed movement poses")
    hand=next(i for i,n in enumerate(graph["joints"]) if n.lower()=="l_hand")
    for c,color in zip(clips,["#547da8","#7fb8ee","#56cead"]):
        p=positions(c)
        for i,parent in enumerate(graph["parents"]):
            if parent>=0:ax.plot(p[[parent,i],0],p[[parent,i],1],color=color,alpha=.45,lw=.8)
        ax.scatter(p[hand,0],p[hand,1],color=color,s=50,zorder=3)
        ax.annotate(f"frame {c['frame']}",(p[hand,0],p[hand,1]),xytext=(4,8),textcoords="offset points",fontsize=9,color=color)
    ax.set_title("Ornn run: hand anchor follows supplied movement + animation",fontsize=11,pad=12,color="#edf3ff")
    ax.set_xlabel("Native world X");ax.set_ylabel("Native world Y (up)")
    ax.spines[["top","right"]].set_visible(False);ax.grid(alpha=.1)
    right=fig.add_subplot(grid[1,2:]);right.set_axis_off()
    right.text(.03,.94,"Original client code now supplies",fontsize=15,weight="bold",va="top")
    right.text(.03,.75,"Parent traversal + visited-joint policy\nTranslation / scale / quaternion composition\nRoot placement + scale-inheritance branches\nWorld-pose validity guard",fontsize=12,linespacing=1.8,color="#b9c6dc",va="top")
    right.text(.03,0,f"{proof['jointPoses']:,} joint poses · zero bit mismatches\n{proof['attachmentJoins']:,} joins to original bone-key bindings",fontsize=13,linespacing=1.7,color="#56cead")
    fig.text(.055,.105,"Numerical component visualization · original world-pose composition on supplied inputs",fontsize=12,weight="bold")
    fig.text(.055,.055,"Local samples use the prepared LeagueToolkit animation package; root motion is supplied. Native ANM interpolation, graph blending,\nactor update scheduling, dynamic bones, GPU skinning and actual attached particle rendering still need work.",fontsize=11,color="#a9bddb",linespacing=1.5)
    fig.savefig(args.output,dpi=140);plt.close(fig)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"definitionSha256":sha(meta_raw),
        "nativeEvidenceSha256":sha(native_raw),"comparisonSha256":sha(proof_raw),"rendererSha256":sha(Path(__file__).read_bytes()),
        "imageSha256":sha(args.output.read_bytes()),"scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes())}))


if __name__=="__main__":
    main()
