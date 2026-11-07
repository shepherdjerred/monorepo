"""Run the original post-load walker after complete serialized field loading."""
import argparse
from collections import Counter
import json
from pathlib import Path

from vfx_postload_native import NativeVfxPostload
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client","effects","work","evidence"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    k=NativeVfxPostload(args.package,args.client)
    assets_raw=(args.package/"vfx-assets.json").read_bytes();assets=json.loads(assets_raw)
    effects_raw=(args.effects/"manifest.json").read_bytes();effects=json.loads(effects_raw)
    if sha(assets_raw)!=k.profile["vfxAssetsSha256"] or sha(effects_raw)!=assets["effectsManifestSha256"]:
        raise ValueError("Post-load input packages changed")
    for name,digest in assets["compilerSources"].items():
        if sha(Path(__file__).with_name(name).read_bytes())!=digest:raise ValueError("Serialized field compiler changed")
    raw_sources={};emitters={};observations=[];visits=Counter();counts=Counter();repeated=0
    out=args.package/"vfx-postload-graphs";out.mkdir(exist_ok=True)
    parser_id=effects["toolchain"]["parserIdentity"][:16]
    for key,ref in assets["emitters"].items():
        digest=ref["rawSourceSha256"]
        if digest not in raw_sources:
            raw=(args.work/"bins"/f"{digest}-{parser_id}.bin").read_bytes()
            if sha(raw)!=digest:raise ValueError("Post-load raw source changed")
            raw_sources[digest]=raw
        source=raw_sources[digest]
        fields=[source[f["offset"]:f["offset"]+f["bytes"]] for f in ref["fields"]]
        before=k.load(fields)
        serialized=json.dumps({"schema":1,"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],
            "phase":"serialized-fields-before-postload",**before},separators=(",",":"),allow_nan=False).encode()
        if sha(serialized)!=ref["sha256"]:
            expected=json.loads((args.package/ref["file"]).read_bytes())
            changed=[name for name,value in before.items() if value!=expected[name]]
            raise ValueError(f"{key}: Post-load serialized state differs in {changed}; heap start {before['heapStart']:x}/{expected['heapStart']:x}")
        try:after=k.postload()
        except Exception as error:raise ValueError(f"{key}: {error}") from error
        data=json.dumps({"schema":1,"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],
            "phase":"native-postload-callbacks-executed",**after},separators=(",",":"),allow_nan=False).encode()
        state_hash=sha(data);(out/f"{state_hash}.json").write_bytes(data)
        k.restore_preload_arena()
        obj_before,obj_after=bytes.fromhex(before["objectHex"]),bytes.fromhex(after["objectHex"])
        heap_before,heap_after=bytes.fromhex(before["heapHex"]),bytes.fromhex(after["heapHex"])
        changed=sum(a!=b for a,b in zip(obj_before,obj_after))+sum(a!=b for a,b in zip(heap_before,heap_after))+abs(len(heap_before)-len(heap_after))
        counts["emitters"]+=1;counts["objectVisits"]+=len(after["visits"]);counts["callbackVisits"]+=sum(v["callbackRva"] is not None for v in after["visits"])
        counts["changedBytes"]+=changed;counts["changedEmitters"]+=bool(changed);counts["mathCalls"]+=len(after["mathCalls"])
        counts["pendingLinkFixups"]+=after["pendingLinkFixups"]
        visits.update(v["type"] for v in after["visits"])
        emitters[key]={"effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],"definitionSha256":ref["definitionSha256"],
            "serializedGraphSha256":ref["sha256"],"sha256":state_hash,"file":f"vfx-postload-graphs/{state_hash}.json","bytes":len(data),
            "heapBytes":len(heap_after),"changedBytes":changed,"visits":len(after["visits"]),"pendingLinkFixups":after["pendingLinkFixups"]}
        if ref["emitterIndex"]==0:
            k.load(fields);again=k.postload()
            if again!=after:raise ValueError("Native post-load reset/reload differs")
            k.restore_preload_arena()
            repeated+=1
        observations.append({"key":key,"sha256":state_hash,"objectSha256":sha(obj_after),"heapSha256":sha(heap_after),
                             "beforeObjectSha256":sha(obj_before),"beforeHeapSha256":sha(heap_before)})
        if counts["emitters"]%200==0:print(json.dumps({"emitters":counts["emitters"],"visits":counts["objectVisits"],"pendingLinks":counts["pendingLinkFixups"]}),flush=True)
    sources=["prepare-vfx-postload.py","vfx_postload_native.py",*assets["compilerSources"]]
    meta={"schema":1,"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],"sliceSha256":k.profile["sliceSha256"],
        "decoderImageSha256":k.profile["decoderImageSha256"],"vfxAssetsSha256":sha(assets_raw),"effectsManifestSha256":sha(effects_raw),
        "postloadRva":0x14bc490,"emitters":emitters,"summary":dict(counts),"repeatedLoads":repeated,
        "visitedTypes":{f"{t:08x}":c for t,c in sorted(visits.items())},
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in sources},
        "scope":"Original recursive metadata post-load walker and class callbacks after complete native field loading. Owned streams/allocators and bounded library services remain explicit. Callback completion is not full resource/link resolution, material acquisition, runtime/render admission, original shaders, replay integration or A/V fidelity."}
    raw=json.dumps(meta,indent=2).encode();(args.package/"vfx-postload.json").write_bytes(raw)
    k.profile["vfxPostloadSha256"]=sha(raw);(args.package/"profile.json").write_text(json.dumps(k.profile,indent=2),encoding="utf-8")
    evidence={"schema":1,"build":meta["build"],"protocol":meta["protocol"],"definitionSha256":sha(raw),"compilerSources":meta["compilerSources"],
        "observations":observations,"originalBlocks":list(k.blocks.values()),"postloadOriginalBlocks":list(k.postload_blocks.values()),
        "summary":dict(counts),"repeatedLoads":repeated,"scope":meta["scope"]}
    args.evidence.write_text(json.dumps(evidence,indent=2),encoding="utf-8")
    print(json.dumps({**dict(counts),"repeatedLoads":repeated,"visitedTypes":len(visits),"postloadBlocks":len(k.postload_blocks),"sha256":sha(raw)}))


if __name__=="__main__":main()
