"""Extract selected top-level semantic sections with bounded streaming memory."""
import argparse
import hashlib
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("sections", nargs="+")
args = parser.parse_args()
selected = set(args.sections)
if len(selected) != len(args.sections): raise ValueError("Duplicate requested semantic section")
digest, entries, ranges, stack = hashlib.sha256(), {}, {}, []
offset, in_string, escape_at, key_at, key, value_at = 0, False, None, None, None, None
with args.source.open("rb") as stream, args.source.open("rb") as random_access:
    if stream.peek(1)[:1] != b"{": raise ValueError("Original semantic object required")
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
        for match in re.finditer(rb'["\\{}\[\],:]', chunk):
            at, token = offset + match.start(), match.group()
            if escape_at is not None:
                escaped = at == escape_at + 1
                escape_at = None
                if escaped: continue
            if in_string:
                if token == b"\\": escape_at = at
                elif token == b'"':
                    in_string = False
                    if key_at is not None:
                        random_access.seek(key_at)
                        key = json.loads(random_access.read(at + 1 - key_at))
                        key_at = None
                continue
            if token == b'"':
                in_string = True
                if len(stack) == 1 and value_at is None: key_at = at
            elif token in [b"{", b"["]: stack.append(token)
            elif token == b":" and len(stack) == 1:
                if key is None or value_at is not None: raise ValueError("Malformed original top-level key")
                value_at = at + 1
            elif token == b"," and len(stack) == 1:
                if key is None or value_at is None: raise ValueError("Malformed original top-level value")
                if key in selected:
                    if key in ranges: raise ValueError("Repeated selected semantic key")
                    ranges[key] = (value_at, at)
                key, value_at = None, None
            elif token in [b"}", b"]"]:
                if not stack or stack[-1] != (b"{" if token == b"}" else b"["): raise ValueError("Unbalanced original semantic trace")
                if len(stack) == 1 and key is not None:
                    if key in selected:
                        if key in ranges: raise ValueError("Repeated selected semantic key")
                        ranges[key] = (value_at, at)
                    key, value_at = None, None
                stack.pop()
        offset += len(chunk)
    if stack or in_string: raise ValueError("Truncated original semantic trace")
    for key, (start, end) in ranges.items():
        random_access.seek(start)
        entries[key] = json.loads(random_access.read(end - start))
if set(entries) != selected: raise ValueError("Requested semantic sections absent from original trace")
report = {"schema": 1, "sourceSha256": digest.hexdigest(), "sourceBytes": args.source.stat().st_size,
    "extractorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "sections": entries}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "sourceSha256": report["sourceSha256"], "sections": {key: len(value) if isinstance(value, (list, dict)) else value for key, value in entries.items()}}))
