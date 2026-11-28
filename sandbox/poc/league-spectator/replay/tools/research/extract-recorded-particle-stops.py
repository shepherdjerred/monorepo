"""Execute the exact 16.23.841.8428 particle-stop packet path offline.

The input is a digest-pinned transport corpus with build, protocol,
replaySha256, opcode and packets. Each packet is
[replaySeconds, sequence, outerContext, payloadHex].
"""

import argparse
import importlib.util
import json
import math
import re
import struct
from hashlib import sha256
from pathlib import Path

from unicorn import x86_const as register

PACKET_OPCODE = 1164
HANDLER = 0x8684A0
HANDLER_CALL = 0x6EAB20
DISPATCH_TABLE = 0x6F5F28
DISPATCH_CASE = 0x6EAB13
DECODER = 0x1145CB0
CONSTRUCTOR = 0x1013707
CONSTRUCTOR_END = 0x101C304
LOOKUP_RETURN = 0x8685EF
EFFECT_BRANCH = 0x86861B
DIRECT_STOP = 0x868641
ALTERNATE_STOP = 0x86865B
BYTE_TABLE = 0x2141640
FEATURE_GATE = 0x254E948
DEFERRED_REGISTRY = 0x254E930
UINT32_MAX = 0xFFFFFFFF
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def load_native_reader():
    path = Path(__file__).with_name("extract-recorded-heimer-impacts.py")
    spec = importlib.util.spec_from_file_location("recorded_grouped_reader", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("The archived packet harness could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ParticleStopOracle:
    def __init__(self, harness, archive):
        self.harness = harness
        self.reader = harness.GroupedReader(
            harness.read_replication_image(archive, harness.CURRENT_BUILD),
        )
        self.image = self.reader.image
        self.machine = self.reader.machine
        dispatch = (
            DISPATCH_TABLE
            + struct.unpack_from(
                "<i",
                self.image.image,
                DISPATCH_TABLE + (PACKET_OPCODE - 12) * 4,
            )[0]
        )
        call = (
            HANDLER_CALL
            + 5
            + struct.unpack_from(
                "<i",
                self.image.image,
                HANDLER_CALL + 1,
            )[0]
        )
        if dispatch != DISPATCH_CASE or call != HANDLER:
            raise ValueError("The archived particle-stop dispatcher differs")
        self.byte_table = self.image.image[BYTE_TABLE : BYTE_TABLE + 256]
        self.handle_bytes = bytes(harness.rotate((value + 0x7F) & 255, 2) for value in self.byte_table)
        if len(set(self.handle_bytes)) != 256:
            raise ValueError("The archived particle-stop target encoding differs")
        self.machine.mem_write(self.image.base + FEATURE_GATE, b"\x01")
        deferred = self.reader.read(self.image.base + DEFERRED_REGISTRY, 8)
        deferred_end = self.reader.read(self.image.base + DEFERRED_REGISTRY + 8, 8)
        if deferred or deferred_end:
            raise ValueError("The supplied archive has a populated deferred registry")

    def decode(self, payload, context):
        harness = self.harness
        reader = self.reader
        base = self.image.base
        machine = self.machine
        packet = harness.OBJECT + 0x100
        machine.mem_write(packet, bytes(64))
        reader.heap = harness.HEAP
        reader.context = context
        machine.reg_write(register.UC_X86_REG_RAX, packet)
        machine.reg_write(register.UC_X86_REG_RBX, harness.OBJECT)
        reader.call(CONSTRUCTOR, end=base + CONSTRUCTOR_END)
        if reader.read(harness.OBJECT, 8) != packet or reader.read(packet + 8, 2) != PACKET_OPCODE:
            raise ValueError("The archived particle-stop constructor differs")
        vtable = reader.read(packet, 8)
        if reader.read(vtable + 8, 8) != base + DECODER:
            raise ValueError("The archived particle-stop decoder differs")
        machine.mem_write(harness.BODY, payload)
        reader.put_pointer(harness.CURSOR, harness.BODY)
        body_end = harness.BODY + len(payload)
        reader.call(DECODER, packet, harness.CURSOR, body_end)
        if machine.reg_read(register.UC_X86_REG_AL) != 1 or reader.read(harness.CURSOR, 8) != body_end:
            return None
        reader.lookups = {}
        reader.call(HANDLER, packet)
        target = reader.lookups.get(LOOKUP_RETURN)
        encoded = bytes(machine.mem_read(packet + 0x14, 4))
        if target != int.from_bytes(encoded.translate(self.handle_bytes), "little"):
            raise ValueError("The archived particle-stop registry lookup differs")
        flags = self.byte_table[self.byte_table[harness.swap(reader.read(packet + 0x10, 1))]]
        route = "alternate-stop" if flags & 8 else "direct-stop"
        branch = ALTERNATE_STOP if flags & 8 else DIRECT_STOP
        # Emulate branch selection after a supplied successful type cast.
        # Stop before the original call into the live effect instance.
        machine.reg_write(register.UC_X86_REG_RAX, harness.STOP + 0x600)
        machine.reg_write(register.UC_X86_REG_RBX, packet)
        machine.reg_write(register.UC_X86_REG_R12, base + BYTE_TABLE)
        reader.call(EFFECT_BRANCH, end=base + branch)
        return {"target": target, "flags": flags, "route": route}


def read_packets(corpus, start, end):
    rows = corpus.get("packets")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Particle-stop corpus requires a nonempty packet list")
    last_sequence = -1
    for stamp, sequence, context, payload_hex in rows:
        if (
            type(stamp) not in (int, float)
            or not math.isfinite(stamp)
            or stamp < 0
            or type(sequence) is not int
            or sequence <= last_sequence
            or type(context) is not int
            or not 0 <= context <= UINT32_MAX
            or not isinstance(payload_hex, str)
            or re.fullmatch(r"(?:[0-9a-f]{2}){1,6}", payload_hex) is None
        ):
            raise ValueError("Malformed recorded particle-stop packet")
        last_sequence = sequence
        if start <= stamp < end:
            yield stamp, sequence, context, bytes.fromhex(payload_hex)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    if not __debug__:
        parser.error("Run the archived packet harness with assertions enabled")
    parser.add_argument("archive", type=Path)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("corpus_sha256")
    parser.add_argument("output", type=Path)
    parser.add_argument("--window", type=float, nargs=2, required=True, metavar=("START", "END"))
    args = parser.parse_args()
    output = args.output
    if not output.parent.resolve().is_relative_to(Path(".cache").resolve()) or output.exists():
        raise ValueError("Expected a fresh private .cache output")
    start, end = args.window
    if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
        raise ValueError("A finite, positive-length replay-clock interval is required")
    source = args.corpus.read_bytes()
    corpus_sha256 = sha256(source).hexdigest()
    if corpus_sha256 != args.corpus_sha256:
        raise ValueError("The recorded particle-stop corpus digest differs")
    corpus = json.loads(source)
    harness = load_native_reader()
    if (corpus.get("build"), corpus.get("protocol"), corpus.get("opcode")) != (
        harness.CURRENT_BUILD,
        harness.PROTOCOL,
        PACKET_OPCODE,
    ) or not SHA256_PATTERN.fullmatch(corpus.get("replaySha256", "")):
        raise ValueError("Unsupported recorded particle-stop corpus identity")
    oracle = ParticleStopOracle(harness, args.archive.read_bytes())
    events = []
    route_controls = {}
    for stamp, sequence, context, payload in read_packets(corpus, start, end):
        decoded = oracle.decode(payload, context)
        if decoded is None:
            raise ValueError(f"Incomplete archived particle-stop body at sequence {sequence}")
        route_controls.setdefault(decoded["route"], (payload, context, decoded))
        events.append(
            {
                "stamp": stamp,
                "sequence": sequence,
                "context": context,
                "packetSha256": sha256(payload).hexdigest(),
                **decoded,
            }
        )
    if not events:
        raise ValueError("The requested interval has no recorded particle-stop packets")
    for route, (payload, context, decoded) in route_controls.items():
        if (
            oracle.decode(payload[:-1], context) is not None
            or oracle.decode(payload + b"\xaf", context) is not None
            or oracle.decode(payload, context) != decoded
        ):
            raise ValueError(f"Archived particle-stop framing control failed for {route}")
    receipt = {
        "schema": 1,
        "kind": "recorded-particle-stop-requests",
        "build": corpus["build"],
        "protocol": corpus["protocol"],
        "replaySha256": corpus["replaySha256"],
        "corpusSha256": corpus_sha256,
        "executableSha256": harness.CURRENT_ARCHIVE_SHA256,
        "window": args.window,
        "opcode": PACKET_OPCODE,
        "decoderRva": DECODER,
        "handlerRva": HANDLER,
        "routesChecked": sorted(route_controls),
        "scope": {
            "originalBodyDecoder": True,
            "originalTargetLookupArgument": True,
            "originalBranchSelection": True,
            "liveEffectRegistry": False,
            "liveStopSideEffects": False,
        },
        "events": events,
    }
    with output.open("xb") as handle:
        handle.write((json.dumps(receipt, indent=2) + "\n").encode("utf-8"))
    print(f"Verified {len(events)} complete particle-stop bodies across {len(route_controls)} routes")


if __name__ == "__main__":
    main()
