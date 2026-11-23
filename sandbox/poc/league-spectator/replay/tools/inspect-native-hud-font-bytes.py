"""Inspect exact archived SFNT font directories without installing fonts."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
source_bytes = (args.directory / "links.json").read_bytes()
receipt = json.loads(source_bytes)
fonts = []
for result in receipt["results"]:
    for location in result["locations"]:
        data = (args.directory / location["filename"]).read_bytes()
        if len(data) != location["bytes"] or hashlib.sha256(data).hexdigest() != location["sha256"]:
            raise ValueError("Archived font bytes differ from original WAD receipt")
        if data[:4] not in [b"OTTO", b"\x00\x01\x00\x00"]: raise ValueError("Unsupported archived font signature")
        count = struct.unpack_from(">H", data, 4)[0]
        tables = {}
        for index in range(count):
            tag, checksum, offset, length = struct.unpack_from(">4sIII", data, 12 + index * 16)
            if offset + length > len(data): raise ValueError("Font table exceeds original bytes")
            name = tag.decode("ascii")
            if name in tables: raise ValueError("Duplicate archived font table")
            tables[name] = {"offset": offset, "length": length, "checksum": checksum}
        names = []
        table = tables["name"]
        name_data = data[table["offset"]:table["offset"] + table["length"]]
        format_id, records, strings = struct.unpack_from(">HHH", name_data)
        if format_id not in [0, 1]: raise ValueError("Unsupported original font name format")
        for index in range(records):
            platform, encoding, language, name_id, length, offset = struct.unpack_from(">6H", name_data, 6 + index * 12)
            if name_id not in [1, 2, 4, 6, 16, 17]: continue
            if strings + offset + length > len(name_data): raise ValueError("Font name exceeds original table")
            encoded = name_data[strings + offset:strings + offset + length]
            codec = "utf-16-be" if platform in [0, 3] else "mac_roman" if platform == 1 and encoding == 0 else None
            names.append({"platform": platform, "encoding": encoding, "language": language, "nameId": name_id,
                "value": encoded.decode(codec) if codec else None, "originalBytesHex": encoded.hex()})
        head = tables["head"]["offset"]
        maxp = tables["maxp"]["offset"]
        fonts.append({"hashHex": result["hashHex"], "originalLocation": location, "signatureHex": data[:4].hex(),
            "unitsPerEm": struct.unpack_from(">H", data, head + 18)[0], "glyphs": struct.unpack_from(">H", data, maxp + 4)[0],
            "tables": tables, "names": names})
report = {"schema": 1, "kind": "archived-native-hud-font-byte-directory", "build": receipt["build"], "protocol": receipt["protocol"],
    "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "receiptSha256": hashlib.sha256(source_bytes).hexdigest(),
    "fonts": fonts, "scope": "Original WAD byte hashes and SFNT directories/names only; locale selection, glyph layout, native text defaults and final HUD rendering are separate"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"output": str(args.output), "fonts": [{"hashHex": item["hashHex"], "glyphs": item["glyphs"],
    "family": sorted(set(name["value"] for name in item["names"] if name["nameId"] == 1 and name["value"] is not None))} for item in fonts]}))
