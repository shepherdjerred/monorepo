"""Show actual texture layers sampled through coupled native vertex UVs, without game materials."""
import argparse
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

from vfx_spawn_native import sha


def sample(texture,uv,indices,size=420):
    points=np.array([[0,0],[1,0],[1,1],[0,1]])
    xx,yy=np.meshgrid((np.arange(size)+.5)/size,(np.arange(size)+.5)/size)
    locations=np.stack([xx,yy],axis=-1);out=np.zeros((size,size,2));inside=np.zeros((size,size),dtype=bool)
    for triangle in indices.reshape(-1,3):
        t=points[triangle];basis=np.column_stack([t[1]-t[0],t[2]-t[0]])
        local=(locations-t[0])@np.linalg.inv(basis).T
        mask=(local[...,0]>=0)&(local[...,1]>=0)&(local.sum(axis=-1)<=1)
        v=uv[triangle];value=v[0]+local[...,0,None]*(v[1]-v[0])+local[...,1,None]*(v[2]-v[0])
        out[:]=np.where(mask[...,None],value,out);inside|=mask
    if not inside.all():raise ValueError("Native UV visual indices do not cover one quad")
    height,width=texture.shape[:2];xy=out*[width,height]-.5
    floor=np.floor(xy).astype(int);weight=xy-floor
    x,y=floor[...,0]%width,floor[...,1]%height;nx,ny=(x+1)%width,(y+1)%height
    wx,wy=weight[...,0,None],weight[...,1,None]
    rgba=(texture[y,x]*(1-wx)+texture[y,nx]*wx)*(1-wy)+(texture[ny,x]*(1-wx)+texture[ny,nx]*wx)*wy
    grid=np.indices((size,size));checker=((grid[0]//20+grid[1]//20)%2)*.06+.13
    rgb=rgba[...,:3]*rgba[...,3,None]+checker[...,None]*(1-rgba[...,3,None])
    return np.clip(rgb,0,1)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","effects","native","comparison","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    meta_raw=(args.package/"vfx-bound-quads.json").read_bytes();native_raw=args.native.read_bytes();proof_raw=args.comparison.read_bytes()
    meta,native,proof=map(json.loads,[meta_raw,native_raw,proof_raw])
    profile=json.loads((args.package/"profile.json").read_bytes());sampler_raw=(args.package/"vfx-samplers.json").read_bytes();sampler=json.loads(sampler_raw)
    if proof["definitionSha256"]!=sha(meta_raw) or proof["nativeEvidenceSha256"]!=sha(native_raw) or proof["mismatchCount"] or not proof["texturePresenceMarkerUnmapped"]:
        raise ValueError("Unmatched bound UV visual evidence")
    if sha(sampler_raw)!=profile["vfxSamplersSha256"] or sampler["addressModes"][0]["name"]!="repeat" or sampler["defaults"]!={"base":0,"mult":0,"pixelated":False}:
        raise ValueError("Original sampler contract changed")
    for name,digest in proof["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes())!=digest:raise ValueError("Stale bound UV visual source")
    manifest_raw=(args.effects/"manifest.json").read_bytes();manifest=json.loads(manifest_raw)
    sources={};textures={};samples=[]
    examples=[("champions/viego/43/9ff1b082",23,"base",[.5,.7,1.2],"Viego · Blend_dark1 · base texture"),
              ("champions/viego/43/56ac80ee",1,"mult",[.05,.2,.5],"Viego · Swipe4 · mult texture")]
    for effect,index,layer,times,label in examples:
        ref=next(r for r in meta["templates"] if r["effectId"]==effect and r["emitterIndex"]==index)
        case=next(c for c in native["cases"] if c["graphSha256"]==ref["sha256"] and c["mode"]==3)
        if sum(len(f["output"]["state"]["births"]) for f in case["frames"])!=1:
            raise ValueError("UV visual must follow one particle, without replacement")
        source=manifest["definitions"][effect];effect_raw=(args.effects/source["file"]).read_bytes()
        if sha(effect_raw)!=source["sha256"]:raise ValueError("UV visual effect changed")
        sources[source["file"]]=sha(effect_raw)
        emitter=json.loads(effect_raw)["definition"]["complexEmitterDefinitionData"][index]
        texture_key=emitter["texture"] if layer=="base" else emitter["textureMult"]["textureMult"]
        asset=manifest["assets"][texture_key.lower()]
        if asset["status"]!="prepared" or asset["kind"]!="texture":raise ValueError("UV visual texture is unprepared")
        raw=(args.effects/asset["file"]).read_bytes()
        if sha(raw)!=asset["sha256"]:raise ValueError("UV visual texture changed")
        textures[asset["file"]]=sha(raw);texture=np.asarray(Image.open(args.effects/asset["file"]).convert("RGBA"),dtype=np.float64)/255
        graph=json.loads((args.package/ref["file"]).read_bytes());obj=bytes.fromhex(graph["assetObjectHex"])
        if obj[0x12]:raise ValueError("UV visual requires original bilinear filtering")
        if layer=="base":mode=obj[0xc9]
        else:
            pointer=struct.unpack_from("<Q",obj,0x230)[0];start=graph["assetHeapStart"];heap=bytes.fromhex(graph["segments"][1]["bytesHex"])
            if not start<=pointer<=start+len(heap)-0xa8:raise ValueError("UV visual mult object outside owned asset heap")
            mode=heap[pointer-start+0x18]
        if mode!=0:raise ValueError("UV visual requires native repeat addressing")
        row=[]
        for time in times:
            frame=next(f for f in case["frames"] if f["input"]["time"]==time)
            raw=bytes.fromhex(frame["output"]["geometry"]["verticesHex"])
            if len(raw)!=112 or not frame["input"]["multTexturePresent"]:raise ValueError("UV visual requires one live quad and explicit mult-texture presence")
            uv=np.array([struct.unpack_from("<2e",raw,i*28+(16 if layer=="base" else 24)) for i in range(4)])
            indices=np.frombuffer(bytes.fromhex(frame["output"]["geometry"]["indicesHex"]),dtype="<u2")
            if len(indices)!=6 or indices.max()>=4:raise ValueError("UV visual native index layout changed")
            row.append((time,sample(texture,uv,indices),uv[0]))
        samples.append((label,row))
    plt.rcParams.update({"font.family":"DejaVu Sans","text.color":"#e8edf6","axes.facecolor":"#142238","figure.facecolor":"#0e1828"})
    fig,axes=plt.subplots(2,3,figsize=(17,12));fig.subplots_adjust(top=.78,bottom=.24,left=.065,right=.97,hspace=.25,wspace=.12)
    fig.text(.045,.95,"Original UV birth and update now feed the native quad writers",fontsize=23,weight="bold")
    fig.text(.045,.905,f"{proof['graphs']:,} loaded emitters · {meta['coverage']['baseUv']} base-UV / {meta['coverage']['multUv']} mult-UV classifications · build {meta['build']}",fontsize=13,color="#a9bddb")
    fig.text(.045,.858,"Actual prepared texture layers through native half-float vertex UVs. Each row follows one particle across time.",fontsize=12,color="#80e8cc")
    for row,(label,panels) in enumerate(samples):
        for col,(time,pixels,origin) in enumerate(panels):
            ax=axes[row,col];ax.imshow(pixels);ax.set_axis_off()
            ax.set_title(f"{label}\n{time:.2f} s · first vertex UV ({origin[0]:.3f}, {origin[1]:.3f})",fontsize=10,pad=10,color="#e8edf6")
    fig.text(.065,.183,f"{proof['frames']:,} sampled frames · {proof['initialUvPoolRecords']:,} initial UV pool records · {proof['uvMatrixRecords']:,} updated matrix records",fontsize=12,color="#80e8cc")
    fig.text(.065,.147,"Original record classification, complete birth/update path and particle sampling context; no injected per-particle UV matrices.",fontsize=11,color="#a9bddb")
    fig.text(.045,.09,"Layers shown independently with repeat/bilinear sampling. Material combination, erosion, color and game shaders are unrendered.",fontsize=11,weight="bold")
    fig.text(.045,.045,f"Instruction/data parity uses recorded native-host math. Normal preview math differs in {proof['previewMathMismatchCount']} forward frames. Texture presence is supplied; GPU resource acquisition and main-preview integration remain ahead.",fontsize=9,color="#a9bddb")
    fig.savefig(args.output,dpi=140);plt.close(fig)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"definitionSha256":sha(meta_raw),"nativeEvidenceSha256":sha(native_raw),
        "comparisonSha256":sha(proof_raw),"samplerDefinitionSha256":sha(sampler_raw),"effectsManifestSha256":sha(manifest_raw),"effectSources":sources,
        "textures":textures,"rendererSha256":sha(Path(__file__).read_bytes()),"imageSha256":sha(args.output.read_bytes()),"scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes())}))


if __name__=="__main__":main()
