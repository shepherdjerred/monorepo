"""Original Ornn Forge event → world bone → point-quad sequence on supplied clocks."""
import argparse
import copy
import json
from pathlib import Path
import runpy
import struct

from unicorn import x86_const as r
from animation_world_pose_native import NativeAnimationWorldPose
from animation_events_native import NativeAnimationEvents
from animation_attachment_native import NativeAnimationAttachment
from vfx_point_quad_native import NativePointQuad
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client","scene","poses","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args();profile=json.loads((args.package/"profile.json").read_bytes())
    def checked(name,key):
        raw=(args.package/name).read_bytes()
        if sha(raw)!=profile[key]:raise ValueError("Sequence package changed: "+name)
        return json.loads(raw)
    rigs=checked("animation-rigs.json","animationRigsSha256")
    worldmeta=checked("animation-world-poses.json","animationWorldPosesSha256")
    eventmeta=checked("animation-events.json","animationEventsSha256")
    attachmeta=checked("animation-attachments.json","animationAttachmentsSha256")
    pointmeta=checked("vfx-point-quads.json","vfxPointQuadsSha256")
    pose_raw=(args.poses/"manifest.json").read_bytes()
    if sha(pose_raw)!=profile["animationPosesSha256"]:raise ValueError("Sequence poses changed")
    poses=json.loads(pose_raw);graph_file="champions/ornn/0/graph.json"
    graph=worldmeta["graphs"][graph_file];posegraph=poses["graphs"][graph_file]
    clip=posegraph["catalog"]["clips"]["Forge"]
    clip_file=posegraph["directory"]+"/"+clip["file"];clip_raw=(args.poses/clip_file).read_bytes()
    if sha(clip_raw)!=clip["sha256"]:raise ValueError("Sequence clip changed")
    group=next(g for g in eventmeta["groups"] if g["actor"]=="champions/ornn/0" and g["path"][-1]=="Forge")
    event=next(e for e in group["events"] if e["id"]=="Sparks")
    attachment_group=next(g for g in attachmeta["groups"] if g["actor"]==group["actor"] and g["path"]==group["path"])
    attachment_event=next(e for e in attachment_group["events"] if e["id"]==event["id"])
    if attachment_event["status"]!="request-component":raise ValueError("Unprepared sequence event")
    pair=attachment_event["pairs"][0]
    activation={"effectKey":int(event["effectKeyHash"],16),"pairs":[[pair["mBoneName"]["hash"],pair["mTargetBoneName"]["hash"]]],
                "detachable":False,"poseAfterimage":False}
    if event["authored"].get("mIsDetachable",False) or event["authored"].get("mScalePlaySpeedWithAnimation",False):
        raise ValueError("Unsupported authored sequence flags")
    refs=[t for t in pointmeta["templates"] if t["effectId"]==event["binding"]["effectId"]]
    if len(refs)!=4:raise ValueError("Unexpected Forge point-quad admission")
    world=NativeAnimationWorldPose(args.package,args.client)
    rig_raw=(args.scene/graph["rigFile"]).read_bytes()
    if sha(rig_raw)!=graph["rigSha256"]:raise ValueError("Sequence rig changed")
    world.construct(rig_raw,graph["joints"])
    scheduler=NativeAnimationEvents(args.package,args.client);scheduler.reset([event["scheduling"]])
    attachments=NativeAnimationAttachment(args.package,args.client)
    emitters=[]
    for ref in refs:
        raw=(args.package/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Sequence point graph changed")
        emitters.append({"ref":ref,"graph":json.loads(raw),"kernel":NativePointQuad(args.package,args.client)})
    local_frame=runpy.run_path(str(Path(__file__).with_name("prepare-animation-world-poses.py")))["local_frame"]
    records=[];active=None;previous=None
    fps=struct.unpack("<f",struct.pack("<f",clip["fps"]))[0]
    for frame in range(clip["frames"]):
        time=frame/fps
        local=local_frame(clip_raw,frame,graph)
        root=struct.pack("<10f",120+frame*2,0,250+frame,1,1,1,0,0,0,1).hex()
        pose=world.evaluate(local,root,True);scheduling=scheduler.step(frame);requests=[]
        joints=[{"hash":b["fnvHash"],"resolvedBoneKey":b["resolvedBoneKey"],"transformHex":pose["worldHex"][b["poseJointIndex"]]}
                for b in rigs["graphs"][graph_file]["bindings"]]
        for request in scheduling["requests"]:
            if request["kind"]!="activate-request" or active is not None:raise ValueError("Unexpected sequence scheduler request")
            attachments.reset({**activation,"joints":joints,"ownerPositionHex":root[:24]})
            result=attachments.activate();requests=result["requests"]
            source=next(r for r in requests if r["kind"]=="source-binding-request")
            if source["binding"]["kind"]!="bone":raise ValueError("Unsupported sequence source factory")
            active={"start":time,"key":source["binding"]["resolvedBoneKey"]}
            for emitter in emitters:emitter["kernel"].reset_quad(emitter["graph"],1,0)
        draws=[]
        if active:
            selected=next(j for j in joints if j["resolvedBoneKey"]==active["key"])
            transform=bytes.fromhex(selected["transformHex"]);position=list(struct.unpack("<3f",transform[:12]))
            age=struct.unpack("<f",struct.pack("<f",time-active["start"]))[0]
            for emitter in emitters:
                k=emitter["kernel"];k.u.mem_write(0x100c0000,transform)
                k.call(0x148d170,{r.UC_X86_REG_RDI:0x100c0018,r.UC_X86_REG_RSI:0x100c0100})
                basis=list(struct.unpack("<16f",k.u.mem_read(0x100c0100,64)))
                inp={"time":age,"previous":previous or position,"current":position,"basis":basis,"viewPosition":[0,1000,0]}
                draws.append({"emitterIndex":emitter["ref"]["emitterIndex"],"input":inp,"output":k.frame_quad(inp)})
            previous=position
        records.append({"input":{"frame":frame,"time":time,"localHex":local,"rootHex":root,"viewPosition":[0,1000,0]},
                        "output":{"pose":pose,"scheduling":scheduling,"attachmentRequests":requests,"draws":draws}})
    cleanup=attachments.cleanup()
    original={}
    for kernel in [world,scheduler,attachments,*[e["kernel"] for e in emitters]]:original.update(kernel.blocks)
    sources=["observe-animation-point-sequence.py","prepare-animation-world-poses.py","animation_world_pose_native.py","animation_rig_native.py",
             "animation_events_native.py","animation_attachment_native.py","vfx_point_quad_native.py","vfx_legacy_quad_native.py","vfx_spawn_native.py","vfx_emitter_native.py","vfx_uv_native.py"]
    evidence={"schema":1,"build":profile["clientVersion"],"protocol":profile["protocolDigest"],"decoderImageSha256":profile["decoderImageSha256"],
        "packages":{name:profile[name] for name in ["animationRigsSha256","animationWorldPosesSha256","animationEventsSha256","animationAttachmentsSha256","animationPosesSha256","vfxPointQuadsSha256"]},
        "graph":graph_file,"clip":"Forge","clipFile":clip_file,"clipSha256":sha(clip_raw),"eventSpec":event["scheduling"],"activation":activation,
        "effectId":event["binding"]["effectId"],"emitterRefs":refs,"frames":records,"cleanup":cleanup,
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in sources},"originalBlocks":list(original.values()),
        "scope":"Composed original animation-event scheduling, world-pose production, bone-key activation and point-quad birth/update/removal/writer. Supplied integer animation frames, Toolkit local samples, root trajectory, seed 1, quality 0, unit effect scales and fixed frame cadence. Bone orientation uses original 0x148d170, matching the bone-follow getter helper; full context transform factories and effect transform update policy remain unexecuted. Four of thirteen Forge emitters admitted; UV/textures/materials and remaining nine emitters are outside this sequence. No replay-driven action or main-viewer/GPU/A-V claim."}
    args.output.write_text(json.dumps(evidence,indent=2,allow_nan=False),encoding="utf-8")
    print(json.dumps({"frames":len(records),"activationFrames":[x["input"]["frame"] for x in records if x["output"]["attachmentRequests"]],
                      "drawFrames":sum(len(x["output"]["draws"]) for x in records),"emitters":len(refs),"originalBlocks":len(original)}))


if __name__=="__main__":main()
