"""Decode opcode 669 requests with the archived exact-build reader."""

import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import unicorn as u
from unicorn import x86_const as r

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from macho import MachImage

if len(sys.argv) != 3 or not __debug__:
    raise ValueError(
        "Usage: recorded-animation-packet-oracle.py <archived executable> <cue directory>, assertions enabled"
    )
directory = Path(sys.argv[2])
batch = directory / "packet-requests.json"
binary = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(binary).hexdigest() == "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
image = MachImage(binary)
vm = u.Uc(u.UC_ARCH_X86, u.UC_MODE_64)
vm.mem_map(image.base, len(image.image))
vm.mem_write(image.base, bytes(image.image))
stop, obj, cursor, body, stack = (0x10000000 + off for off in (0, 0x100, 0x200, 0x300, 0x1F08))
vm.mem_map(stop, 0x2000)


def put(addr, fmt, value):
    vm.mem_write(addr, struct.pack("<" + fmt, value))


def get(addr, fmt):
    return struct.unpack("<" + fmt, vm.mem_read(addr, struct.calcsize("<" + fmt)))[0]


def ret(result):
    pointer = vm.reg_read(r.UC_X86_REG_RSP)
    vm.reg_write(r.UC_X86_REG_RAX, result)
    vm.reg_write(r.UC_X86_REG_RIP, get(pointer, "Q"))
    vm.reg_write(r.UC_X86_REG_RSP, pointer + 8)


def supply_archived_context(engine, *_):
    # The saved replay envelope reader already consumed the native header.
    assert engine.reg_read(r.UC_X86_REG_RDI) == obj
    put(obj + 12, "I", context)
    ret(1)


def admit_string_preparation(engine, *_):
    ptr, size = (engine.reg_read(reg) for reg in (r.UC_X86_REG_RDI, r.UC_X86_REG_RSI))
    assert ptr == obj + 0x20 and 0 <= size < 256


def fail_import(engine, addr, *_):
    raise ValueError((hex(addr - image.base), image.imports[addr - image.base]))


def allocate_string(engine, *_):
    # This request has a single bounded string allocation in the local arena.
    size = engine.reg_read(r.UC_X86_REG_RDI)
    assert 0 < size < 256
    ret(stop + 0x400)


vm.hook_add(u.UC_HOOK_CODE, supply_archived_context, begin=image.base + 0x1637CB0, end=image.base + 0x1637CB0)
vm.hook_add(u.UC_HOOK_CODE, admit_string_preparation, begin=image.base + 0x14ED650, end=image.base + 0x14ED650)
vm.hook_add(u.UC_HOOK_CODE, allocate_string, begin=image.base + 0x14A2030, end=image.base + 0x14A2030)
for address in image.imports:
    vm.hook_add(u.UC_HOOK_CODE, fail_import, begin=image.base + address, end=image.base + address)


def prefix(start, end, registers):
    for register, value in registers:
        vm.reg_write(register, value)
    vm.emu_start(image.base + start, image.base + end, count=1000)
    assert vm.reg_read(r.UC_X86_REG_RIP) == image.base + end


class UnsupportedRequest(ValueError):
    """The request uses a callback path outside the reviewed pose scope."""


initial = vm.context_save()


def decode_packet(context_id: int, payload: bytes) -> dict:
    global context
    context = context_id
    if not 0 < len(payload) < 256:
        raise UnsupportedRequest("packet body is outside the reviewed size bound")
    vm.context_restore(initial)
    vm.mem_write(stop, bytes(0x2000))
    vm.mem_write(body, payload)
    put(cursor, "Q", body)
    put(obj + 8, "I", 669)
    for register, value in (
        (r.UC_X86_REG_RDI, obj),
        (r.UC_X86_REG_RSI, cursor),
        (r.UC_X86_REG_RDX, body + len(payload)),
        (r.UC_X86_REG_RSP, stack),
    ):
        vm.reg_write(register, value)
    put(stack, "Q", stop)
    vm.emu_start(image.base + 0x1032910, stop, count=10000)
    if vm.reg_read(r.UC_X86_REG_RIP) != stop or vm.reg_read(r.UC_X86_REG_AL) != 1:
        raise UnsupportedRequest("native reader did not accept the packet body")
    if get(cursor, "Q") != body + len(payload):
        raise UnsupportedRequest("native reader did not consume the complete packet body")
    assert get(obj + 12, "I") == context
    name = bytes(vm.mem_read(get(obj + 0x20, "Q"), get(obj + 0x28, "I"))).decode("ascii")
    fields = {
        hex(off): int.from_bytes(vm.mem_read(obj + off, width), "little")
        for off, width in [(0x10, 4), (0x14, 1), (0x15, 1), (0x18, 4), (0x1C, 1), (0x30, 1), (0x34, 4), (0x38, 4)]
    }
    receipt = {
        "readerRva": "0x1032910",
        "payload": payload.hex(),
        "wireBytesConsumed": len(payload),
        "context": context,
        "name": name,
        "fields": fields,
    }
    frame = stack - 0x80
    # Run the original callback's hash and request-field transforms. Stop before
    # actor/animator virtual dispatch, which requires the full prior replay state.
    put(stack, "Q", stop)
    vm.reg_write(r.UC_X86_REG_RSP, stack)
    vm.reg_write(r.UC_X86_REG_RDI, get(obj + 0x20, "Q"))
    vm.reg_write(r.UC_X86_REG_RSI, len(name))
    vm.emu_start(image.base + 0x14E9C00, stop, count=1000)
    assert vm.reg_read(r.UC_X86_REG_RIP) == stop
    name_hash = vm.reg_read(r.UC_X86_REG_EAX)
    put(body + 0x100, "I", name_hash)
    prefix(0x135AB0, 0x135C12, [(r.UC_X86_REG_R14, obj), (r.UC_X86_REG_R15, body + 0x100), (r.UC_X86_REG_RBP, frame)])
    if get(frame - 0x40, "B") != 0:
        raise UnsupportedRequest("callback skips the reviewed direct request path")
    prefix(0x135C9D, 0x135D24, [(r.UC_X86_REG_R14, obj)])
    after_field = vm.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF
    prefix(0x135DD4, 0x135E54, [(r.UC_X86_REG_R14, obj)])
    last_field = vm.reg_read(r.UC_X86_REG_XMM0) & 0xFFFFFFFF
    request_float = get(frame - 0x3C, "f")
    if not math.isfinite(request_float):
        raise UnsupportedRequest("non-finite request rate")
    receipt["callback"] = {
        "entryRva": "0x135a40",
        "hashRva": "0x14e9c00",
        "nameHash": f"{name_hash:08x}",
        "requestRva": "0x135c8d",
        "flags": get(frame - 0x44, "I"),
        "requestFloat": request_float,
        "requestFloatBits": f"{get(frame - 0x3C, 'I'):08x}",
        "adjustmentFloatBits": f"{after_field:08x}",
        "overrideFloatBits": f"{last_field:08x}",
    }
    return receipt


if batch.exists():
    requests = json.loads(batch.read_text(encoding="utf-8"))
    results = []
    for request in requests:
        context_id = request["context"]
        try:
            result = decode_packet(context_id, bytes.fromhex(request["payload"]))
        except (UnsupportedRequest, u.UcError, UnicodeDecodeError) as error:
            result = {
                "omission": type(error).__name__,
                "detail": str(error),
                "context": context_id,
                "payload": request["payload"],
            }
        results.append(result)
    with (directory / "packet-reader.json").open("x", encoding="utf-8") as handle:
        json.dump(results, handle, allow_nan=False)
else:
    source = json.loads((directory / "source.json").read_text(encoding="utf-8"))
    receipt = decode_packet(source["actor"]["context"], bytes.fromhex(source["cue"]["payload"]))
    assert receipt["name"] == source["clip"]
    assert receipt["callback"]["nameHash"] == source["authored"]["graphKey"]
    (directory / "packet-reader.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt, indent=2))
