"""Observe original point-quad birth, update/removal and vertex output."""
import argparse
import json
from pathlib import Path

import unicorn
from vfx_point_quad_native import NativePointQuad
from vfx_spawn_native import sha

IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
TURNED=[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client","output"]:parser.add_argument(name,type=Path)
    args=parser.parse_args();k=NativePointQuad(args.package,args.client)
    meta=k.checked_json("vfx-point-quads.json","vfxPointQuadsSha256")
    writes=[];active=[False]
    def write(uc,kind,at,count,value,user):
        if active[0]:writes.append((at-k.base,count))
    k.u.hook_add(unicorn.UC_HOOK_MEM_WRITE,write,begin=k.base,end=k.base+len(k.image)-1)
    cases=[];frames=births=vertices=indices=0
    times=[0,0,1/60,.05,.1,.2,.3,.5,.7,1,1.2,2]
    for ref in meta["templates"]:
        raw=(args.package/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Point graph changed")
        graph=json.loads(raw)
        for mode,seed in [(0,0),(1,987654321),(2,0xffffffffffffffff)]:
            k.reset_quad(graph,seed,0);records=[];previous=[0,0,0]
            for tick,time in enumerate(times):
                current=[12000+time*130,250+time*3,8500+time*70] if mode==1 else [0,0,0]
                inp={"time":time,"previous":previous,"current":current,
                     "basis":TURNED if mode==2 and tick>=4 else IDENTITY,"viewPosition":[0,1000,0]}
                active[0]=True
                try:output=k.frame_quad(inp)
                finally:active[0]=False
                records.append({"input":inp,"output":output})
                frames+=1;births+=len(output["state"]["births"])
                vertices+=len(output["geometry"]["verticesHex"])//56;indices+=len(output["geometry"]["indicesHex"])//4
                previous=current
            cases.append({"graphSha256":ref["sha256"],"mode":mode,"seedHex":f"{seed:016x}","frames":records})
        print(json.dumps({"effectId":ref["effectId"],"emitterIndex":ref["emitterIndex"],"framesSoFar":frames}),flush=True)
    unexpected=[w for w in writes if not 0x2516698<=w[0]<=0x25166a0-w[1]]
    if unexpected:raise ValueError(f"Unadmitted point global writes {unexpected[:5]}")
    result={"schema":1,"build":meta["build"],"protocol":meta["protocol"],"definitionSha256":k.profile["vfxPointQuadsSha256"],
            "decoderImageSha256":k.profile["decoderImageSha256"],"compilerSources":meta["compilerSources"],
            "observerSha256":sha(Path(__file__).read_bytes()),"originalBlocks":list(k.blocks.values()),
            "executableGlobalWrites":sorted(set(writes)),"cases":cases,
            "summary":{"graphs":len(meta["templates"]),"cases":len(cases),"frames":frames,"births":births,"vertices":vertices,"indices":indices},"scope":meta["scope"]}
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False),encoding="utf-8")
    print(json.dumps({**result["summary"],"originalBlocks":len(k.blocks)}))


if __name__=="__main__":main()
