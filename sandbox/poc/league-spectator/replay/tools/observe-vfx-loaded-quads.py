"""Observe complete post-loaded quad assets in the supplied native scene context."""
import argparse
import json
from pathlib import Path

import unicorn
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_spawn_native import sha

IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
TURNED=[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args();k=NativeLoadedQuad(args.package,args.client)
    meta=k.checked_json("vfx-loaded-quads.json","vfxLoadedQuadsSha256")
    writes=[];active=[False]
    def write(uc,kind,at,count,value,user):
        if active[0]:writes.append((at-k.base,count))
    k.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,write,begin=k.base,end=k.base+len(k.image)-1)
    cases=[];variants=set();frames=births=vertices=indices=live_graphs=0
    times=[0,0,1/60,.05,.1,.2,.3,.5,.7,1,1.2,2]
    for ref in meta["templates"]:
        raw=(args.package/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Loaded quad graph changed")
        graph=json.loads(raw);actor=ref["effectId"].rsplit("/",1)[0]
        modes=[(0,1)];had_birth=False
        for mode,seed in modes:
            active[0]=True
            try:k.reset_quad(graph,seed,0)
            finally:active[0]=False
            records=[];previous=[0,0,0]
            for tick,time in enumerate(times):
                current=[12000+time*130,250+time*3,8500+time*70] if mode==1 else [0,0,0]
                inp={"time":time,"previous":previous,"current":current,
                     "basis":TURNED if mode==2 and tick>=4 else IDENTITY,"viewPosition":[0,1000,0]}
                active[0]=True
                try:output=k.frame_quad(inp)
                except Exception as error:raise ValueError(f"{ref['effectId']}:{ref['emitterIndex']} mode {mode} time {time}: {error}") from error
                finally:active[0]=False
                records.append({"input":inp,"output":output,"libraryInputs":list(k.library_inputs)})
                frames+=1;births+=len(output["state"]["births"])
                vertices+=len(output["geometry"]["verticesHex"])//56;indices+=len(output["geometry"]["indicesHex"])//4
                previous=current
            if mode==0:
                had_birth=any(f["output"]["state"]["births"] for f in records)
                live_graphs+=had_birth
                if had_birth and actor not in variants:
                    variants.add(actor);modes.extend([(1,987654321),(2,0xffffffffffffffff)])
            cases.append({"graphSha256":ref["sha256"],"mode":mode,"seedHex":f"{seed:016x}","quality":0,"frames":records})
        if (len(cases)-2*len(variants))%50==0:
            print(json.dumps({"graphs":len(cases)-2*len(variants),"frames":frames,"births":births}),flush=True)
    unexpected=[w for w in writes if not 0x2516698<=w[0]<=0x25166a0-w[1]]
    if unexpected:raise ValueError(f"Unadmitted loaded quad global writes {unexpected[:5]}")
    result={"schema":1,"build":meta["build"],"protocol":meta["protocol"],"definitionSha256":k.profile["vfxLoadedQuadsSha256"],
        "decoderImageSha256":k.profile["decoderImageSha256"],"compilerSources":meta["compilerSources"],
        "observerSha256":sha(Path(__file__).read_bytes()),"originalBlocks":list(k.blocks.values()),
        "executableGlobalWrites":sorted(set(writes)),"cases":cases,
        "summary":{"graphs":len(meta["templates"]),"liveGraphs":live_graphs,"variantActors":len(variants),"cases":len(cases),
                   "frames":frames,"births":births,"vertices":vertices,"indices":indices},"scope":meta["scope"]}
    args.output.write_text(json.dumps(result,separators=(",",":"),allow_nan=False),encoding="utf-8")
    print(json.dumps({**result["summary"],"originalBlocks":len(k.blocks)}))


if __name__=="__main__":main()
