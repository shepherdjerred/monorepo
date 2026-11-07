"""Visualize native camera-facing planes and a software additive texture composite."""
import argparse
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np
from PIL import Image

from vfx_spawn_native import sha


def composite(frame,texture,width=440,height=340):
    raw=bytes.fromhex(frame["output"]["geometry"]["verticesHex"])
    indices=np.frombuffer(bytes.fromhex(frame["output"]["geometry"]["indicesHex"]),dtype="<u2")
    if len(raw)%112 or len(indices)!=len(raw)//112*6:raise ValueError("Camera visual geometry layout changed")
    vertices=[];uvs=[];colors=[]
    for at in range(0,len(raw),28):
        vertices.append(struct.unpack_from("<3f",raw,at));uvs.append(struct.unpack_from("<2e",raw,at+16))
        color=struct.unpack_from("<I",raw,at+12)[0]
        colors.append([((color>>bit)&255)/255 for bit in [16,8,0,24]])
    points=np.asarray(vertices);uvs=np.asarray(uvs);colors=np.asarray(colors)
    right=np.asarray(frame["input"]["cameraRight"]);up=np.asarray(frame["input"]["cameraUp"])
    projected=np.column_stack([points@right,points@up]);center=(projected.min(axis=0)+projected.max(axis=0))/2
    span=max(float(np.ptp(projected,axis=0).max()),200)*1.18
    positions=(projected-center)*[min(width,height)/span,-min(width,height)/span]+[width/2,height/2]
    pixels=np.empty((height,width,3));pixels[:]=np.array([20,34,56])/255
    th,tw=texture.shape[:2]
    for start in range(0,len(indices),6):
        group=indices[start:start+6]
        if group.max()>=len(points):raise ValueError("Camera visual index outside native vertices")
        lo=np.maximum(np.floor(positions[group].min(axis=0)).astype(int),0)
        hi=np.minimum(np.ceil(positions[group].max(axis=0)).astype(int),[width-1,height-1])
        if np.any(lo>hi):continue
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        samples=np.stack([xx,yy],axis=-1);inside=np.zeros(xx.shape,dtype=bool)
        uv=np.zeros((*xx.shape,2));color=np.zeros((*xx.shape,4))
        for triangle in group.reshape(-1,3):
            t=positions[triangle];basis=np.column_stack([t[1]-t[0],t[2]-t[0]])
            if abs(np.linalg.det(basis))<1e-10:continue
            local=(samples-t[0])@np.linalg.inv(basis).T
            mask=(local[...,0]>=0)&(local[...,1]>=0)&(local.sum(axis=-1)<=1)
            for values,target in [(uvs,uv),(colors,color)]:
                v=values[triangle];interpolated=v[0]+local[...,0,None]*(v[1]-v[0])+local[...,1,None]*(v[2]-v[0])
                target[:]=np.where(mask[...,None],interpolated,target)
            inside|=mask
        xy=uv*[tw,th]-.5;floor=np.floor(xy).astype(int);weight=xy-floor
        x,y=floor[...,0]%tw,floor[...,1]%th;nx,ny=(x+1)%tw,(y+1)%th
        wx,wy=weight[...,0,None],weight[...,1,None]
        rgba=((texture[y,x]*(1-wx)+texture[y,nx]*wx)*(1-wy)+(texture[ny,x]*(1-wx)+texture[ny,nx]*wx)*wy)*color
        target=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        target[:]=np.where(inside[...,None],np.clip(target+rgba[...,:3]*np.clip(rgba[...,3,None],0,1),0,1),target)
    return np.rint(pixels*255).astype(np.uint8),points.reshape(-1,4,3),colors.reshape(-1,4,4).mean(axis=1)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","effects","native","comparison","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    meta_raw=(args.package/"vfx-camera-quads.json").read_bytes();native_raw=args.native.read_bytes();proof_raw=args.comparison.read_bytes()
    meta,native,proof=map(json.loads,[meta_raw,native_raw,proof_raw])
    if proof["definitionSha256"]!=sha(meta_raw) or proof["nativeEvidenceSha256"]!=sha(native_raw) or proof["mismatchCount"]:
        raise ValueError("Unmatched camera visual evidence")
    for name,digest in proof["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes())!=digest:raise ValueError("Stale camera visual source")
    effect_id="champions/ornn/0/0299df86";index=0
    manifest_raw=(args.effects/"manifest.json").read_bytes();manifest=json.loads(manifest_raw)
    source=manifest["definitions"][effect_id];effect_raw=(args.effects/source["file"]).read_bytes()
    if sha(effect_raw)!=source["sha256"]:raise ValueError("Camera visual effect changed")
    emitter=json.loads(effect_raw)["definition"]["complexEmitterDefinitionData"][index]
    if emitter.get("blendMode")!=4 or emitter.get("textureMult") or any("uv" in key.lower() or key in ["numFrames","texDiv"] for key in emitter):
        raise ValueError("Software camera visual requires a single additive texture without authored UV animation")
    asset=manifest["assets"][emitter["texture"].lower()]
    if asset["status"]!="prepared" or asset["kind"]!="texture":raise ValueError("Camera visual texture is unprepared")
    texture_raw=(args.effects/asset["file"]).read_bytes()
    if sha(texture_raw)!=asset["sha256"]:raise ValueError("Camera visual texture changed")
    texture=np.asarray(Image.open(args.effects/asset["file"]).convert("RGBA"),dtype=np.float64)/255
    ref=next(r for r in meta["templates"] if r["effectId"]==effect_id and r["emitterIndex"]==index)
    frames=[]
    for mode in [0,1,2]:
        case=next(c for c in native["cases"] if c["graphSha256"]==ref["sha256"] and c["mode"]==mode)
        frames.append(next(f for f in case["frames"] if f["input"]["time"]==.2))
    plt.rcParams.update({"font.family":"DejaVu Sans","text.color":"#e8edf6","axes.labelcolor":"#a9bddb",
        "xtick.color":"#7890af","ytick.color":"#7890af","axes.edgecolor":"#344966",
        "axes.facecolor":"#142238","figure.facecolor":"#0e1828"})
    fig=plt.figure(figsize=(17,12));grid=fig.add_gridspec(2,3,left=.055,right=.97,top=.79,bottom=.22,hspace=.1,wspace=.15)
    fig.text(.045,.95,"Camera-facing particles use the original orientation cache",fontsize=24,weight="bold")
    fig.text(.045,.9,f"Ornn brazier glow · 0.20 s · {proof['graphs']:,} prepared camera quads · build {meta['build']}",fontsize=13,color="#a9bddb")
    fig.text(.045,.855,"Top: original quad planes in world space. Bottom: actual texture, native positions, UVs and packed colors.",fontsize=12,color="#80e8cc")
    rendered=[composite(frame,texture) for frame in frames]
    world_points=np.concatenate([(quads-np.asarray(frame["input"]["current"])).reshape(-1,3)
        for frame,(pixels,quads,colors) in zip(frames,rendered)])
    bound=max(float(np.abs(world_points).max()),180)*1.15
    alignments=[]
    for col,(frame,label) in enumerate(zip(frames,["Base camera / seed 1","Orbit camera + actor movement","Tilted camera + rotated actor"])):
        pixels,quads,colors=rendered[col]
        quads=quads-np.asarray(frame["input"]["current"])
        axis=np.asarray(frame["input"]["viewAxis"])
        for quad in quads:
            normal=np.cross(quad[1]-quad[0],quad[2]-quad[0]);length=np.linalg.norm(normal)
            if length>1e-8:alignments.append(abs(float(np.dot(normal/length,axis))))
        ax=fig.add_subplot(grid[0,col],projection="3d")
        face=colors.copy();face[:,3]*=.25
        ax.add_collection3d(Poly3DCollection(quads,facecolors=face,edgecolors="#ffc47b",linewidths=.8))
        ax.quiver(0,0,0,*axis,length=bound*.65,color="#80e8cc",linewidth=1.5)
        for setter in [ax.set_xlim,ax.set_ylim,ax.set_zlim]:setter(-bound,bound)
        ax.set_box_aspect((1,1,1));ax.view_init(elev=24,azim=-52);ax.set_title(label,fontsize=11,pad=10,color="#e8edf6")
        ax.tick_params(labelsize=7);ax.set_xlabel("x",labelpad=-8);ax.set_ylabel("y",labelpad=-8);ax.set_zlabel("z",labelpad=-8)
        for pane in [ax.xaxis.pane,ax.yaxis.pane,ax.zaxis.pane]:pane.set_facecolor("#142238");pane.set_edgecolor("#344966")
        ax2=fig.add_subplot(grid[1,col]);ax2.imshow(pixels);ax2.set_axis_off()
    if not alignments or min(alignments)<.9999:raise ValueError("Native visual planes do not align with the supplied view axes")
    fig.text(.055,.17,f"{proof['frames']:,} sampled frames; complete 360-entry orientation caches checked against native output.",fontsize=12,color="#80e8cc")
    fig.text(.055,.135,"Camera axes and seeds are supplied inputs. The original cache builder and embedded degree-trig lookup execute unchanged.",fontsize=11,color="#a9bddb")
    fig.text(.045,.08,"Software additive composite; game shaders, material passes and the original camera controller remain unverified.",fontsize=12,weight="bold")
    fig.text(.045,.04,f"Instruction/data parity uses recorded native-host math with exact argument checks. Normal preview math differs in {proof['previewMathMismatchCount']} forward frames. Main-preview integration remains ahead.",fontsize=10,color="#a9bddb")
    fig.savefig(args.output,dpi=140);plt.close(fig)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"definitionSha256":sha(meta_raw),"nativeEvidenceSha256":sha(native_raw),
        "comparisonSha256":sha(proof_raw),"effectsManifestSha256":sha(manifest_raw),"effectSources":{source["file"]:sha(effect_raw)},
        "textures":{asset["file"]:sha(texture_raw)},"planeAlignmentMinimum":min(alignments),
        "rendererSha256":sha(Path(__file__).read_bytes()),"imageSha256":sha(args.output.read_bytes()),"scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes()),"planeAlignmentMinimum":min(alignments)}))


if __name__=="__main__":main()
