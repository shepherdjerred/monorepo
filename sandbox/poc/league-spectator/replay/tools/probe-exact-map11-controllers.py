"""Run original Map11 controller packet reads, writes, and graph evaluation."""

import argparse
import importlib
import json
import struct
from math import isfinite
from pathlib import Path

motion = importlib.import_module("probe-exact-fog-turret-motion")
bounded_call = importlib.import_module("probe-exact-fog-champion-position-path").bounded_call
reg = motion.reg
INPUT_SHA = {
    "7fb191aada7655a8e4384ebd8f5a170845ecfe63c66144248b2ae84d4061d844",
    "7a30ab9497e376217507e05fcbf97eb440f8bd87eb29922dd2170c45a3d5dc24",
    "f7227e40f61f63a2de511b6d08ef889e2960652762d3eb6c3b2fe807ac40bf3b",
    "546b37e6ae07073cac9de21060a8467124dcfaa94c764503378737c75ad62ee2",
}
CONSTRUCTORS = {
    "c406a533": 0x6C3710,
    "ec733fe2": 0x6C3570,
    "e07edfa4": 0x6C40C0,
    "e21083b5": 0x18B55F0,
}
TABLES = {
    "c406a533": 0x23BD278,
    "ec733fe2": 0x23BD220,
    "e07edfa4": 0x23BCF00,
    "e21083b5": 0x2471990,
}
GET_VISIBLE = 0x6B5E00
GET_COMPOSITE_VISIBLE = 0x189C950


class ControllerOracle(motion.MotionOracle):
    def initialize(self, controllers):
        self.direct = {}
        self.instances = {}
        self.manager = self.ARENA + 0x6000
        named = self.ARENA + 0x6100
        self.put(self.manager + 8, named)
        for key, controller in controllers.items():
            kind = controller["classHash"]
            instance = self.call(CONSTRUCTORS[kind], {})
            if self.get(instance) != self.base + TABLES[kind]:
                raise ValueError(f"Original constructor differs for {kind}")
            self.instances[key] = instance
            if "nameHash" not in controller:
                continue
            name = controller["nameHash"]
            self.cpu.mem_write(instance + 0xC, struct.pack("<I", name))
            authored = controller["defaultVisible"]
            if authored is not None:
                self.cpu.mem_write(instance + 0x20, bytes([authored]))
            bounded_call(self, 0x6B5DE0, {reg.UC_X86_REG_RDI: instance}, 0x6B5DEC)
            self.put(named + 8 * len(self.direct), instance)
            if name in self.direct:
                raise ValueError("Duplicate authored controller name")
            self.direct[name] = instance
        self.put(self.manager + 0x10, len(self.direct))
        for index, (key, controller) in enumerate(controllers.items()):
            if "children" not in controller:
                continue
            instance = self.instances[key]
            children = [self.instances[str(child)] for child in controller["children"]]
            array = self.ARENA + 0x8000 + 0x100 * index
            self.cpu.mem_write(array, struct.pack(f"<{len(children)}Q", *children))
            self.put(instance + 0x10, array)
            self.cpu.mem_write(instance + 0x18, struct.pack("<II", len(children), len(children)))
            if controller["operation"] is not None:
                self.cpu.mem_write(instance + 0x20, struct.pack("<I", controller["operation"]))

    def read_update(self, row):
        arena = self.ARENA
        self.packet_owner = 0
        payload = bytes.fromhex(row["payloadHex"])
        self.call(0x100FB7E, {reg.UC_X86_REG_RBX: arena + 0x4000}, stop_rva=0x101C304)
        packet = self.get(arena + 0x4000)
        if self.get(packet + 8, "H") != 80:
            raise ValueError("Unexpected original opcode 80 packet factory")
        self.cpu.mem_write(arena + 0x4100, payload)
        self.put(arena + 0x4200, arena + 0x4100)
        result = self.call(
            0x11C5400,
            {
                reg.UC_X86_REG_RDI: packet,
                reg.UC_X86_REG_RSI: arena + 0x4200,
                reg.UC_X86_REG_RDX: arena + 0x4100 + len(payload),
            },
        )
        if result & 255 != 1 or self.get(arena + 0x4200) != arena + 0x4100 + len(payload):
            raise ValueError("Native controller packet reader did not consume the body")
        arguments = {reg.UC_X86_REG_RDI: self.manager, reg.UC_X86_REG_RSI: packet}
        bounded_call(self, 0x6A7AB0, arguments, 0x6A7B95)
        name = self.cpu.reg_read(reg.UC_X86_REG_R8D)
        owner = self.direct.get(name)
        if owner is None:
            return name, None, None
        prior = self.cpu.mem_read(owner + 0x21, 7)
        self.call(0x6A7AB0, arguments)
        visible = self.visible(owner)
        transition = self.get(owner + 0x24, "f")
        self.cpu.mem_write(owner + 0x21, bytes(prior))
        return name, visible, transition

    def visible(self, controller):
        getter = self.get(self.get(controller) + 0x28) - self.base
        if getter not in {GET_VISIBLE, GET_COMPOSITE_VISIBLE}:
            raise ValueError("Unverified native visibility getter")
        return bool(self.call(getter, {reg.UC_X86_REG_RDI: controller}) & 255)

    def apply(self, name, visible, transition):
        (bits,) = struct.unpack("<I", struct.pack("<f", transition))
        self.call(
            0x6B5E20,
            {
                reg.UC_X86_REG_RDI: self.direct[name],
                reg.UC_X86_REG_RSI: int(visible),
                reg.UC_X86_REG_XMM0: bits,
            },
        )


class ControllerOracle8428(ControllerOracle):
    EXECUTABLE_SLICE_SHA256 = "de6db1683eb61358d0aaf9fac44ef722850a927263eae7f68212add8621a500e"


def dependent_mesh_controllers(controllers, name, mesh_ids):
    affected = {int(key) for key, entry in controllers.items() if entry.get("nameHash") == name}
    while True:
        dependents = {
            int(key) for key, entry in controllers.items() if affected.intersection(entry.get("children", []))
        }
        if dependents <= affected:
            return [key for key in mesh_ids if key in affected]
        affected.update(dependents)


def recover_animated_windows(tracks, snapshots, diagnostics):
    windows = []
    for event in diagnostics:
        name = int(event["nameHash"], 16)
        start = event["timeSeconds"]
        end = min((time for time, names in snapshots.values() if time > start and name in names), default=None)
        if start <= 0 or end is None:
            raise ValueError(f"Animated Map11 controller {name:08x} lacks a verified boundary snapshot")
        event["firstVerifiedSnapshotSeconds"] = end
        windows.extend(
            {"controllerId": key, "startSeconds": start, "endSeconds": end}
            for key in event["affectedMeshControllerIds"]
        )

    windows.sort(key=lambda row: (row["controllerId"], row["startSeconds"]))
    last_end = {}
    for window in windows:
        key, start, end = (window[field] for field in ("controllerId", "startSeconds", "endSeconds"))
        if key in last_end and start <= last_end[key]:
            raise ValueError(f"Overlapping animated Map11 controller windows for {key:08x}")
        last_end[key] = end
        points = tracks[key]
        prior = [point for point in points if point[0] < start]
        at_snapshot = next(state for time, state in reversed(points) if time <= end)
        if prior[-1][1] != at_snapshot:
            prior.append([end, at_snapshot])
        # No interpolation was checked. The absolute snapshot resupplies
        # the first Boolean state that can be published after this write.
        tracks[key] = prior + [point for point in points if point[0] > end]
    return windows


def evaluate(source, archive, navgrid, *, validate_replay=False, animation_diagnostics=None):
    build = source["build"]
    latest = build == "16.23.841.8428"
    if source.get("comparisonOnly") or (build != "16.23.840.6595" and not (latest and validate_replay)):
        raise ValueError("Expected pinned exact-build Map11 controller inputs")
    if animation_diagnostics is not None and not latest:
        raise ValueError("Animated controller omissions are only supported for build 16.23.841.8428")
    oracle_type = ControllerOracle8428 if latest else ControllerOracle
    oracle = oracle_type(motion.turret.MachImage(archive), navgrid)
    oracle.install_host()
    oracle.initialize(source["controllers"])
    mesh_ids = source["meshControllerIds"]
    unresolved = [key for key in mesh_ids if str(key) not in oracle.instances]
    if set(unresolved) != {0x6D9E7EC9, 0x76C50391}:
        raise ValueError("Unresolved exported controller cohort changed")
    tracks = {key: [[0, oracle.visible(oracle.instances[str(key)])]] for key in mesh_ids if key not in unresolved}
    unmatched_names = set()
    writes = []
    snapshots = {}
    for row in sorted(source["packets"], key=lambda row: (row["timeSeconds"], row["stream"], row["offset"])):
        name, visible, transition = oracle.read_update(row)
        if visible is None:
            if validate_replay:
                raise ValueError(
                    f"Unbound recorded Map11 controller {name:08x} "
                    f"in stream {row['stream']} chunk {row['chunk']} at {row['timeSeconds']}s"
                )
            unmatched_names.add(f"{name:08x}")
            continue
        if transition != 0:
            if animation_diagnostics is None or row["stream"] != 1 or not isfinite(transition) or transition < 0:
                raise ValueError(
                    f"Animated Map11 controller transition remains unverified for {name:08x} "
                    f"at {row['timeSeconds']}s (transition value: {transition})"
                )
            affected = dependent_mesh_controllers(source["controllers"], name, mesh_ids)
            animation_diagnostics.append(
                {
                    "nameHash": f"{name:08x}",
                    "timeSeconds": row["timeSeconds"],
                    "targetVisible": visible,
                    "transitionValue": transition,
                    "affectedMeshControllerIds": affected,
                }
            )
        if row["stream"] == 2:
            if validate_replay:
                snapshot = snapshots.setdefault(row["chunk"], (row["timeSeconds"], set()))
                if snapshot[0] != row["timeSeconds"] or name in snapshot[1]:
                    raise ValueError("Duplicate or inconsistent Map11 controller snapshot")
                snapshot[1].add(name)
            if oracle.visible(oracle.direct[name]) != visible:
                raise ValueError(f"Snapshot disagrees with authored and ordinary state for {name:08x}")
            continue
        oracle.apply(name, visible, transition)
        time = row["timeSeconds"]
        writes.append({"nameHash": f"{name:08x}", "timeSeconds": time, "visible": visible, "animated": transition != 0})
        for key, points in tracks.items():
            next_value = oracle.visible(oracle.instances[str(key)])
            if points[-1][1] != next_value:
                if points[-1][0] == time:
                    points[-1][1] = next_value
                else:
                    points.append([time, next_value])
    if validate_replay:
        validate_snapshot_cohort(snapshots, source["snapshotChunks"], writes, latest=latest)
    windows = (
        [] if animation_diagnostics is None else recover_animated_windows(tracks, snapshots, animation_diagnostics)
    )
    return {
        "replaySha256": source["replaySha256"],
        "build": source["build"],
        "protocol": source["protocol"],
        "geometrySha256": source["geometrySha256"],
        "materialsSha256": source["materialsSha256"],
        "tracks": [{"controllerId": key, "points": points} for key, points in tracks.items()],
        "unresolvedMeshControllerIds": unresolved,
        **({"unresolvedWindows": windows} if windows else {}),
        "unboundRecordedNameHashes": sorted(unmatched_names),
        "ordinaryWrites": [
            {key: value for key, value in write.items() if key != "animated"}
            for write in writes
            if not write["animated"]
        ],
    }


# Every supported Map11 snapshot includes these controllers.
MAP11_SNAPSHOT_NAMES = {
    0x7067ADC8,
    0xD1751A06,
    0x6204D1E5,
    0x625C62D8,
    0x5086EB70,
    0x17614A1D,
    0xDBA9FCB3,
    0x5CBA1BE9,
    0x2978241B,
    0xA28A5AF4,
    0x699B9AC4,
    0x5571AC30,
    0x0B6005AA,
    0x2936ED63,
    0x0125CAD8,
    0xD4A12099,
}

# These authored names join the recurring cohort after their first ordinary
# writes. The pinned long replay records the four writes in the same tick.
MAP11_DEFERRED_SNAPSHOT_NAMES = {0x309B774B, 0x81D63653, 0x3E5A58CE, 0x82BF1ADE}
# The .8428 elemental controller activation adds both authored names in one tick.
MAP11_8428_ELEMENTAL_SNAPSHOT_NAMES = {0x738C8DA8, 0x215400AA}


def validate_snapshot_cohort(snapshots, recorded_chunks, writes, *, latest=False):
    if not snapshots or next(iter(snapshots.values()))[0] != 0:
        raise ValueError("Missing the opening recorded Map11 controller snapshot")
    chunks = set(recorded_chunks)
    if snapshots.keys() - chunks:
        raise ValueError("Map11 controller snapshot lies outside recorded snapshot chunks")
    missing_chunks = chunks - snapshots.keys()
    if missing_chunks:
        chunk = min(missing_chunks)
        raise ValueError(f"Missing recorded Map11 controller snapshot in chunk {chunk}")
    deferred = [MAP11_DEFERRED_SNAPSHOT_NAMES]
    if latest:
        deferred.append(MAP11_8428_ELEMENTAL_SNAPSHOT_NAMES)
    deferred_names = set.union(*deferred)
    first_deferred_writes = {}
    for write in writes:
        name = int(write["nameHash"], 16)
        if name in deferred_names:
            first_deferred_writes.setdefault(name, write["timeSeconds"])
        elif name not in MAP11_SNAPSHOT_NAMES:
            raise ValueError(f"Unverified Map11 controller write outside the snapshot cohort for {name:08x}")
    activated = {}
    for cohort in deferred:
        present = cohort & first_deferred_writes.keys()
        if not present:
            continue
        activation_times = {first_deferred_writes[name] for name in present}
        if present != cohort or len(activation_times) != 1:
            raise ValueError("Unverified partial or staggered Map11 controller cohort activation")
        activated.setdefault(activation_times.pop(), set()).update(cohort)
    for chunk, (time, names) in snapshots.items():
        if time in activated:
            raise ValueError(f"Ambiguous Map11 controller activation in snapshot chunk {chunk}")
        expected = MAP11_SNAPSHOT_NAMES.union(*(cohort for at, cohort in activated.items() if at < time))
        missing = ", ".join(f"{name:08x}" for name in sorted(expected - names))
        unexpected = ", ".join(f"{name:08x}" for name in sorted(names - expected))
        if missing or unexpected:
            raise ValueError(
                f"Inconsistent recorded Map11 controller snapshot in chunk {chunk} at {time}s "
                f"(missing: {missing or 'none'}, unexpected: {unexpected or 'none'})"
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("mach", "navgrid", "input", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    if motion.turret.navgrid.sha(raw) not in INPUT_SHA:
        raise ValueError("Unexpected exact Map11 controller inputs")
    receipt = evaluate(json.loads(raw), args.mach.read_bytes(), args.navgrid.read_bytes())
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(receipt, output, indent=2, allow_nan=False)


if __name__ == "__main__":
    main()
