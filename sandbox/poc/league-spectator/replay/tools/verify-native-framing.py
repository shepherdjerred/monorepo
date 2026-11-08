"""Compare JS framing with the pinned game's original x64 header reader.

Only the pure framing prefix runs. It stops before packet construction and
payload copying, while retaining native timestamp/opcode/context state.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import unicorn
from unicorn.x86_const import *

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("package", type=Path)
parser.add_argument("samples", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
profile = json.loads((args.package / "profile.json").read_text())
image = (args.package / "image.bin").read_bytes()
samples = json.loads(args.samples.read_text())
if (profile["sliceSha256"] != "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" or
        hashlib.sha256(image).hexdigest() != profile["decoderImageSha256"] or
        samples["build"] != profile["clientVersion"] or samples["protocol"] != profile["protocolDigest"]):
    raise ValueError("Native framing package mismatch")
base = profile["imageBase"]
matched = 0
for chunk in samples["chunks"]:
    # Chunks have independent framing state. Bound each native engine's lifetime
    # as well; the Windows Unicorn build crashed after >1M prefix invocations.
    engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
    engine.mem_map(base, len(image))
    engine.mem_write(base, image)
    engine.mem_map(0x10000000, 0x10000)
    initial = engine.context_save()
    engine.mem_write(0x10000200, bytes(128))
    for index, block in enumerate(chunk["blocks"]):
        header = bytes.fromhex(block["headerHex"])
        if not 1 <= len(header) <= 16:
            raise ValueError("Unexpected framing header size")
        engine.context_restore(initial)
        engine.mem_write(0x10002000, header)
        engine.mem_write(0x10000100, struct.pack("<QI", 0x10002000, len(header)))
        engine.mem_write(0x10000120, bytes(4))
        engine.reg_write(UC_X86_REG_RDI, 0x10000100)
        engine.reg_write(UC_X86_REG_RSI, 0x10000120)
        engine.reg_write(UC_X86_REG_RDX, 0x10000200)
        engine.reg_write(UC_X86_REG_RCX, 0x10000240)
        engine.reg_write(UC_X86_REG_R8, 0x10000250)
        engine.reg_write(UC_X86_REG_RSP, 0x1000f000)
        engine.emu_start(base + 0x776420, base + 0x776594, count=1000)
        if engine.reg_read(UC_X86_REG_RIP) != base + 0x776594:
            raise ValueError("Native framing instruction limit")
        actual = {"time": struct.unpack("<f", engine.mem_read(0x10000200, 4))[0],
                  "opcode": struct.unpack("<H", engine.mem_read(0x10000240, 2))[0],
                  "param": struct.unpack("<I", engine.mem_read(0x10000250, 4))[0],
                  "length": engine.reg_read(UC_X86_REG_R13D)}
        consumed = struct.unpack("<I", engine.mem_read(0x10000120, 4))[0]
        expected = {key: block[key] for key in actual}
        if actual != expected or consumed != len(header):
            raise ValueError(f"Native framing disagreement: chunk {chunk['chunkId']} block {index}: {actual} != {expected}")
        matched += 1
    print(json.dumps({"chunkId": chunk["chunkId"], "stream": chunk["stream"], "matched": matched}), flush=True)
    del initial, engine
output = {"schema":1, "build":samples["build"], "protocol":samples["protocol"],
          "replaySha256":samples["replaySha256"], "endTime":samples["endTime"],
          "sliceSha256":profile["sliceSha256"], "decoderImageSha256":profile["decoderImageSha256"],
          "entryRva":0x776420, "endRva":0x776594,
          "scope":"Packet headers only; body meanings, reconstruction and A/V fidelity are separate",
          "matched":matched, "mismatches":0, "chunks":len(samples["chunks"])}
args.output.write_text(json.dumps(output, indent=2))
print(json.dumps(output))
