"""Independent native Unicorn snapshots for the browser gameplay decoder."""
import argparse
import json
from pathlib import Path
from rofllens import ReplayReader
from rofllens.decoders.emulator import UnicornDecoderEngine

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("research", type=Path)
parser.add_argument("fixture", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
profile = args.research / "rofllens/src/rofllens/profiles/16.14.794.5912-34de26710352/profile.json"
engine = UnicornDecoderEngine(profile, args.research / "League of Legends.exe")
extra = json.loads((Path(__file__).parent.parent / "gameplay-profile.json").read_text())
for name, config in extra.items():
    # Dedicated return sentinel in mapped image padding; not a discovered function end.
    engine.profile["decoders"][name] = {**config, "status": "candidate", "endRva": engine.profile["sizeOfImage"] - 0x2000, "constructorEndRva": engine.profile["sizeOfImage"] - 0x2000}
names = ["spellCast", "championDeath", "wardSpawnOrDestroy", "missileTrajectory", "opcode035dCandidate", *extra]
for name in names:
    config = engine.profile["decoders"][name]
    config["endRva"] = engine.profile["sizeOfImage"] - 0x2000
    if "constructorRva" in config:
        config["constructorEndRva"] = config["endRva"]
opcodes = {engine.profile["decoders"][name]["opcode"]: name for name in names}
counts = {name: 0 for name in names}
samples = []
with ReplayReader.open(args.fixture) as replay:
    for block in replay.iter_blocks(opcodes=opcodes, include_payload=True):
        name = opcodes[block.packet_id]
        if counts[name] >= 5:
            continue
        observation = engine.observe_decoder(name, block.payload, allow_unverified=True, capture_heap_writes=True, include_constructor_writes=True)
        samples.append({"name": name, "time": block.timestamp, "param": block.param, "opcode": block.packet_id, "payload": block.payload.hex(), "output": observation.output_snapshot.hex(), "heap": observation.heap_snapshot.hex(), "writes": observation.output_writes, "heapWrites": observation.heap_writes})
        counts[name] += 1
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(samples))
print(json.dumps(counts))
