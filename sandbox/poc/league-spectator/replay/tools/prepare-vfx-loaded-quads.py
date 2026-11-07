"""Connect complete post-loaded emitters to the explicit native quad environment."""
import argparse
from collections import Counter
import json
from pathlib import Path

from vfx_loaded_quad_native import NativeLoadedQuad,LoadedQuadAdmissionError
from vfx_spawn_native import sha
from vfx_emitter_native import GEOMETRY


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client"]:parser.add_argument(name,type=Path)
    args=parser.parse_args();k=NativeLoadedQuad(args.package,args.client)
    post_raw=(args.package/"vfx-postload.json").read_bytes();post=json.loads(post_raw)
    if sha(post_raw)!=k.profile["vfxPostloadSha256"]:raise ValueError("Post-load metadata changed")
    for name,digest in post["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=digest:raise ValueError("Post-load compiler changed")
    templates,rejected=[],[]
    out=args.package/"vfx-loaded-quad-graphs";out.mkdir(exist_ok=True)
    for key,ref in post["emitters"].items():
        raw=(args.package/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Native post-load graph changed")
        try:graph=k.prepare_loaded(json.loads(raw))
        except LoadedQuadAdmissionError as error:
            rejected.append({"key":key,"reason":str(error)});continue
        graph.update({"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],
            "effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],
            "sourceDefinitionSha256":ref["definitionSha256"],"postloadGraphSha256":ref["sha256"]})
        raw=json.dumps(graph,separators=(",",":"),allow_nan=False).encode();digest=sha(raw)
        (out/f"{digest}.json").write_bytes(raw)
        templates.append({"effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],
            "sourceDefinitionSha256":ref["definitionSha256"],"postloadGraphSha256":ref["sha256"],
            "sha256":digest,"file":f"vfx-loaded-quad-graphs/{digest}.json","bytes":len(raw)})
    spawn=k.checked_json("vfx-spawn.json","vfxSpawnSha256")
    sources=["prepare-vfx-loaded-quads.py","vfx_loaded_quad_native.py",*post["compilerSources"],
        "vfx_legacy_quad_native.py","vfx_emitter_native.py","vfx_uv_native.py"]
    meta={"schema":1,"build":post["build"],"protocol":post["protocol"],"sliceSha256":post["sliceSha256"],
        "decoderImageSha256":post["decoderImageSha256"],"runtimeSha256":spawn["runtimeSha256"],
        "vfxSpawnSha256":k.profile["vfxSpawnSha256"],"vfxEmitterSha256":k.profile["vfxEmitterSha256"],
        "vfxPostloadSha256":sha(post_raw),"vfxAssetsSha256":post["vfxAssetsSha256"],
        "frameRva":0x1757f10,"writerRva":0x1730410,"primitiveVtableRva":0x23f20c8,
        "maximumParticles":1024,"uvScratchAddress":0x1002f000,"geometryAddresses":GEOMETRY,
        "initializedGlobals":k.emitter_meta["initializedGlobals"],
        "templates":templates,"rejected":rejected,"rejectionCounts":dict(Counter(v["reason"] for v in rejected)),
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in sources},
        "scope":graph["ownedInputs"]}
    raw=json.dumps(meta,indent=2).encode();(args.package/"vfx-loaded-quads.json").write_bytes(raw)
    k.profile["vfxLoadedQuadsSha256"]=sha(raw);(args.package/"profile.json").write_text(json.dumps(k.profile,indent=2),encoding="utf-8")
    print(json.dumps({"graphs":len(templates),"rejected":len(rejected),"reasons":meta["rejectionCounts"],"sha256":sha(raw)}))


if __name__=="__main__":main()
