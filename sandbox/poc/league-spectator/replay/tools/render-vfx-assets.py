"""Visualize native serialized-field coverage and the remaining asset pipeline."""
import argparse
from collections import Counter
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
    meta_raw=(args.package/"vfx-assets.json").read_bytes();proof_raw=args.comparison.read_bytes()
    meta,proof=json.loads(meta_raw),json.loads(proof_raw)
    if proof["definitionSha256"]!=sha(meta_raw) or proof["mismatchCount"] or proof["nativeIgnoredFields"] or proof["nativeTypeMismatches"]:
        raise ValueError("Incomplete original asset reader evidence")
    actors=Counter(ref["effectId"].rsplit("/",1)[0] for ref in meta["emitters"].values())
    plt.rcParams.update({"font.family":"DejaVu Sans","text.color":"#e8edf6","axes.labelcolor":"#b9c6dc",
        "xtick.color":"#b9c6dc","ytick.color":"#b9c6dc","axes.edgecolor":"#3d4a63",
        "axes.facecolor":"#172237","figure.facecolor":"#101827"})
    fig,(left,right)=plt.subplots(1,2,figsize=(16,10),gridspec_kw={"width_ratios":[1,1.1]})
    fig.subplots_adjust(top=.79,bottom=.29,left=.15,right=.96,wspace=.18)
    fig.text(.055,.94,"Original asset loading covers the complete prepared emitter set",fontsize=23,weight="bold")
    fig.text(.055,.885,f"Build {meta['build']}  ·  {proof['types']} native types  ·  {proof['emitters']:,} complex emitters  ·  {proof['fields']:,} serialized fields",fontsize=12,color="#a9bddb")
    labels=[actor.split("/",1)[1] for actor in actors]
    counts=list(actors.values())
    left.barh(range(len(labels)),counts,color="#56cead",height=.65)
    left.set_yticks(range(len(labels)),labels,fontsize=10);left.invert_yaxis()
    left.set_xlim(0,max(counts)*1.18)
    for i,count in enumerate(counts):left.text(count+20,i,f"{count:,}",va="center",fontsize=10,color="#e8edf6")
    left.set_xlabel("Complete serialized emitter objects loaded",labelpad=14)
    left.set_title("All ten equipped champion appearances",fontsize=12,color="#e8edf6",pad=18)
    left.spines[["top","right"]].set_visible(False)
    right.set_axis_off();right.set_xlim(0,1);right.set_ylim(0,1)
    for y,label,detail,color in [(.84,"Serialized fields: loaded","Original constructor, type dispatch, containers and values", "#56cead"),
                                (.52,"Post-load and resource binding","Curve preparation, resource/link fixups and materials", "#e7b773"),
                                (.20,"Complete rendering and match integration","Every primitive, original shaders, replay state and audio", "#8293ad")]:
        right.text(.5,y,label,ha="center",va="center",fontsize=13,weight="bold",
            bbox={"boxstyle":"round,pad=.8","facecolor":"#22334e","edgecolor":color,"linewidth":1.5})
        right.text(.5,y-.105,detail,ha="center",va="center",fontsize=9,color="#a9bddb")
    for y in [.68,.36]:right.annotate("",xy=(.5,y-.06),xytext=(.5,y),arrowprops={"arrowstyle":"->","color":"#729de8","lw":1.5})
    scalar_checks=proof["primitiveChecks"]+proof["flagChecks"]+proof["stringChecks"]
    fig.text(.15,.18,f"{proof['fields']:,} fields consumed · no native property skips\nNo type mismatches or unsupported classes",fontsize=13,color="#56cead",linespacing=1.7)
    fig.text(.59,.18,f"{scalar_checks:,} independent root-value checks\n{proof['repeatedLoads']} complete emitter resets agree",fontsize=13,color="#56cead",linespacing=1.7)
    fig.text(.055,.085,"This package contains native object state before post-load. It does not make all emitters renderable yet.",fontsize=11,weight="bold")
    fig.text(.055,.04,"Owned streams, allocation/string services, single-thread mutexes and one bounded stack-probe site are explicit boundaries.\nOriginal asset callbacks and source bytes drive the load; GPU output, arbitrary-match support and reference A/V fidelity remain unverified.",fontsize=10,color="#a9bddb",linespacing=1.5)
    fig.savefig(args.output,dpi=140);plt.close(fig)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"definitionSha256":sha(meta_raw),"comparisonSha256":sha(proof_raw),
        "rendererSha256":sha(Path(__file__).read_bytes()),"imageSha256":sha(args.output.read_bytes()),"scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes())}))


if __name__=="__main__":main()
