"""Verify archived champion level-cap packet bodies and effective cap getter."""

import argparse
import json
import struct
from hashlib import sha256
from pathlib import Path

from champion_replication_archive import SLICE_DIGESTS, read_replication_image
from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_64, Uc
from unicorn import x86_const as r

ARENA = 0x6000000
ACTOR, PROFILE, SERVICE, PACKET, BODY, CURSOR, STACK, STOP = (
    ARENA + offset for offset in (0x1000, 0x7000, 0x8000, 0x9000, 0xA000, 0xB000, 0xE008, 0x10000)
)


def verify(archive, evidence):
    identity = evidence["identity"]
    build = identity["build"]
    image = read_replication_image(archive, build)
    base = image.base
    if (
        identity["protocol"] != "8bbfcd5af2bc92db"
        or len(bytes.fromhex(identity["replaySha256"])) != 32
    ):
        raise ValueError("Wrong replay evidence identity")
    vm = Uc(UC_ARCH_X86, UC_MODE_64)
    vm.mem_map(base, len(image.image))
    vm.mem_write(base, bytes(image.image))
    vm.mem_map(ARENA, 0x12000)

    def put(address, fmt, value):
        vm.mem_write(address, struct.pack("<" + fmt, value))

    def get(address, fmt):
        return struct.unpack("<" + fmt, vm.mem_read(address, struct.calcsize("<" + fmt)))[0]

    def native(rva, actor=0, cursor=0, limit=0):
        vm.reg_write(r.UC_X86_REG_RDI, actor)
        vm.reg_write(r.UC_X86_REG_RSI, cursor)
        vm.reg_write(r.UC_X86_REG_RDX, limit)
        vm.reg_write(r.UC_X86_REG_RSP, STACK)
        put(STACK, "Q", STOP)
        vm.emu_start(base + rva, STOP, count=2048)
        if vm.reg_read(r.UC_X86_REG_RIP) != STOP:
            raise ValueError("Native level-cap probe exceeded its instruction budget")
        return vm.reg_read(r.UC_X86_REG_EAX)

    put(base + 0x25DB0A0, "Q", SERVICE)
    put(SERVICE + 0x110, "Q", PROFILE)
    native(0x217C60, PROFILE)
    profile_cap = native(0x1433E0, ACTOR + 0x3C98)
    if profile_cap != 18 or get(PROFILE + 0x48, "I") != profile_cap:
        raise ValueError("Unexpected initial cap profile")
    put(ACTOR, "Q", base + 0x2368D08)
    if get(base + 0x2368D08 + 0xAE8, "Q") != base + 0x186AE0:
        raise ValueError("Unexpected native cap setter")
    factory_table = base + 0x101C56C
    if factory_table + get(factory_table + 652 * 4, "i") != base + 0x1019705:
        raise ValueError("Unexpected native packet factory case")
    if get(base + 0x2444698 + 8, "Q") != base + 0x11DC7C0:
        raise ValueError("Unexpected native cap body reader")

    def envelope_context(uc, _address, _size, _data):
        # ROFL carries context outside the original wire body. Packet+0xc
        # already contains that independently bound envelope context.
        frame = uc.reg_read(r.UC_X86_REG_RSP)
        uc.reg_write(r.UC_X86_REG_RIP, get(frame, "Q"))
        uc.reg_write(r.UC_X86_REG_RSP, frame + 8)
        uc.reg_write(r.UC_X86_REG_EAX, 1)

    vm.hook_add(UC_HOOK_CODE, envelope_context, begin=base + 0x1637CB0, end=base + 0x1637CB0)

    def read_cap(payload, participant_id=0):
        vm.mem_write(BODY, payload)
        put(CURSOR, "Q", BODY)
        put(PACKET + 0xC, "I", participant_id)
        put(PACKET + 0x10, "B", 0x43)
        put(ACTOR + 0x4864, "I", 0)
        if not native(0x11DC7C0, PACKET, CURSOR, BODY + len(payload)) & 0xFF or get(CURSOR, "Q") != BODY + len(payload):
            raise ValueError("Native level-cap reader did not consume the saved body")
        if not native(0x101A60, ACTOR, PACKET) & 0xFF:
            raise ValueError("Native level-cap handler rejected the packet")
        return native(0x1433E0, ACTOR + 0x3C98)

    selectors = []
    for selector in range(8):
        if selector < 4:
            selectors.append(read_cap(bytes([selector])))
        else:
            selectors.extend(read_cap(bytes([selector, value])) for value in range(256))
    control_sha = sha256(bytes(selectors)).hexdigest()
    if control_sha != evidence["controlSha256"]:
        raise ValueError("Original and projected cap selector controls disagree")

    verified_rows = {name: 0 for name in ("1", "2", "3", "4")}
    participants = set(evidence["participantIds"])
    if len(participants) != 10 or len(evidence["participantIds"]) != 10:
        raise ValueError("Expected ten independently bound participant IDs")
    for row in evidence["rows"]:
        participant_id = row["participantId"]
        if participant_id not in participants or row["champion"] is not True:
            raise ValueError("Unbound cap row")
        if read_cap(bytes.fromhex(row["payload"]), participant_id) != row["maxLevel"]:
            raise ValueError("Original and projected saved cap values disagree")
        verified_rows[str(row["stream"])] += 1
    stream_counts = evidence["streamCounts"]
    if set(stream_counts) != set(verified_rows) or any(
        type(count) is not int or count < verified_rows[key] for key, count in stream_counts.items()
    ):
        raise ValueError("Expected complete source stream counts")
    return {
        "identity": identity,
        "sliceSha256": SLICE_DIGESTS[build],
        "nativeDefaultCap": profile_cap,
        "controlCount": len(selectors),
        "controlSha256": control_sha,
        "sourceOpcodeCountsByStream": stream_counts,
        "verifiedChampionRowsByStream": verified_rows,
        "verifiedChampionRows": evidence["rows"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = args.input.read_bytes()
    receipt = verify(args.archive.read_bytes(), json.loads(source))
    receipt["inputSha256"] = sha256(source).hexdigest()
    with args.output.open("x", encoding="utf8") as output:
        json.dump(receipt, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
