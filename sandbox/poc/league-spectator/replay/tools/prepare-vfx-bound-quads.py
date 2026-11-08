"""Prepare complete loaded quad objects with original UV record classification."""
import argparse
from collections import Counter
import json
from pathlib import Path

from vfx_bound_quad_native import NativeBoundQuad,DEFAULT_MULT,TEXTURE_PRESENCE
from vfx_loaded_quad_native import LoadedQuadAdmissionError
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client"]:parser.add_argument(name,type=Path)
    args=parser.parse_args();k=NativeBoundQuad(args.package,args.client)
    post_raw=(args.package/"vfx-postload.json").read_bytes();post=json.loads(post_raw)
    if sha(post_raw)!=k.profile["vfxPostloadSha256"]:raise ValueError("Bound quad post-load metadata changed")
    camera=k.checked_json("vfx-camera-quads.json","vfxCameraQuadsSha256")
    for name,digest in camera["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=digest:raise ValueError("Camera source changed")
    templates,rejected=[],[];scope=None
    out=args.package/"vfx-bound-quad-graphs";out.mkdir(exist_ok=True)
    for key,ref in post["emitters"].items():
        raw=(args.package/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Bound quad source graph changed")
        try:graph=k.prepare_bound(json.loads(raw))
        except LoadedQuadAdmissionError as error:
            rejected.append({"key":key,"reason":str(error)});continue
        scope=graph["ownedInputs"]
        graph.update({"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],"effectId":ref["effectId"],
            "emitterIndex":ref["emitterIndex"],"sourceDefinitionSha256":ref["definitionSha256"],"postloadGraphSha256":ref["sha256"]})
        raw=json.dumps(graph,separators=(",",":"),allow_nan=False).encode();digest=sha(raw)
        (out/f"{digest}.json").write_bytes(raw)
        templates.append({"effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],"primitiveKind":graph["primitiveKind"],
            "uvFlags":graph["uvFlags"],"hasMultDefinition":graph["hasMultDefinition"],"sourceDefinitionSha256":ref["definitionSha256"],
            "postloadGraphSha256":ref["sha256"],"sha256":digest,"file":f"vfx-bound-quad-graphs/{digest}.json","bytes":len(raw)})
    if not templates:raise ValueError("No prepared bound quad states")
    sources=["prepare-vfx-bound-quads.py","vfx_bound_quad_native.py",*camera["compilerSources"]]
    meta={name:camera[name] for name in ["schema","build","protocol","sliceSha256","decoderImageSha256","runtimeSha256", "vfxSpawnSha256",
        "vfxEmitterSha256","vfxPostloadSha256","vfxAssetsSha256","frameRva","cameraCacheRva","cameraCacheAddress","cameraInputAddress",
        "cameraCacheDataOffset","cameraCacheDataBytes","cameraAngles","degreeTrigTable","maximumParticles","uvScratchAddress","geometryAddresses"]}
    meta.update({"writerRvas":{"camera":0x1733290,"arbitrary":0x1730410},"primitiveVtables":{"camera":0x23f23b0,"arbitrary":0x23f20c8},
        "uvPredicateBlock":[0x16e1d6d,0x16e1dbe],"texturePresenceMarker":TEXTURE_PRESENCE,
        "defaultMultRva":DEFAULT_MULT,"defaultMultBytes":0xa9,
        "initializedGlobals":[*camera["initializedGlobals"],{"rva":DEFAULT_MULT,"bytesHex":bytes(k.u.mem_read(k.base+DEFAULT_MULT,0xa9)).hex()}],
        "sourceBlocks":[*camera["sourceBlocks"],{"startRva":0x16e1d6d,"endRva":0x16e2396,"sha256":sha(k.image[0x16e1d6d:0x16e2396])}],
        "templates":templates,"rejected":rejected,"rejectionCounts":dict(Counter(v["reason"] for v in rejected)),
        "coverage":{"emitters":len(templates),"primitiveKinds":dict(Counter(v["primitiveKind"] for v in templates)),
            "baseUv":sum(v["uvFlags"]["base"] for v in templates),"multUv":sum(v["uvFlags"]["mult"] for v in templates),
            "multDefinitions":sum(v["hasMultDefinition"] for v in templates)},
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in sources},"scope":scope})
    if meta["initializedGlobals"][-1]["bytesHex"][-2:]!="01":raise ValueError("Default mult UV initialization missing")
    raw=json.dumps(meta,indent=2).encode();(args.package/"vfx-bound-quads.json").write_bytes(raw)
    k.profile["vfxBoundQuadsSha256"]=sha(raw);(args.package/"profile.json").write_text(json.dumps(k.profile,indent=2),encoding="utf-8")
    print(json.dumps({**meta["coverage"],"rejected":len(rejected),"sha256":sha(raw)}))


if __name__=="__main__":main()
