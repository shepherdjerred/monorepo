"""Visualize original VFX post-load callback coverage, not game rendering."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","comparison","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    meta_raw=(args.package/"vfx-postload.json").read_bytes()
    proof_raw=args.comparison.read_bytes()
    meta,proof=json.loads(meta_raw),json.loads(proof_raw)
    if proof["definitionSha256"]!=sha(meta_raw) or proof["mismatchCount"] or proof["pendingLinkFixups"]:
        raise ValueError("Incomplete native post-load evidence")
    plt.rcParams.update({"font.family":"DejaVu Sans","text.color":"#e8edf6","axes.labelcolor":"#b9c6dc",
        "xtick.color":"#b9c6dc","ytick.color":"#b9c6dc","axes.edgecolor":"#3d4a63",
        "axes.facecolor":"#172237","figure.facecolor":"#101827"})
    fig,(left,right)=plt.subplots(1,2,figsize=(16,10),gridspec_kw={"width_ratios":[1,1.05]})
    fig.subplots_adjust(top=.77,bottom=.32,left=.15,right=.96,wspace=.2)
    fig.text(.055,.94,"Original post-load callbacks now cover every prepared emitter",fontsize=22,weight="bold")
    fig.text(.055,.885,f"Build {meta['build']}  ·  {proof['emitters']:,} emitters  ·  {proof['callbackVisits']:,} class callbacks  ·  {proof['visitedTypes']} visited native types",fontsize=12,color="#a9bddb")
    actors=proof["actors"]
    labels=[name.split("/",1)[1] for name in actors]
    counts=[a["callbacks"] for a in actors.values()]
    left.barh(range(len(labels)),counts,color="#56cead",height=.65)
    left.set_yticks(range(len(labels)),labels,fontsize=10);left.invert_yaxis()
    left.set_xlim(0,max(counts)*1.22)
    for i,count in enumerate(counts):left.text(count+max(counts)*.015,i,f"{count:,}",va="center",fontsize=10)
    left.set_xlabel("Executed original class callbacks",labelpad=14)
    left.set_title("Ten equipped champion appearances",fontsize=12,pad=18)
    left.spines[["top","right"]].set_visible(False)
    right.set_axis_off();right.set_xlim(0,1);right.set_ylim(0,1)
    rows=[(.9,"Serialized fields loaded","103,439 fields; native constructors and readers","#56cead"),
          (.64,"Recursive post-load completed","Original walker, curve preparation and class callbacks","#56cead"),
          (.38,"Resource binding and runtime admission","Materials, owner contexts and every primitive","#e7b773"),
          (.12,"Rendering and A/V comparison","Original shaders, sound and match-wide verification","#8293ad")]
    for y,label,detail,color in rows:
        right.text(.5,y,label,ha="center",va="center",fontsize=12,weight="bold",
            bbox={"boxstyle":"round,pad=.65","facecolor":"#22334e","edgecolor":color,"linewidth":1.5})
        right.text(.5,y-.075,detail,ha="center",va="center",fontsize=8.5,color="#a9bddb")
    fig.text(.15,.175,f"{proof['objectVisits']:,} typed object visits\n{proof['repeatedLoads']} repeat-load checks agree",fontsize=13,color="#56cead",linespacing=1.7)
    fig.text(.59,.175,f"{proof['changedBytes']:,} changed state bytes\n{proof['allocatingEmitters']:,} emitters allocate additional post-load data",fontsize=13,color="#56cead",linespacing=1.7)
    fig.text(.055,.085,"Callback completion does not establish full resource binding or make all effects renderable.",fontsize=11,weight="bold")
    fig.text(.055,.04,"Offline preparation from the matching executable and unchanged BIN fields. Exact build, source and state hashes are enforced.\nThis is a pipeline evidence chart, not a League frame or a measure of overall fidelity. Main-preview rendering remains a narrower subset.",fontsize=10,color="#a9bddb",linespacing=1.5)
    fig.savefig(args.output,dpi=140);plt.close(fig)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"definitionSha256":sha(meta_raw),
        "comparisonSha256":sha(proof_raw),"rendererSha256":sha(Path(__file__).read_bytes()),
        "imageSha256":sha(args.output.read_bytes()),"scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes())}))


if __name__=="__main__":main()
