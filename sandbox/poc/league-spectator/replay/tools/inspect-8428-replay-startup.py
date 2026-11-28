"""Inspect map and mode from an original .8428 replay's native startup reader."""

import argparse
import json
import re
import struct
import subprocess
from hashlib import sha256
from pathlib import Path

import unicorn as uc
from champion_replication_archive import CURRENT_BUILD, read_replication_image
from unicorn import x86_const as reg

PROTOCOL = "8bbfcd5af2bc92db"
OPCODE = 1022
TRANSPORT = """
import { openReplay, replayPacketEnvelopes } from
  "./packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
const bytes = await Bun.file(process.argv.at(-1)).arrayBuffer();
const replay = openReplay(bytes);
if (replay.build !== "16.23.841.8428" || replay.protocol !== "8bbfcd5af2bc92db")
  throw Error("Exact .8428 replay required");
const startup = [];
for (const p of replayPacketEnvelopes(replay, (b) => Bun.zstdDecompressSync(b))) {
  if (p.stream === 3 && p.explicitOpcode === 1022) startup.push(p);
}
if (startup.length !== 1) throw Error("Exactly one opcode 1022 startup required");
const p = startup[0];
if (p.firstTimeBits !== 0 || p.secondTimeBits !== 0 || p.paramBits !== 0)
  throw Error("Unexpected startup time or owner");
console.log(JSON.stringify({
  build: replay.build, protocol: replay.protocol, stream: p.stream,
  opcode: p.explicitOpcode, chunkId: p.chunkId, offset: p.blockOffset,
  replaySha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  payloadHex: Buffer.from(p.payload).toString("hex"),
}));
"""


class NativeStartupReader:
    """Run the pinned constructor, full wire reader and bounded map consumer."""

    ARENA = 0x10000000
    ARENA_SIZE = 0x100000
    SENTINEL = ARENA
    PACKET = ARENA + 0x1000
    CONFIG = ARENA + 0x2000
    CURSOR = ARENA + 0x3000
    WIRE = ARENA + 0x4000
    STACK = ARENA + 0xF008
    HEAP = ARENA + 0x10000

    def __init__(self, image):
        self.image = image
        self.cpu = uc.Uc(uc.UC_ARCH_X86, uc.UC_MODE_64)
        self.cpu.mem_map(image.base, len(image.image))
        self.cpu.mem_write(image.base, bytes(image.image))
        self.cpu.mem_map(self.ARENA, self.ARENA_SIZE)
        self.heap = self.HEAP
        self.cpu.hook_add(uc.UC_HOOK_CODE, self.host)
        for address, name in image.data_imports.items():
            if name == "___stack_chk_guard":
                self.cpu.mem_write(image.base + address, struct.pack("<Q", self.ARENA))

    def qword(self, at):
        return struct.unpack("<Q", self.cpu.mem_read(at, 8))[0]

    def host(self, cpu, address, _size, _data):
        rva = address - self.image.base
        name = self.image.imports.get(rva)
        a, b, c = (cpu.reg_read(r) for r in (reg.UC_X86_REG_RDI, reg.UC_X86_REG_RSI, reg.UC_X86_REG_RDX))
        if rva == 0x1637CB0:
            # Outer packet transport supplies owner zero for this startup envelope.
            cpu.mem_write(a + 12, b"\0" * 4)
            result = 1
        elif rva in (0x14A0300, 0x14A2030, 0x14C5B20) or name == "_malloc":
            result = self.heap
            self.heap += max(32, (a + 31) & ~31)
            if self.heap > self.ARENA + self.ARENA_SIZE:
                raise ValueError("Startup allocation exceeds arena")
        elif name == "___cxa_guard_acquire":
            result = int(cpu.mem_read(a, 1)[0] == 0)
        elif name == "___cxa_guard_release":
            cpu.mem_write(a, b"\x01")
            result = 0
        elif name in ("___cxa_atexit", "_pthread_mutex_lock", "_pthread_mutex_unlock"):
            result = 0
        elif name == "___bzero":
            if b > self.ARENA_SIZE:
                raise ValueError("Startup clear exceeds arena")
            cpu.mem_write(a, bytes(b))
            result = a
        elif name in ("_memcpy", "_memmove"):
            if c > self.ARENA_SIZE:
                raise ValueError("Startup copy exceeds arena")
            cpu.mem_write(a, bytes(cpu.mem_read(b, c)))
            result = a
        elif name:
            raise ValueError(f"Unexpected startup host import: {name}")
        else:
            return
        sp = cpu.reg_read(reg.UC_X86_REG_RSP)
        cpu.reg_write(reg.UC_X86_REG_RAX, result)
        cpu.reg_write(reg.UC_X86_REG_RSP, sp + 8)
        cpu.reg_write(reg.UC_X86_REG_RIP, self.qword(sp))

    def call(self, start, end=None, **registers):
        endpoint = self.SENTINEL if end is None else self.image.base + end
        self.cpu.mem_write(self.STACK, struct.pack("<Q", self.SENTINEL))
        self.cpu.reg_write(reg.UC_X86_REG_RSP, self.STACK)
        self.cpu.reg_write(reg.UC_X86_REG_RBP, 0)
        for name, value in registers.items():
            self.cpu.reg_write(getattr(reg, f"UC_X86_REG_{name.upper()}"), value)
        self.cpu.emu_start(self.image.base + start, endpoint, count=500_000)
        if self.cpu.reg_read(reg.UC_X86_REG_RIP) != endpoint:
            raise ValueError("Startup reader exceeded native instruction budget")
        return self.cpu.reg_read(reg.UC_X86_REG_RAX)

    def read(self, wire):
        if not 0 < len(wire) <= 0x8000:
            raise ValueError("Invalid startup body length")
        self.cpu.mem_write(self.PACKET, bytes(0x1000))
        self.cpu.mem_write(self.CURSOR, struct.pack("<Q", self.WIRE))
        self.cpu.mem_write(self.WIRE, wire)
        self.call(0x10203B0, rdi=self.PACKET)
        result = self.call(0x11F3C70, rdi=self.PACKET, rsi=self.CURSOR, rdx=self.WIRE + len(wire))
        if result & 255 != 1 or self.qword(self.CURSOR) != self.WIRE + len(wire):
            raise ValueError("Original startup reader did not consume the entire body")
        pointer, length, capacity = struct.unpack("<QII", self.cpu.mem_read(self.PACKET + 0xE0, 16))
        if not (0 < length < capacity <= 129 and pointer >= self.HEAP and pointer + capacity <= self.heap):
            raise ValueError("Invalid startup mode allocation")
        mode = bytes(self.cpu.mem_read(pointer, length + 1))
        if re.fullmatch(rb"[A-Z][A-Z0-9_]*\0", mode) is None:
            raise ValueError("Invalid startup mode")
        # The startup dispatch forwards packet +0x78; the configuration
        # consumer decodes its scalar at +0x194 before copying strings.
        self.call(0x706377, end=0x70637E, r14=self.PACKET)
        forwarded = self.cpu.reg_read(reg.UC_X86_REG_RSI)
        if forwarded != self.PACKET + 0x78:
            raise ValueError("Native startup forwarded another subobject")
        self.call(0x635741, end=0x6357FC, rdi=self.CONFIG, rsi=forwarded)
        map_id = self.call(0x636EE0, rdi=self.CONFIG) & 0xFFFFFFFF
        if map_id == 0:
            raise ValueError("Invalid configured map ID")
        return {"configuredMapId": map_id, "mode": mode[:-1].decode("ascii")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archived_macos_executable", type=Path)
    parser.add_argument("replay", type=Path, nargs="+")
    parser.add_argument("--verify-malformed-controls", action="store_true")
    args = parser.parse_args()
    archive = args.archived_macos_executable.read_bytes()
    image = read_replication_image(archive, CURRENT_BUILD)
    root = Path(__file__).resolve().parents[5]
    rows = []
    for replay in args.replay:
        result = subprocess.run(
            ["bun", "-e", TRANSPORT, str(replay.resolve())], cwd=root, check=True, capture_output=True, text=True
        )
        row = json.loads(result.stdout)
        if (row["build"], row["protocol"], row["opcode"]) != (CURRENT_BUILD, PROTOCOL, OPCODE):
            raise ValueError("Unexpected exact startup envelope")
        wire = bytes.fromhex(row.pop("payloadHex"))
        native = NativeStartupReader(image)
        decoded = native.read(wire)
        if args.verify_malformed_controls:
            for bad in (wire[:-1], wire + b"\0"):
                try:
                    native.read(bad)
                except ValueError as error:
                    if str(error) != "Original startup reader did not consume the entire body":
                        raise
                else:
                    raise ValueError("Original reader admitted malformed startup body")
        rows.append({**row, **decoded, "payloadSha256": sha256(wire).hexdigest(), "consumedBytes": len(wire)})
    print(
        json.dumps(
            {
                "archiveSha256": sha256(archive).hexdigest(),
                "malformedControls": args.verify_malformed_controls,
                "replays": rows,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
