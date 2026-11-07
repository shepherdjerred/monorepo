"""Prepare complete native camera-quad assets and original camera-cache entry points."""
import argparse
from collections import Counter
import json
from pathlib import Path

from vfx_camera_quad_native import NativeCameraQuad,CAMERA_CACHE,CAMERA_INPUT
from vfx_loaded_quad_native import LoadedQuadAdmissionError
from vfx_spawn_native import sha
from vfx_emitter_native import GEOMETRY


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client"]:parser.add_argument(name,type=Path)
    args=parser.parse_args();k=NativeCameraQuad(args.package,args.client)
    post_raw=(args.package/"vfx-postload.json").read_bytes();post=json.loads(post_raw)
    if sha(post_raw)!=k.profile["vfxPostloadSha256"]:raise ValueError("Camera post-load metadata changed")
    for name,digest in post["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=digest:raise ValueError("Post-load compiler changed")
    templates,rejected=[],[]
    out=args.package/"vfx-camera-quad-graphs";out.mkdir(exist_ok=True)
    scope=None
    for key,ref in post["emitters"].items():
        raw=(args.package/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Native camera post-load graph changed")
        try:graph=k.prepare_camera(json.loads(raw))
        except LoadedQuadAdmissionError as error:
            rejected.append({"key":key,"reason":str(error)});continue
        scope=graph["ownedInputs"]
        graph.update({"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],
            "effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],
            "sourceDefinitionSha256":ref["definitionSha256"],"postloadGraphSha256":ref["sha256"]})
        raw=json.dumps(graph,separators=(",",":"),allow_nan=False).encode();digest=sha(raw)
        (out/f"{digest}.json").write_bytes(raw)
        templates.append({"effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],
            "sourceDefinitionSha256":ref["definitionSha256"],"postloadGraphSha256":ref["sha256"],
            "sha256":digest,"file":f"vfx-camera-quad-graphs/{digest}.json","bytes":len(raw)})
    if not templates:raise ValueError("No admitted camera quad states")
    spawn=k.checked_json("vfx-spawn.json","vfxSpawnSha256")
    sources=["prepare-vfx-camera-quads.py","vfx_camera_quad_native.py","vfx_loaded_quad_native.py",*post["compilerSources"],
        "vfx_legacy_quad_native.py","vfx_emitter_native.py","vfx_uv_native.py"]
    blocks=[]
    for a,b in [(0x1733290,0x1733cb1),(0x1746290,0x17463e4),(0x1489360,0x14893c9),
                (0x14893d0,0x1489444),(0x148e7d0,0x148e918)]:
        if k.image[a:b]!=k.source.image[a:b]:raise ValueError("Camera source code differs from original")
        blocks.append({"startRva":a,"endRva":b,"sha256":sha(k.image[a:b])})
    meta={"schema":1,"build":post["build"],"protocol":post["protocol"],"sliceSha256":post["sliceSha256"],
        "decoderImageSha256":post["decoderImageSha256"],"runtimeSha256":spawn["runtimeSha256"],
        "vfxSpawnSha256":k.profile["vfxSpawnSha256"],"vfxEmitterSha256":k.profile["vfxEmitterSha256"],
        "vfxPostloadSha256":sha(post_raw),"vfxAssetsSha256":post["vfxAssetsSha256"],
        "frameRva":0x1757f10,"writerRva":0x1733290,"primitiveVtableRva":0x23f23b0,
        "cameraCacheRva":0x1746290,"cameraCacheAddress":CAMERA_CACHE,"cameraInputAddress":CAMERA_INPUT,
        "cameraCacheDataOffset":0x158,"cameraCacheDataBytes":0x21d8,"cameraAngles":360,
        "degreeTrigTable":{"rva":0x20e0090,"bytes":3600*4,"sha256":sha(k.image[0x20e0090:0x20e0090+3600*4])},
        "maximumParticles":1024,"uvScratchAddress":0x1002f000,"geometryAddresses":GEOMETRY,
        "initializedGlobals":k.emitter_meta["initializedGlobals"],"sourceBlocks":blocks,
        "templates":templates,"rejected":rejected,"rejectionCounts":dict(Counter(v["reason"] for v in rejected)),
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in sources},"scope":scope}
    raw=json.dumps(meta,indent=2).encode();(args.package/"vfx-camera-quads.json").write_bytes(raw)
    k.profile["vfxCameraQuadsSha256"]=sha(raw);(args.package/"profile.json").write_text(json.dumps(k.profile,indent=2),encoding="utf-8")
    print(json.dumps({"graphs":len(templates),"rejected":len(rejected),"reasons":meta["rejectionCounts"],"sha256":sha(raw)}))


if __name__=="__main__":main()
