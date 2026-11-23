"""Execute original participant slot/identity slices against recorded startup rows."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import unicorn
from unicorn import x86_const as registers

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("assets", type=Path)
parser.add_argument("initial", type=Path)
parser.add_argument("replay", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
inputs = {}
def raw(path):
    data = path.read_bytes()
    inputs[str(path.resolve())] = hashlib.sha256(data).hexdigest()
    return data
raw(Path(__file__))
profile = json.loads(raw(args.assets / "decoder-16.21-macos/profile.json"))
image = raw(args.assets / "decoder-16.21-macos/image.bin")
if hashlib.sha256(image).hexdigest() != "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7":
    raise ValueError("Pinned exact original decoder image required")
initial = json.loads(raw(args.initial))
replay = raw(args.replay)
if initial["replaySha256"] != hashlib.sha256(replay).hexdigest():
    raise ValueError("Original startup packet and replay differ")
size = struct.unpack_from("<I", replay, len(replay)-4)[0]
metadata = json.loads(json.loads(replay[-4-size:-4])["statsJson"])
observation = initial["startupObservation"]
obj, heap = [bytes.fromhex(observation[name]) for name in ["objectHex", "heapHex"]]
if len(obj) != 568 or obj != heap[:568]:
    raise ValueError("Original complete startup object required")
pointer, count, capacity = struct.unpack_from("<QII", obj, 0x40)
offset = pointer - 0x10200000
if not 0 < count <= 56 or not count <= capacity <= 65536 or not 568 <= offset <= len(heap)-count*0xd0:
    raise ValueError("Original participant vector escaped packet arena")
base = profile["imageBase"]
machine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
machine.mem_map(base, len(image))
machine.mem_write(base, image)
machine.mem_map(0x10000000, 0x1000)
machine.mem_map(0x20000000, 0x1000)
machine.reg_write(registers.UC_X86_REG_RBP, 0x20000800)
rows = []
try:
    for index in range(count):
        row = heap[offset+index*0xd0:offset+(index+1)*0xd0]
        machine.mem_write(0x10000000, row)
        machine.reg_write(registers.UC_X86_REG_RSI, 0x10000000)
        machine.emu_start(base+0x6cdeb4, base+0x6cdeeb, count=1000)
        if machine.reg_read(registers.UC_X86_REG_RIP) != base+0x6cdeeb:
            raise ValueError("Original participant slot slice did not finish")
        slot = machine.reg_read(registers.UC_X86_REG_EAX)
        machine.reg_write(registers.UC_X86_REG_R14, 0x10000000)
        machine.reg_write(registers.UC_X86_REG_R13, base+0x20d6660)
        machine.emu_start(base+0x6cdf01, base+0x6ce133, count=1000)
        if machine.reg_read(registers.UC_X86_REG_RIP) != base+0x6ce133:
            raise ValueError("Original participant ID slice did not finish")
        identity = str(machine.reg_read(registers.UC_X86_REG_RSI))
        matches = [i for i, player in enumerate(metadata) if str(player["SUMMONER_ID"]) == identity]
        rows.append({"row": index, "slot": slot, "identity": identity, "metadataMatches": matches,
                     "champions": [metadata[i]["SKIN"] for i in matches],
                     "teams": [int(metadata[i]["TEAM"]) for i in matches]})
finally:
    del machine
for path, expected in inputs.items():
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected:
        raise ValueError("Participant proof input changed: "+path)
report = {"schema": 1, "kind": "original-participant-identity-slices", "replaySha256": initial["replaySha256"],
          "build": initial["build"], "protocol": initial["protocol"], "rows": rows,
          "originalSlices": [[0x6cdeb4,0x6cdeeb],[0x6cdf01,0x6ce133]],
          "inputs": inputs, "scope": "Original decoded slot and 64-bit participant identity; not complete participant manager or game loop"}
args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
