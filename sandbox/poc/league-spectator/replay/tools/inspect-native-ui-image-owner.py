"""Inspect exact original RIP references needed to own native UI image views.

This is source discovery only. A reference or constructor constant is not a live
texture binding, controller state or rendered HUD.
"""
import argparse
import bisect
import hashlib
import json
import struct
from pathlib import Path

import capstone
from capstone.x86_const import X86_OP_MEM, X86_REG_RIP


def inspect(image, target=0x24712C8, extra_sites=(0x17E396F, 0x18A2400, 0x19175E0), function_starts=None):
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoder.detail = True
    references = {}
    # Candidate signed displacement ends are checked by the real decoder;
    # apparent byte matches inside other instructions are not admitted.
    for end in range(0x9004, 0x1FEF000):
        if end + struct.unpack_from("<i", image, end - 4)[0] != target:
            continue
        for start in range(max(0x9000, end - 12), end - 4):
            instructions = list(decoder.disasm(image[start:end], start))
            if len(instructions) != 1:
                continue
            instruction = instructions[0]
            if instruction.address + instruction.size != end:
                continue
            if not any(
                operand.type == X86_OP_MEM
                and operand.mem.base == X86_REG_RIP
                and instruction.address + instruction.size + operand.mem.disp == target
                for operand in instruction.operands
            ):
                continue
            references[start] = {
                "rva": start,
                "bytes": instruction.bytes.hex(),
                "op": instruction.mnemonic,
                "args": instruction.op_str,
            }
    regions = {}
    for site in [*references, *extra_sites]:
        if function_starts is not None:
            index = bisect.bisect_right(function_starts, site) - 1
            if index < 0 or index >= len(function_starts) - 1:
                raise ValueError("Original reference lies outside LC_FUNCTION_STARTS")
            start, end = function_starts[index:index + 2]
            if not 0 <= start <= site < end <= len(image):
                raise ValueError("Original function metadata exceeds the image")
        else:
            start = image.rfind(b"\x55\x48\x89\xe5", max(0x9000, site - 8192), site + 4)
            if start < 0:
                raise ValueError("Original UI image consumer lacks a bounded function prefix")
            end = image.find(b"\x55\x48\x89\xe5", max(start + 4, site + 1), site + 8192)
            if end < 0:
                raise ValueError("Original UI image consumer lacks a bounded next prefix")
        if start in regions:
            continue
        regions[start] = {
            "start": start,
            "end": end,
            "sha256": hashlib.sha256(image[start:end]).hexdigest(),
            "instructions": [
                {"rva": op.address, "bytes": op.bytes.hex(), "op": op.mnemonic, "args": op.op_str}
                for op in decoder.disasm(image[start:end], start)
            ],
        }
    # A REX-prefixed memory instruction also decodes as a different instruction
    # if started one byte late. Admit only canonical boundaries from the complete
    # original function decode, not those overlapping suffix candidates.
    canonical = {
        instruction["rva"]: instruction
        for region in regions.values()
        for instruction in region["instructions"]
    }
    return {
        "globalRva": target,
        "candidateInstructionStarts": len(references),
        "references": [canonical[at] for at in references if at in canonical],
        "functions": list(regions.values()),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    image = (args.assets / "decoder-16.21-macos/image.bin").read_bytes()
    digest = hashlib.sha256(image).hexdigest()
    if digest != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
        raise ValueError("Exact original UI image is required")
    result = {
        "schema": 1,
        "kind": "original-ui-image-owner-source-discovery",
        "imageSha256": digest,
        "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        **inspect(image),
        "scope": "Decoded original global-owner references and constructor/provider bytes only; live owner initialization and composed UV execution remain separate",
    }
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "references": result["references"], "functions": len(result["functions"])}))
