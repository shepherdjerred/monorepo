"""Compile point-shape quad projections without substituting their authored shape."""
import argparse
import json
from pathlib import Path

from vfx_point_quad_native import NativePointQuad
from vfx_legacy_quad_native import QuadProjectionError
from vfx_spawn_native import sha
from vfx_emitter_native import GEOMETRY


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client","effects"]:
        parser.add_argument(name,type=Path)
    args=parser.parse_args()
    k=NativePointQuad(args.package,args.client)
    manifest_raw=(args.effects/"manifest.json").read_bytes()
    manifest=json.loads(manifest_raw)
    if manifest["build"]!=k.profile["clientVersion"] or manifest["protocol"]!=k.profile["protocolDigest"]:
        raise ValueError("Point-quad asset build mismatch")
    output=args.package/"vfx-point-quad-graphs"
    output.mkdir(exist_ok=True)
    templates,rejected=[],[]
    for effect_id,ref in sorted(manifest["definitions"].items()):
        raw=(args.effects/ref["file"]).read_bytes()
        if sha(raw)!=ref["sha256"]:raise ValueError("Point-quad definition changed")
        for index,emitter in enumerate(json.loads(raw)["definition"].get("complexEmitterDefinitionData",[])):
            try:graph=k.prepare_point_quad(emitter)
            except QuadProjectionError as error:
                rejected.append({"effectId":effect_id,"emitterIndex":index,"reason":str(error)})
                continue
            graph.update({"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],
                          "effectId":effect_id,"emitterIndex":index,"sourceDefinitionSha256":sha(raw)})
            data=json.dumps(graph,separators=(",",":"),allow_nan=False).encode();digest=sha(data)
            (output/f"{digest}.json").write_bytes(data)
            templates.append({"effectId":effect_id,"emitterIndex":index,"name":emitter.get("emitterName"),
                              "sourceDefinitionSha256":sha(raw),"sha256":digest,"file":f"vfx-point-quad-graphs/{digest}.json","bytes":len(data)})
    if not templates:raise ValueError("No admitted point quads")
    spawn=k.checked_json("vfx-spawn.json","vfxSpawnSha256")
    meta={"schema":1,"build":k.profile["clientVersion"],"protocol":k.profile["protocolDigest"],
          "sliceSha256":k.profile["sliceSha256"],"decoderImageSha256":k.profile["decoderImageSha256"],
          "runtimeSha256":spawn["runtimeSha256"],"vfxSpawnSha256":k.profile["vfxSpawnSha256"],
          "vfxEmitterSha256":k.profile["vfxEmitterSha256"],"vfxQuadVerticesSha256":k.profile["vfxQuadVerticesSha256"],
          "effectsManifestSha256":sha(manifest_raw),"fieldLayout":k.layout,
          "frameRva":0x1757f10,"writerRva":0x1730410,"shapeConstructorBlock":[0x179556e,0x179558c],
          "primitiveConstructorRva":0x17a6390,"geometryAddresses":GEOMETRY,"maximumParticles":1024,
          "checkpointLayout":{"ownedAddress":0x10020000,"ownedBytes":0x10000,"heapAddress":0x10400000,"heapLimit":0x12000000,"globals":[{"rva":0x2516698,"bytes":8}]},
          "uvScratchAddress":0x1002f000,"initializedGlobals":k.trails["initializedGlobals"],"templates":templates,
          "coverage":{"admitted":len(templates),"rejected":len(rejected)},"rejected":rejected,
          "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in
            ["prepare-vfx-point-quads.py","vfx_point_quad_native.py","vfx_legacy_quad_native.py","vfx_spawn_native.py","vfx_emitter_native.py","vfx_uv_native.py"]},
          "executedOriginalPreparationBlocks":list(k.blocks.values()),
          "scope":"Original point-shape quad geometry/lifecycle projection. Supplied clock/seed/basis/quality/scales; UV/materials separate. Full effect factory, native attachment transform updates, original scheduling, shaders, GPU and A/V unverified."}
    raw=json.dumps(meta,indent=2).encode();(args.package/"vfx-point-quads.json").write_bytes(raw)
    k.profile["vfxPointQuadsSha256"]=sha(raw)
    (args.package/"profile.json").write_text(json.dumps(k.profile,indent=2),encoding="utf-8")
    print(json.dumps({"sha256":sha(raw),"coverage":meta["coverage"],"templates":[[t["effectId"],t["emitterIndex"]] for t in templates]}))


if __name__=="__main__":main()
