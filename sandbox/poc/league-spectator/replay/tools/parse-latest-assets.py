"""Parse installed BIN assets with pinned CDTB; preserve complete definitions.

No replay is read and no network access is used. Unknown property/type hashes
remain explicit. Field-name dictionaries are checked against their native hash.
"""
import argparse
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path

REVISION = "3367589fdd3ee3d0d01383d2f98dba12b04d1371"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def names(path):
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        encoded, name = line.split(" ", 1)
        value = 2166136261
        for byte in name.lower().encode("utf-8"):
            value = ((value ^ byte) * 16777619) & 0xffffffff
        if value != int(encoded, 16):
            raise ValueError(f"Invalid name dictionary hash {encoded}/{name}")
        if value in result and result[value] != name:
            raise ValueError(f"Ambiguous dictionary name {encoded}")
        result[value] = name
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", type=Path)
    parser.add_argument("hashes", type=Path)
    parser.add_argument("summary", type=Path)
    args = parser.parse_args()
    jobs = json.loads(args.jobs.read_text())
    if jobs["schema"] != 1 or jobs["build"] != "16.21.829.8620":
        raise ValueError("Unsupported BIN preparation request")
    source = json.loads(importlib.metadata.distribution("cdtb").read_text("direct_url.json"))
    if source["vcs_info"]["commit_id"] != REVISION:
        raise ValueError("CDTB source revision mismatch")
    dictionaries = {}
    for name in ["binfields", "bintypes"]:
        path = args.hashes / f"hashes.{name}.txt"
        dictionaries[name] = {"values": names(path), "sha256": digest(path.read_bytes())}
    os.environ["CDTB_HASHES_DIR"] = str(args.hashes.resolve())
    import cdtb.binfile as binfile
    binfile.hashfile_binfields.hashes = dictionaries["binfields"]["values"]
    binfile.hashfile_bintypes.hashes = dictionaries["bintypes"]["values"]
    for dictionary in [binfile.hashfile_binentries, binfile.hashfile_binhashes,
                       binfile.hashfile_binhashes_xxh3, binfile.hashfile_binpaths]:
        dictionary.hashes = {}
    results = []
    for job in jobs["jobs"]:
        data = Path(job["source"]).read_bytes()
        if digest(data) != job["sha256"]:
            raise ValueError(f"Extracted BIN changed {job['path']}")
        stream = io.BytesIO(data)
        parsed = binfile.BinFile(stream)
        if stream.tell() != len(data):
            raise ValueError(f"Unconsumed BIN bytes {job['path']}")
        if parsed.is_patch:
            raise ValueError(f"BIN override merging is not implemented {job['path']}")
        output = json.dumps(parsed.to_serializable(), allow_nan=False).encode("utf-8")
        Path(job["output"]).write_bytes(output)
        results.append({"path": job["path"], "sourceSha256": job["sha256"],
                        "jsonSha256": digest(output), "version": parsed.version,
                        "objects": len(parsed.entries), "dependencies": parsed.linked_files})
    result = {"schema": 1, "build": jobs["build"], "cdtbRevision": REVISION,
              "dictionaries": {k: {"sha256": v["sha256"], "entries": len(v["values"])}
                               for k, v in dictionaries.items()}, "results": results}
    args.summary.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"parsed": len(results), "objects": sum(r["objects"] for r in results)}))


if __name__ == "__main__":
    main()
