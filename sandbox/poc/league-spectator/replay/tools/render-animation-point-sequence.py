"""Software composite of original animation-bound quad vertices and actual texture."""
import argparse
import json
from pathlib import Path
import struct

import matplotlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","effects","native","comparison","point_comparison","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    native_raw,proof_raw,point_raw=args.native.read_bytes(),args.comparison.read_bytes(),args.point_comparison.read_bytes()
    native,proof,point=map(json.loads,[native_raw,proof_raw,point_raw])
    if proof["nativeEvidenceSha256"]!=sha(native_raw) or proof["mismatchCount"] or point["mismatchCount"]:
        raise ValueError("Unmatched sequence visual evidence")
    for name,digest in proof["sources"].items():
        if sha(Path(__file__).parent.parent.joinpath(name).read_bytes())!=digest:raise ValueError("Stale sequence source")
    effects_raw=(args.effects/"manifest.json").read_bytes();effects=json.loads(effects_raw)
    effect_ref=effects["definitions"][native["effectId"]]
    definition_raw=(args.effects/effect_ref["file"]).read_bytes()
    if sha(definition_raw)!=effect_ref["sha256"]:raise ValueError("Sequence effect changed")
    definition=json.loads(definition_raw)["definition"]
    emitters=definition["complexEmitterDefinitionData"]
    texture_files={}
    def texture(index):
        emitter=emitters[index]
        if emitter.get("textureMult") or emitter.get("blendMode")!=4:
            raise ValueError("Software sequence requires additive single-texture emitters")
        key=emitter["texture"].lower();asset=effects["assets"][key]
        if asset["status"]!="prepared" or asset["kind"]!="texture":raise ValueError("Missing prepared sequence texture")
        raw=(args.effects/asset["file"]).read_bytes()
        if sha(raw)!=asset["sha256"]:raise ValueError("Sequence texture changed")
        texture_files[asset["file"]]=asset["sha256"]
        return np.asarray(Image.open(args.effects/asset["file"]).convert("RGBA"),dtype=np.float64)/255
    textures={r["emitterIndex"]:texture(r["emitterIndex"]) for r in native["emitterRefs"]}
    def decode(draw):
        raw=bytes.fromhex(draw["output"]["geometry"]["verticesHex"])
        if len(raw)%28:raise ValueError("Unprepared native vertex layout")
        rows=[]
        for at in range(0,len(raw),28):
            rgba=struct.unpack_from("<I",raw,at+12)[0]
            rows.append((struct.unpack_from("<3f",raw,at),struct.unpack_from("<2e",raw,at+16),
                         [((rgba>>bit)&255)/255 for bit in [16,8,0,24]]))
        return rows
    def project(p):
        p=np.asarray(p);return np.column_stack([.85*p[:,0]+.5*p[:,2],p[:,1]-.25*p[:,2]])
    chosen=[native["frames"][f] for f in [28,30,32]]
    all_points=np.array([r[0] for f in chosen for d in f["output"]["draws"] for r in decode(d)])
    projected=project(all_points);center=(projected.min(axis=0)+projected.max(axis=0))/2
    span=max(np.ptp(projected,axis=0).max(),160)*1.2
    world=json.loads((args.package/"animation-world-poses.json").read_bytes())["graphs"][native["graph"]]
    def panel(frame):
        width,height=480,410;scale=380/span
        def screen(points):return (project(points)-center)*[scale,-scale]+[width/2,height/2]
        background=Image.new("RGB",(width,height),"#142238");lines=ImageDraw.Draw(background)
        for x in range(0,width,40):lines.line([(x,0),(x,height)],fill="#1b2b43")
        for y in range(0,height,40):lines.line([(0,y),(width,y)],fill="#1b2b43")
        poses=np.array([struct.unpack("<10f",bytes.fromhex(h))[:3] for h in frame["output"]["pose"]["worldHex"]]);bones=screen(poses)
        for i,parent in enumerate(world["parents"]):
            if parent>=0:lines.line([tuple(bones[parent]),tuple(bones[i])],fill="#39516d",width=1)
        pixels=np.asarray(background,dtype=np.float64).copy()/255
        for draw in frame["output"]["draws"]:
            rows=decode(draw);tex=textures[draw["emitterIndex"]];th,tw=tex.shape[:2]
            for start in range(0,len(rows),4):
                quad=rows[start:start+4]
                if len(quad)!=4:raise ValueError("Incomplete native quad")
                positions=screen([r[0] for r in quad]);uvs=np.array([r[1] for r in quad]);colors=np.array([r[2] for r in quad])
                lo=np.maximum(np.floor(positions.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(positions.max(axis=0)).astype(int),[width-1,height-1])
                if np.any(lo>hi):continue
                xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5);samples=np.stack([xx,yy],axis=-1)
                inside=np.zeros(xx.shape,dtype=bool);uv=np.zeros((*xx.shape,2));color=np.zeros((*xx.shape,4))
                for triangle in [[0,1,2],[0,2,3]]:
                    t=positions[triangle];basis=np.column_stack([t[1]-t[0],t[2]-t[0]])
                    if abs(np.linalg.det(basis))<1e-10:continue
                    local=(samples-t[0])@np.linalg.inv(basis).T
                    mask=(local[...,0]>=0)&(local[...,1]>=0)&(local.sum(axis=-1)<=1)
                    for values,target in [(uvs,uv),(colors,color)]:
                        v=values[triangle];interp=v[0]+local[...,0,None]*(v[1]-v[0])+local[...,1,None]*(v[2]-v[0])
                        target[:]=np.where(mask[...,None],interp,target)
                    inside|=mask
                xy=uv*[tw,th]-.5;floor=np.floor(xy).astype(int);weight=xy-floor
                x,y=floor[...,0]%tw,floor[...,1]%th;nx,ny=(x+1)%tw,(y+1)%th
                wx,wy=weight[...,0,None],weight[...,1,None]
                rgba=((tex[y,x]*(1-wx)+tex[y,nx]*wx)*(1-wy)+(tex[ny,x]*(1-wx)+tex[ny,nx]*wx)*wy)*color
                target=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
                target[:]=np.where(inside[...,None],np.clip(target+rgba[...,:3]*np.clip(rgba[...,3,None],0,1),0,1),target)
        output=Image.fromarray(np.rint(pixels*255).astype(np.uint8));draw=ImageDraw.Draw(output)
        anchor=bones[world["joints"].index("C_Anvil_EndScale")]
        draw.ellipse([anchor[0]-4,anchor[1]-4,anchor[0]+4,anchor[1]+4],outline="#80e8cc",width=2)
        return output
    image=Image.new("RGB",(1600,1120),"#0d1727");text=ImageDraw.Draw(image)
    fontpath=Path(matplotlib.get_data_path())/"fonts/ttf/DejaVuSans.ttf"
    title,body,small=[ImageFont.truetype(str(fontpath),s) for s in [34,21,17]]
    text.text((50,30),"Animation event → bone attachment → particle geometry",font=title,fill="#edf3ff")
    text.text((50,90),f"Ornn Forge / Sparks · build {native['build']} · original event activation at frame 27",font=body,fill="#a9bddb")
    bone_key=next(r["binding"]["resolvedBoneKey"] for f in native["frames"] for r in f["output"]["attachmentRequests"] if r["kind"]=="source-binding-request")
    text.text((50,148),f"Native world pose → FNV bone lookup → ELF key 0x{bone_key:08x} → point-shape particle code",font=body,fill="#80e8cc")
    for x,frame in zip([50,560,1070],chosen):
        image.paste(panel(frame),(x,235));text.text((x,195),f"Animation frame {frame['input']['frame']}",font=body,fill="#edf3ff")
    text.text((50,675),"Actual texture + native vertices, UVs and packed colors · software additive composite",font=small,fill="#a9bddb")
    left,top,width,height=70,785,1460,115
    counts=[sum(len(d["output"]["geometry"]["verticesHex"])//224 for d in f["output"]["draws"]) for f in native["frames"]]
    maximum=max(counts+[1])
    text.text((50,730),"Particle lifecycle across the complete supplied clip",font=body,fill="#edf3ff")
    for i,count in enumerate(counts):
        x=left+i*width/len(counts);y=top+height-count/maximum*height
        if count:text.rectangle((x,y,x+width/len(counts)-1,top+height),fill="#57cdae")
    text.line((left,top+height,left+width,top+height),fill="#506580",width=1)
    for f in [0,27,60,90,123]:
        x=left+f*width/len(counts);text.text((x-10,top+height+10),str(f),font=small,fill="#a9bddb")
    text.text((690,top+height+28),"animation frame",font=small,fill="#a9bddb")
    text.text((50,960),f"124 frames + reset/resimulation · 388 emitter frames · {proof['births']} births · zero native/WASM mismatches",font=body,fill="#80e8cc")
    text.text((50,1007),f"Point-quad support: {point['graphs']} emitters. This sequence prepares 4 of 13 Forge emitters; 9 remain unsupported.",font=small,fill="#ffc47b")
    text.text((50,1041),"Supplied Toolkit local poses, actor movement, clock, seed and effect scale. Full transform factories and effect update policy remain unresolved.",font=small,fill="#a9bddb")
    text.text((50,1075),"Software component visualization. Main preview integration, remaining emitters, original shaders and reference A/V comparison remain ahead.",font=small,fill="#a9bddb")
    image.save(args.output)
    args.output.with_suffix(".json").write_text(json.dumps({"schema":1,"nativeEvidenceSha256":sha(native_raw),"comparisonSha256":sha(proof_raw),
        "pointComparisonSha256":sha(point_raw),"effectsManifestSha256":sha(effects_raw),"effectDefinitionSha256":sha(definition_raw),"textures":texture_files,
        "rendererSha256":sha(Path(__file__).read_bytes()),"imageSha256":sha(args.output.read_bytes()),"scope":__doc__},indent=2),encoding="utf-8")
    print(json.dumps({"file":str(args.output),"sha256":sha(args.output.read_bytes()),"textureFiles":texture_files}))


if __name__=="__main__":main()
