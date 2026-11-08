"""Draw original full-asset quad geometry; this is not a game-shader render."""
import argparse
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import numpy as np

from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","effects","native","comparison","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    meta_raw=(args.package/"vfx-loaded-quads.json").read_bytes()
    native_raw,proof_raw=args.native.read_bytes(),args.comparison.read_bytes()
    meta,native,proof=map(json.loads,[meta_raw,native_raw,proof_raw])
    if proof["definitionSha256"]!=sha(meta_raw) or proof["nativeEvidenceSha256"]!=sha(native_raw) or proof["mismatchCount"]:
        raise ValueError("Unmatched loaded quad visual evidence")
    for name,digest in proof["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes())!=digest:raise ValueError("Stale loaded quad source")
    manifest_raw=(args.effects/"manifest.json").read_bytes();manifest=json.loads(manifest_raw)
    refs={r["sha256"]:r for r in meta["templates"]}
    chosen=[("champions/akshan/20/7db759ed",0,"Akshan · Streaks"),
            ("champions/jinx/2/30f9e0b8",5,"Jinx · SparkShower"),
            ("champions/vladimir/39/2340406a",4,"Vladimir · Sparks")]
    times=[.05,.2,.5];sources={};panels=[]
    for effect,index,label in chosen:
        case=next(c for c in native["cases"] if c["mode"]==0 and refs[c["graphSha256"]]["effectId"]==effect and refs[c["graphSha256"]]["emitterIndex"]==index)
        ref=manifest["definitions"][effect];raw=(args.effects/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Visual effect source changed")
        sources[ref["file"]]=sha(raw)
        emitter=json.loads(raw)["definition"]["complexEmitterDefinitionData"][index]
        if "birthVelocity" not in emitter:raise ValueError("Visual does not exercise loaded velocity")
        row=[]
        for time in times:
            frame=next(f for f in case["frames"] if f["input"]["time"]==time)
            data=bytes.fromhex(frame["output"]["geometry"]["verticesHex"])
            if len(data)%112:raise ValueError("Incomplete native visual quad")
            points=[];colors=[]
            for at in range(0,len(data),28):
                x,y,z=struct.unpack_from("<3f",data,at)
                points.append([.85*x+.5*z,y-.25*z])
                color=struct.unpack_from("<I",data,at+12)[0]
                colors.append([((color>>bit)&255)/255 for bit in [16,8,0,24]])
            row.append((np.array(points).reshape(-1,4,2),np.array(colors).reshape(-1,4,4).mean(axis=1)))
        panels.append((label,row))
    plt.rcParams.update({"font.family":"DejaVu Sans","text.color":"#e8edf6","axes.labelcolor":"#b9c6dc",
        "xtick.color":"#7890af","ytick.color":"#7890af","axes.edgecolor":"#344966",
        "axes.facecolor":"#142238","figure.facecolor":"#0e1828"})
    fig,axes=plt.subplots(3,3,figsize=(18,13))
    fig.subplots_adjust(top=.805,bottom=.25,left=.065,right=.97,wspace=.15,hspace=.35)
    fig.text(.045,.95,"Complete loaded emitter data → original particle motion and geometry",fontsize=23,weight="bold")
    fig.text(.045,.905,f"{proof['graphs']} prepared quad emitters · {proof['frames']:,} sampled frames · {proof['births']:,} births · build {meta['build']}",fontsize=13,color="#a9bddb")
    fig.text(.045,.863,"Native positions, packed vertex colors and quad outlines. Shared software projection and scale within each row.",fontsize=12,color="#80e8cc")
    for row,(label,draws) in enumerate(panels):
        points=np.concatenate([p.reshape(-1,2) for p,c in draws])
        center=(points.min(axis=0)+points.max(axis=0))/2
        width=max(float(np.ptp(points[:,0]))*1.15,50)
        height=max(float(np.ptp(points[:,1]))*1.15,width*.5,50)
        for col,((quads,colors),time) in enumerate(zip(draws,times)):
            ax=axes[row,col]
            fill=colors.copy();fill[:,3]*=.12
            ax.add_collection(PolyCollection(quads,facecolors=fill,edgecolors=colors,linewidths=1.2))
            ax.set_xlim(center[0]-width/2,center[0]+width/2)
            ax.set_ylim(center[1]-height/2,center[1]+height/2)
            ax.set_title(f"{label}   {time:.2f} s   ·   {len(quads)} live",fontsize=10,pad=10,color="#e8edf6")
            ax.tick_params(labelsize=7);ax.grid(color="#263951",alpha=.5,linewidth=.6)
    fig.text(.065,.193,"Loaded velocity, drag, acceleration, shape and scale data reach the original simulation; no emitter field projection.",fontsize=12,color="#80e8cc")
    fig.text(.065,.153,f"Instruction/data comparison: {proof['frames']:,} frames agree with recorded native-host math results and exact argument checks.",fontsize=11,color="#a9bddb")
    fig.text(.065,.12,f"Normal preview math: {proof['previewMathMismatchCount']} differing forward frames; maximum observed position difference {proof['previewPositionMaxAbsoluteDifference']:.3g} world units.",fontsize=11,color="#ffc47b")
    fig.text(.045,.071,"This is a component visualization without textures or game shaders. It does not measure overall A/V fidelity.",fontsize=12,weight="bold")
    fig.text(.045,.033,"Supplied unit scene scales, absent flex channels, clock, basis and seed. UV/material binding, terrain following, child effects, original math and main-preview integration remain incomplete.",fontsize=10,color="#a9bddb")
    fig.savefig(args.output,dpi=140);plt.close(fig)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"definitionSha256":sha(meta_raw),
        "nativeEvidenceSha256":sha(native_raw),"comparisonSha256":sha(proof_raw),"effectsManifestSha256":sha(manifest_raw),
        "effectSources":sources,"rendererSha256":sha(Path(__file__).read_bytes()),"imageSha256":sha(args.output.read_bytes()),
        "scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes())}))


if __name__=="__main__":main()
