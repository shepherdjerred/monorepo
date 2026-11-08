"""Load complete serialized emitter fields through the original property reader."""
import argparse
from collections import Counter
import importlib.metadata
import io
import json
from pathlib import Path
import runpy

from vfx_asset_native import NativeVfxAssets, UnsupportedAssetClass
from vfx_spawn_native import sha


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["package","client","effects","work","hashes","evidence"]:parser.add_argument(name,type=Path)
    args=parser.parse_args()
    manifest_raw=(args.effects/"manifest.json").read_bytes();manifest=json.loads(manifest_raw)
    package_raw=(args.effects/"package.json").read_bytes();package=json.loads(package_raw)
    installed=json.loads(importlib.metadata.distribution("cdtb").read_text("direct_url.json"))
    if installed["vcs_info"]["commit_id"]!="3367589fdd3ee3d0d01383d2f98dba12b04d1371":
        raise ValueError("Unprepared typed BIN reader")
    import cdtb.binfile as binfile
    names=runpy.run_path(str(Path(__file__).with_name("parse-latest-assets.py")))["names"]
    for dictionary,name in [(binfile.hashfile_binfields,"binfields"),(binfile.hashfile_bintypes,"bintypes")]:
        path=args.hashes/f"hashes.{name}.txt"
        if sha(path.read_bytes())!=manifest["toolchain"]["dictionaries"][name]:raise ValueError("Changed typed BIN dictionary")
        dictionary.hashes=names(path)
    for dictionary in [binfile.hashfile_binentries,binfile.hashfile_binhashes,binfile.hashfile_binhashes_xxh3,binfile.hashfile_binpaths]:dictionary.hashes={}
    class Reader(binfile.BinReader):
        def __init__(self,*a):super().__init__(*a);self.spans={}
        def read_field(self,htype):
            start=self.f.tell();field=super().read_field(htype);self.spans[id(field)]=(start,self.f.tell());return field
    kernel=NativeVfxAssets(args.package,args.client)
    if manifest["build"]!=kernel.profile["clientVersion"] or manifest["protocol"]!=kernel.profile["protocolDigest"]:
        raise ValueError("Native VFX asset build mismatch")
    output=args.package/"vfx-asset-graphs";output.mkdir(exist_ok=True)
    parsed={};raw_sources={};emitters={};observations=[];failures=[];counts=Counter();repeated=0
    parser_id=manifest["toolchain"]["parserIdentity"][:16]
    def source(actor,path):
        prov=next(p for p in package["actors"][actor]["sourceBins"] if p["path"]==path)
        digest=prov["sourceSha256"]
        if digest not in parsed:
            raw=(args.work/"bins"/f"{digest}-{parser_id}.bin").read_bytes()
            if sha(raw)!=digest:raise ValueError("Serialized VFX source changed")
            stream=io.BytesIO(raw)
            if stream.read(4)!=b"PROP":raise ValueError("Native field preparation requires an unpatched PROP source")
            reader=Reader(stream);version,linked,types=reader.read_binfile_header()
            entries={e.path.h:e for e in [reader.read_binfile_entry(t) for t in types]}
            if stream.tell()!=len(raw):raise ValueError("Typed VFX source left trailing bytes")
            parsed[digest]=(raw,reader,entries)
        raw_sources[path]=digest
        return parsed[digest]
    for effect_id,ref in sorted(manifest["definitions"].items()):
        definition_raw=(args.effects/ref["file"]).read_bytes()
        if sha(definition_raw)!=ref["sha256"]:raise ValueError("Prepared VFX definition changed")
        definition=json.loads(definition_raw);actor=definition["actor"]
        candidates=[]
        for path in definition["sourceBins"]:
            raw,reader,entries=source(actor,path)
            entry=entries.get(int(definition["id"],16))
            if entry is None:raise ValueError("VFX source omits prepared entry")
            if json.loads(json.dumps(entry.to_serializable(),allow_nan=False))!=definition["definition"]:
                raise ValueError("Typed raw VFX entry differs from prepared JSON")
            candidates.append((path,raw,reader,entry))
        path,raw,reader,entry=candidates[0]
        field=entry.get("complexEmitterDefinitionData")
        if field is None:
            if ref["complexEmitters"]:raise ValueError("Missing serialized emitter list")
            continue
        if len(field.value.values)!=ref["complexEmitters"]:raise ValueError("Serialized emitter count mismatch")
        for index,emitter in enumerate(field.value.values):
            key=f"{effect_id}:{index}"
            if emitter.type.h!=0x09cde442:raise ValueError("Unexpected serialized emitter class")
            blobs=[raw[a:z] for a,z in [reader.spans[id(f)] for f in emitter.fields]]
            spans=[{"hash":f.name.h,"type":int(f.type),"offset":reader.spans[id(f)][0],
                    "bytes":len(blob),"sha256":sha(blob)} for f,blob in zip(emitter.fields,blobs)]
            try:
                result=kernel.load(blobs)
            except UnsupportedAssetClass as error:
                failures.append({"effectId":effect_id,"emitterIndex":index,"reason":str(error)})
                counts["unsupportedClassEmitters"]+=1
                continue
            except Exception as error:
                raise ValueError(f"{key}: {error}") from error
            counts["emitters"]+=1;counts["fields"]+=len(blobs);counts["streamCalls"]+=result["streamCalls"]
            counts["nativeIgnoredFields"]+=len(result["ignored"]);counts["nativeTypeMismatches"]+=len(result["mismatched"])
            data=json.dumps({"schema":1,"build":kernel.profile["clientVersion"],"protocol":kernel.profile["protocolDigest"],
                "phase":"serialized-fields-before-postload",**result},separators=(",",":"),allow_nan=False).encode()
            digest=sha(data);(output/f"{digest}.json").write_bytes(data)
            status="loaded-fields" if not result["ignored"] and not result["mismatched"] else "loaded-with-explicit-native-skips"
            emitters[key]={"effectId":effect_id,"emitterIndex":index,"status":status,"sha256":digest,"file":f"vfx-asset-graphs/{digest}.json",
                "bytes":len(data),"definitionSha256":ref["sha256"],"rawSource":path,"rawSourceSha256":sha(raw),"fields":spans,
                "heapBytes":len(result["heapHex"])//2,"nativeIgnoredFields":result["ignored"],"nativeTypeMismatches":result["mismatched"]}
            if index==0:
                again=kernel.load(blobs)
                if again!=result:raise ValueError("Native asset field loading is not deterministic after reset")
                repeated+=1
            observations.append({"key":key,"graphSha256":digest,"objectSha256":sha(bytes.fromhex(result["objectHex"])),
                                 "heapSha256":sha(bytes.fromhex(result["heapHex"]))})
        if counts["emitters"]%200<ref["complexEmitters"]:
            print(json.dumps({"effect":effect_id,"loaded":counts["emitters"],"fields":counts["fields"],"unsupported":len(failures)}),flush=True)
    sources=["prepare-vfx-assets.py","vfx_asset_native.py","animation_rig_native.py","vfx_spawn_native.py","parse-latest-assets.py"]
    metadata={"schema":1,"build":kernel.profile["clientVersion"],"protocol":kernel.profile["protocolDigest"],
        "sliceSha256":kernel.profile["sliceSha256"],"decoderImageSha256":kernel.profile["decoderImageSha256"],
        "effectsManifestSha256":sha(manifest_raw),"sourcePackageSha256":sha(package_raw),
        "registrationRva":0x17ac9a0,"fieldReaderRva":0x14bc830,"dispatchRva":0x14b57a0,"emitterClass":0x09cde442,
        "types":kernel.type_catalog,"emitters":emitters,"rawSources":raw_sources,"failures":failures,
        "summary":dict(counts),"repeatedLoads":repeated,
        "libraryBoundaries":{"cstringLimit":4096,"mutex":"Owned single-thread init/lock/unlock state; no contention, attributes or thread execution",
            "stackProbe":{"symbol":"____chkstk_darwin","callerRva":0x1499b00,"bytes":0x1028,"contract":"Check mapped owned stack pages and preserve caller registers; this one call site only"},
            "stream":"Owned bounded read, tell and absolute seek; original property parsing is unchanged"},
        "compilerSources":{name:sha(Path(__file__).with_name(name).read_bytes()) for name in sources},
        "scope":"Full original VFX type registration and complete serialized field loading for prepared complex emitters, with explicit native property skips and unsupported classes. Typed raw BIN field slices retain every serialized field. This is the pre-postload object state, not an admitted rendering package. Curve baking, resource/link fixups, materials, runtime construction, all primitives/shapes, GPU, replay binding and A/V fidelity remain unverified."}
    raw=json.dumps(metadata,indent=2).encode();(args.package/"vfx-assets.json").write_bytes(raw)
    kernel.profile["vfxAssetsSha256"]=sha(raw)
    (args.package/"profile.json").write_text(json.dumps(kernel.profile,indent=2),encoding="utf-8")
    evidence={"schema":1,"build":metadata["build"],"protocol":metadata["protocol"],"definitionSha256":sha(raw),"compilerSources":metadata["compilerSources"],
        "originalBlocks":list(kernel.blocks.values()),"libraryCalls":dict(Counter(c["name"] for c in kernel.library_calls)),"observations":observations,
        "summary":dict(counts),"repeatedLoads":repeated,"scope":metadata["scope"]}
    args.evidence.write_text(json.dumps(evidence,indent=2),encoding="utf-8")
    print(json.dumps({"types":len(kernel.types),**dict(counts),"repeatedLoads":repeated,"originalBlocks":len(kernel.blocks),"sha256":sha(raw)}))


if __name__=="__main__":main()
