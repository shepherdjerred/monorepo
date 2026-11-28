"""Verify exact-build Rift placement using archived code and controlled model services.

Run with the archived .8428 executable, opcode 938 corpus, and source catalog.
The receipt binds packet identities and observations to the original bytes.
Registry entities, the active model, its position and Euler getters, effect
binding, and sincosf are explicit boundaries. No game process or replay
renderer is started, and the sampled transforms are controlled inputs.
"""

import argparse
import json
import math
import runpy
import struct
from collections import defaultdict
from hashlib import sha256
from pathlib import Path

from unicorn import UC_HOOK_CODE

SOURCE_PATH = Path(__file__).with_name("extract-recorded-heimer-impacts.py")
CORPUS_SHA256 = "147af77634dbf778c1a2a221ac47d377fd37fbd74126d646cff3a2e38e908f3d"
CATALOG_SHA256 = "231b9968d5fede04143c7dba9996e143b24c733bd63e0fb0c397efd50aa20a09"
IDENTITY_MATRIX = tuple(float(index % 5 == 0) for index in range(16))
code = runpy.run_path(str(SOURCE_PATH))
r = code["r"]


class AttachmentProbe(code["GroupedReader"]):
    parent_object = code["STOP"] + 0x8000
    owner_object = code["STOP"] + 0x9000
    descriptor_boundary = 0x866394
    frame = code["STACK"] - 0x400
    model = code["STOP"] + 0xB000
    model_values = code["STOP"] + 0xB800
    observed_position = code["STOP"] + 0xB900
    observed_matrix = code["STOP"] + 0xBA00
    effect = code["STOP"] + 0xBB00
    effect_vtable = code["STOP"] + 0xC000
    model_service_callback = code["STOP"] + 0xD000
    orientation_callback = code["STOP"] + 0xD010
    position_callback = code["STOP"] + 0xD020
    bind_callback = code["STOP"] + 0xD030
    descriptor_address = code["STOP"] + 0xD100
    system = code["STOP"] + 0xD400

    def install_transform_controls(self):
        for rva in (0x15A0D50, 0x567C80):
            self.hook(rva, self.on_transform)
        for rva in (0xD2E70, 0xC1AC0, 0x565340, 0x565530, 0x566A30):
            self.hook(rva, self.on_transform)
        for address in (
            self.model_service_callback,
            self.orientation_callback,
            self.position_callback,
            self.bind_callback,
        ):
            self.machine.hook_add(UC_HOOK_CODE, self.on_transform, begin=address, end=address)

    def on_call(self, machine, address, size, data):
        if address - self.image.base == 0x2050B90:
            angle = struct.unpack("<f", machine.reg_read(r.UC_X86_REG_XMM0).to_bytes(16, "little")[:4])[0]
            value = int.from_bytes(struct.pack("<2f", math.sin(angle), math.cos(angle)), "little")
            machine.reg_write(r.UC_X86_REG_XMM0, value)
            self.return_value(0)
            return
        return super().on_call(machine, address, size, data)

    def on_transform(self, machine, address, size, data):
        rva = address - self.image.base
        first = machine.reg_read(r.UC_X86_REG_RDI)
        second = machine.reg_read(r.UC_X86_REG_RSI)
        third = machine.reg_read(r.UC_X86_REG_RDX)
        if rva == 0x567C80:
            self.transform_requests.append((second, third))
            return
        if rva == 0x15A0D50:
            raise ValueError("Zero hash unexpectedly requested a rig")
        if address == self.orientation_callback:
            assert first == self.effect
            self.transform_lanes.append("orientation")
            self.return_value(self.model_values)
        elif address == self.position_callback:
            assert first == self.effect
            self.transform_lanes.append("position")
            self.return_value(self.model_values + 12)
        elif address == self.bind_callback:
            assert first == self.effect
            self.bound_provider = self.read(second, 8)
            self.return_value(0)
        elif address == self.model_service_callback:
            assert first == self.parent_object + 0xB28
            self.return_value(self.model)
        elif rva == 0xD2E70:
            assert first == self.parent_object
            self.return_value(0)
        elif rva == 0xC1AC0:
            assert first == self.parent_object
            self.return_value(1)
        elif rva == 0x565340:
            assert second == self.model
            self.return_value(first)
        elif rva == 0x566A30:
            assert first == self.bound_provider
            self.return_value(self.model)
        else:
            assert rva == 0x565530
            self.return_value(1)

    def root_controls(self, descriptor):
        machine = self.machine
        self.transform_requests = []
        self.transform_lanes = []
        self.put_pointer(self.parent_object + 0xB28, self.effect_vtable)
        self.put_pointer(self.effect_vtable + 0xA0, self.model_service_callback)
        self.put_pointer(self.effect, self.effect_vtable)
        self.put_pointer(self.model + 0x18, self.effect)
        self.put_pointer(self.effect_vtable + 0x50, self.orientation_callback)
        self.put_pointer(self.effect_vtable + 0x68, self.position_callback)
        self.put_pointer(self.effect_vtable + 0x1F8, self.bind_callback)
        machine.mem_write(self.descriptor_address, bytes.fromhex(descriptor["raw"]))
        self.put_pointer(self.frame - 0x58, self.descriptor_address)
        shared_pair = self.frame - 0x90
        machine.reg_write(r.UC_X86_REG_RBP, self.frame)
        machine.reg_write(r.UC_X86_REG_RSP, self.frame - 0x240)
        machine.emu_start(self.image.base + 0x853E2F, self.image.base + 0x853E46, count=10_000)
        assert machine.reg_read(r.UC_X86_REG_RIP) == self.image.base + 0x853E46
        assert self.transform_requests == [(self.parent_object, 0)]
        provider = self.read(shared_pair, 8)
        assert self.read(provider + 0x30, 4) == 0
        assert self.read(provider + 0x38, 8) == self.parent_object + 0xB28
        self.bound_provider = 0
        self.put_pointer(self.frame - 0x170, provider)
        self.put_pointer(self.frame - 0x168, self.read(shared_pair + 8, 8))
        machine.reg_write(r.UC_X86_REG_R12, self.effect)
        machine.emu_start(self.image.base + 0x853EBC, self.image.base + 0x853EEF, count=10_000)
        assert machine.reg_read(r.UC_X86_REG_RIP) == self.image.base + 0x853EEF
        assert self.bound_provider == provider
        self.put_pointer(self.effect + 0x188, 0)
        machine.emu_start(self.image.base + 0x85430B, self.image.base + 0x854565, count=10_000)
        assert machine.reg_read(r.UC_X86_REG_RIP) == self.image.base + 0x854565
        assert self.read(self.effect + 0x200, 1) == 1
        fixed_target = struct.unpack("<3f", machine.mem_read(self.effect + 0x1A0, 12))
        assert fixed_target == descriptor["positions"][1]
        vtable = self.read(provider, 8)
        position_method = self.read(vtable + 0x140, 8) - self.image.base
        orientation_method = self.read(vtable + 0x20, 8) - self.image.base
        assert (position_method, orientation_method) == (0x567750, 0x566E00)
        controls = []
        for position, orientation in (
            ((641.0, 92.0, 933.0), (0.0, 0.0, 0.0)),
            ((-16.0, 23.5, 72.0), (0.0, 0.0, 0.0)),
            ((-16.0, 23.5, 72.0), (0.0, math.pi / 2, 0.0)),
        ):
            machine.mem_write(self.model_values, struct.pack("<6f", *orientation, *position))
            machine.mem_write(self.observed_matrix, struct.pack("<16f", *IDENTITY_MATRIX))
            self.call(position_method, provider, self.observed_position)
            assert machine.reg_read(r.UC_X86_REG_AL) == 1
            self.call(orientation_method, provider, self.observed_matrix)
            assert machine.reg_read(r.UC_X86_REG_AL) == 1
            assert self.transform_lanes[-2:] == ["position", "orientation"]
            assert struct.unpack("<3f", machine.mem_read(self.observed_position, 12)) == position
            matrix = struct.unpack("<16f", machine.mem_read(self.observed_matrix, 64))
            if orientation == (0.0, 0.0, 0.0):
                assert matrix == IDENTITY_MATRIX
            else:
                expected = (0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)
                assert all(abs(found - wanted) < 0.000001 for found, wanted in zip(matrix, expected, strict=True))
            controls.append(
                {
                    "actorPosition": position,
                    "actorEuler": orientation,
                    "retainedPosition": position,
                    "retainedRotation": matrix,
                }
            )
        return {"rootSampling": controls, "fixedTarget": fixed_target}

    def direction_control(self, descriptor):
        machine = self.machine
        machine.mem_write(self.frame - 0x240, bytes(0x240))
        machine.mem_write(self.descriptor_address, bytes.fromhex(descriptor["raw"]))
        self.put_pointer(self.frame - 0x58, self.descriptor_address)
        self.put_pointer(self.effect + 0x188, self.system)
        machine.reg_write(r.UC_X86_REG_R12, self.effect)
        machine.reg_write(r.UC_X86_REG_RBP, self.frame)
        machine.reg_write(r.UC_X86_REG_RSP, self.frame - 0x240)
        machine.emu_start(self.image.base + 0x854063, self.image.base + 0x854307, count=10_000)
        assert machine.reg_read(r.UC_X86_REG_RIP) == self.image.base + 0x854307
        assert self.read(self.system + 0x18, 1) & 0x40
        matrix = struct.unpack("<16f", machine.mem_read(self.system + 0x128, 64))
        assert matrix[12:16] == (0.0, 0.0, 0.0, 1.0)
        direction = descriptor["positions"][2]
        horizontal = math.hypot(direction[0], direction[2])
        sine, cosine = -direction[0] / horizontal, direction[2] / horizontal
        expected = (cosine, 0, sine, 0, 0, 1, 0, 0, -sine, 0, cosine, 0, 0, 0, 0, 1)
        assert all(abs(found - wanted) < 0.000001 for found, wanted in zip(matrix, expected, strict=True))
        return {"packetDirection": descriptor["positions"][2], "systemOrientation": matrix}

    def on_placement(self, machine, address, size, data):
        rva = address - self.image.base
        if rva in (0x866394, 0x866458):
            raise ValueError("Execution passed the requested descriptor boundary")
        caller = self.read(machine.reg_read(r.UC_X86_REG_RSP), 8) - self.image.base
        context = machine.reg_read(r.UC_X86_REG_ESI)
        self.requests.append([hex(rva), hex(caller), context])
        value = 0
        if caller == 0x864EA8:
            value = self.parent_object * self.resolve_parent
        elif caller == 0x864DB1:
            value = self.owner_object
        self.return_value(value)

    def placement_control(self, group, entry, resolved):
        machine = self.machine
        grid = code["GRID"]
        for offset, value in zip((0xBC, 0xC4, 0xDC, 0xE4), code["MAP_BOUNDS_XZ"], strict=True):
            machine.mem_write(grid + offset, struct.pack("<f", value))
        machine.reg_write(r.UC_X86_REG_R12, grid)
        self.call(0x16DB78C, end=self.image.base + 0x16DB7E9)
        self.requests = []
        self.resolve_parent = resolved
        end = self.image.base + self.descriptor_boundary if resolved else code["STOP"]
        self.call(0x864BE0, group, entry, end=end)
        if not resolved:
            return {"requests": self.requests}
        start = machine.reg_read(r.UC_X86_REG_RBP) - 0x198
        data = machine.mem_read(start, 0xC0)
        return {
            "requests": self.requests,
            "descriptor": {
                "fields": {
                    hex(at): struct.unpack_from("<I", data, at)[0] for at in (8, 0x48, 0x4C, 0x50, 0x9C, 0xA0, 0xA4)
                },
                "parentPointer": struct.unpack_from("<Q", data, 0x20)[0],
                "positions": [struct.unpack_from("<3f", data, at) for at in (0x54, 0x60, 0x6C)],
                "scaleRate": struct.unpack_from("<2f", data, 0x78),
                "raw": data.hex(),
            },
        }


def read_pinned_json(path, expected):
    raw = path.read_bytes()
    if sha256(raw).hexdigest() != expected:
        raise ValueError(f"Unexpected SHA-256 for {path}")
    return json.loads(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("catalog", type=Path)
    args = parser.parse_args()
    if not __debug__:
        raise RuntimeError("The probe requires Python assertions")
    catalog = read_pinned_json(args.catalog, CATALOG_SHA256)
    corpus = read_pinned_json(args.corpus, CORPUS_SHA256)
    assert [(row[1], row[0]) for row in corpus["packets"]] == sorted((row[1], row[0]) for row in corpus["packets"])
    for key, expected in (
        ("replaySha256", code["REPLAY_SHA256"]),
        ("protocol", code["PROTOCOL"]),
        ("build", code["CURRENT_BUILD"]),
    ):
        assert catalog[key] == corpus[key] == expected
    raw = args.archive.read_bytes()
    assert sha256(raw).hexdigest() == catalog["executableSha256"] == code["CURRENT_ARCHIVE_SHA256"]
    targets = defaultdict(list)
    for row in catalog["events"]:
        if row["kind"] == "create" and row["parent"]:
            targets[row["sequence"]].append(row)
    reader = AttachmentProbe(code["read_replication_image"](raw, catalog["build"]))
    reader.install_transform_controls()
    results = []
    for stamp, ordinal, context, encoded in corpus["packets"]:
        if ordinal not in targets:
            continue
        payload = bytes.fromhex(encoded)
        entries = {}
        for group in reader.decode(payload, context):
            key = reader.field(group + 0x30, reader.key)
            for entry in reader.entries(group):
                handle = reader.field(entry + 0x98, reader.handle)
                assert (key, handle) not in entries
                entries[key, handle] = (group, entry)
        for row in targets.pop(ordinal):
            assert (stamp, context, sha256(payload).hexdigest()) == (row["stamp"], row["context"], row["packetSha256"])
            group, entry = entries[row["resourceKey"], row["handle"]]
            assert reader.field(entry + 0x70, reader.owner) == row["owner"]
            assert reader.field(entry + 0xA0, reader.parent) == row["parent"]
            resolved = reader.placement_control(group, entry, True)
            assert resolved["descriptor"]["fields"]["0x8"] == row["resourceKey"]
            assert resolved["descriptor"]["parentPointer"] == reader.parent_object
            assert resolved["requests"][:3] == [
                ["0x558830", "0x864d10", row["handle"]],
                ["0x5564c0", "0x864db1", row["owner"]],
                ["0x5564c0", "0x864ea8", row["parent"]],
            ]
            missing = reader.placement_control(group, entry, False)
            result = {**row, "packetDescriptorControl": resolved, "missingParentControl": missing}
            if row["handle"] == 1073821135:
                assert row["definitionKey"] == "monkeyking-0:8d725930"
                assert row["parentChampion"] == {"context": 1073742167, "champion": "MonkeyKing", "skinId": 0}
                descriptor = resolved["descriptor"]
                flags, primary, secondary = (descriptor["fields"][field] for field in ("0x48", "0x4c", "0x50"))
                assert (flags, primary, secondary, descriptor["positions"][2]) == (32, 0, 0, (0, 0, 0))
                result["retainedRootControls"] = reader.root_controls(resolved["descriptor"])
            if row["handle"] == 1073821521:
                assert row["definitionKey"] == "leesin-11:4efd5d63"
                assert row["parentChampion"] == {"context": 1073742169, "champion": "Kaisa", "skinId": 15}
                descriptor = resolved["descriptor"]
                flags, primary, secondary = (descriptor["fields"][field] for field in ("0x48", "0x4c", "0x50"))
                assert (flags, primary, secondary) == (16, 0x0AC0F283, 0)
                result["directionControl"] = reader.direction_control(resolved["descriptor"])
            results.append(result)
    assert not targets
    assert len(results) == 391
    assert sum("retainedRootControls" in row for row in results) == 1
    assert sum("directionControl" in row for row in results) == 1
    print(
        json.dumps(
            {
                "build": catalog["build"],
                "protocol": catalog["protocol"],
                "replaySha256": catalog["replaySha256"],
                "executableSha256": catalog["executableSha256"],
                "corpusSha256": CORPUS_SHA256,
                "catalogSha256": CATALOG_SHA256,
                "probeSha256": sha256(Path(__file__).read_bytes()).hexdigest(),
                "archiveReaderSha256": sha256(SOURCE_PATH.read_bytes()).hexdigest(),
                "events": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
