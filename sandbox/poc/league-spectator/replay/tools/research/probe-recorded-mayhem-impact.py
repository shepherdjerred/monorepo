"""Observe the recorded Mayhem impact's native birth and quad geometry."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

FULL_MATCH_CONTROL_ORDINALS = {0, 250, 674, 1100, 1900, 2147}


def checked_bytes(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"Original impact input differs: {path}")
    return data


def configure_spawn_shape(fields, call, put, shape, scratch):
    # Shape registration 0x1733a47 identifies the two arrays and their offsets.
    assert set(fields) == {"07f41838", "d1789c65"}
    angles = fields["07f41838"]["elements"]
    axes = fields["d1789c65"]["elements"]
    assert len(angles) == len(axes) == 2
    call(0x17C55F0, shape)
    angle_data = scratch
    axis_data = scratch + 0x80
    put(shape + 0x20, "QII", angle_data, len(angles), len(angles))
    put(shape + 0x30, "QII", axis_data, len(axes), len(axes))
    for index, (angle, axis) in enumerate(zip(angles, axes, strict=True)):
        node = scratch + 0x100 + index * 0x180
        probability = node + 0x60
        call(0x17AFB80, node)
        curve = angle["fields"]["bc037de7"]["fields"]
        [distribution] = curve["a7084719"]["elements"]
        times = [v["value"] for v in distribution["fields"]["40c351da"]["elements"]]
        values = [v["value"] for v in distribution["fields"]["e44b7382"]["elements"]]
        assert len(times) == len(values) == 2
        [curve_time] = curve["5d68eeb5"]["elements"]
        [curve_value] = curve["34474c3b"]["elements"]
        put(node + 8, "Q", probability)
        put(node + 0x10, "QII", node + 0x120, 1, 1)
        put(node + 0x20, "QII", node + 0x124, 1, 1)
        put(node + 0x120, "2f", curve_time["value"], curve_value["value"])
        put(probability, "QII", probability + 0x40, len(times), len(times))
        put(probability + 0x10, "QII", probability + 0x48, len(values), len(values))
        put(probability + 0x40, "2f", *times)
        put(probability + 0x48, "2f", *values)
        put(probability + 0x25, "B", 1)
        call(0x1701800, node)
        put(angle_data + index * 16, "f", angle["fields"]["b4b427aa"]["value"])
        put(angle_data + index * 16 + 8, "Q", node)
        put(axis_data + index * 12, "3f", *(axis["value"][lane] for lane in "XYZ"))


def configure_point_shape(fields, call, put, shape, _scratch):
    assert set(fields) == {"e5f268dd"}
    offset = fields["e5f268dd"]["value"]
    call(0x17C59D0, shape)
    put(shape + 8, "3f", *(offset[lane] for lane in "XYZ"))


def read_repeated_flash(original, inventory_path, stop_path, full_match):
    inventory_sha256, stop_sha256, placement_count = (
        (
            "3dd85bb866a6699d3e4b3e1f76ca712a9e468aaf5adfafacc7b0f279f6a4c90f",
            "3b3f7f7887767980a80183070a9f3b5f94544ef8b101e0c9b38bd7f9d5c70d99",
            2148,
        ) if full_match else (
            "75f6b56c4fd7bfbc7a08b50e004b1ff008264bf6951f1e7695a2931a2956bcf2",
            "1a5325b1f52a5629d555ffecf13f413549530e1b8f2fd2d2d1723ddcd8dc45e8",
            28,
        )
    )
    inventory = json.loads(checked_bytes(inventory_path, inventory_sha256))
    stops = json.loads(checked_bytes(stop_path, stop_sha256))
    for field in ("build", "protocol", "replaySha256"):
        assert inventory[field] == original[field]
    assert stops["replaySha256"] == original["replaySha256"]
    assert stops["inventorySha256"] == inventory_sha256
    assert not stops["matching"]

    # Character resource resolver: Miss Fortune skin 21's E hit dirt.
    entries = [
        entry for entry in inventory["events"]
        if entry["owner"] == 1073741897 and entry["resourceKey"] == 2132659164
    ]
    assert len(entries) == len({entry["handle"] for entry in entries}) == placement_count
    assert stops["targetHandles"] == sorted(entry["handle"] for entry in entries)
    if full_match:
        assert stops["requestedStopPackets"] == 94373
        assert stops["events"] == entries
    else:
        assert len({entry["sequence"] for entry in entries}) == 14
    assert stops["first"] == entries[0]["stamp"]
    assert stops["last"] >= entries[-1]["stamp"] + 0.6500000357627869
    placements = []
    for entry in entries:
        assert entry["parent"] == 0 and entry["status"] == "detached-placement-confirmed"
        descriptor = entry["descriptor"]
        assert descriptor["flags"] == 32 and descriptor["scaleRate"] == [1, 1]
        placements.append({
            "handle": entry["handle"],
            "owner": entry["owner"],
            "position": descriptor["positions"][0],
            "flags": descriptor["flags"],
            "scaleRate": descriptor["scaleRate"],
            "timeSeconds": entry["stamp"],
            "sequence": entry["sequence"],
            "packetSha256": entry["packetSha256"],
        })
    by_handle = {placement["handle"]: placement for placement in placements}
    for prior in original["placements"]:
        assert by_handle[prior["handle"]] == {
            **prior,
            "timeSeconds": original["packet"]["time"],
            "sequence": original["packet"]["sequence"],
            "packetSha256": original["packet"]["payloadSha256"],
        }
    return placements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "source_receipt", "typed_effect", "texture"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--geometry", action="store_true")
    parser.add_argument("--component", choices=("flash", "maokai-sphere"), default="flash")
    parser.add_argument("--repeat-flash-inventory", type=Path)
    parser.add_argument("--repeat-flash-stop-window", type=Path)
    parser.add_argument("--full-match-flash", action="store_true")
    args = parser.parse_args()
    if not __debug__:
        raise RuntimeError("Run this probe with Python assertions enabled")

    harness_path = Path(__file__).with_name("probe-recorded-detached-quad-expiry.py")
    spec = importlib.util.spec_from_file_location("detached_quad_probe", harness_path)
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)

    archive_sha = "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
    if args.component == "flash":
        source_sha = "12eff6675a2a8b86ee51290c724fca394d42aadffddfd41c638017790c6958f3"
        typed_sha = "abb416ee3c2f3ceba9de8b7ba107df530be5ee6f981c29c4d1ff52e5a3f722bd"
        effect, index, name, scale = "e70b381c", 1, "Flash", 1
        configure_shape = configure_spawn_shape
    else:
        source_sha = "2c9bd39530461371932a7c5452cb0c29e46141991b9aa73666b33d7e520d3ee6"
        typed_sha = "6523d669544243fd2bd1cd8669cd8bd18dc1941024adf3a9a0e3375407a8d6b1"
        effect, index, name, scale = "81229b71", 8, "Sphere_core", 1.25
        configure_shape = configure_point_shape
    original = json.loads(checked_bytes(args.source_receipt, source_sha))
    repeated = args.repeat_flash_inventory is not None or args.repeat_flash_stop_window is not None
    if args.full_match_flash and not repeated:
        parser.error("Full-match Flash requires the full create inventory and stop window")
    if repeated and (
        args.component != "flash" or not args.geometry
        or args.repeat_flash_inventory is None or args.repeat_flash_stop_window is None
    ):
        parser.error("Repeated Flash requires both original controls and Flash geometry")
    placements = (
        read_repeated_flash(original, args.repeat_flash_inventory, args.repeat_flash_stop_window, args.full_match_flash)
        if repeated else original["placements"]
    )
    typed = json.loads(checked_bytes(args.typed_effect, typed_sha))
    texture_sha = original["emitter"]["textureSha256"]
    checked_bytes(args.texture, texture_sha)
    image = harness.read_replication_image(
        checked_bytes(args.archive, archive_sha), harness.CURRENT_BUILD
    )
    fields = typed["fields"]["868eb76a"]["elements"][index]["fields"]
    assert typed["pathHash"] == effect
    assert fields["3d25b8ce"]["value"] == name
    assert fields["3c6468f4"]["value"] == original["emitter"]["texture"]

    observations = []
    for ordinal, placement in enumerate(placements):
        assert placement["flags"] == 32 and placement["scaleRate"] == [scale, 1]
        event = {"descriptor": {
            "positions": [placement["position"]],
            "scaleRate": placement["scaleRate"],
        }}
        cameras = ((5900, 1500, 6200), (6150, 1700, 5950)) if args.geometry else (None,)
        if args.full_match_flash and ordinal not in FULL_MATCH_CONTROL_ORDINALS:
            controls = [(120, 0.125, cameras[0])]
        else:
            controls = [(cadence, sample, camera)
                        for cadence in (60, 120)
                        for sample in (0.125, 0.875)
                        for camera in cameras]
        for cadence, supplied_random, camera in controls:
            observations.append({
                "handle": placement["handle"],
                "cameraControl": camera,
                **harness.run(
                    image, event, fields, cadence, supplied_random, camera,
                    observe_delay_only=not args.geometry,
                    configure_impact_shape=configure_shape if args.geometry else None,
                ),
            })

    print(json.dumps({
        "schema": 1,
        "kind": "recorded-mayhem-impact-native-geometry" if args.geometry else "recorded-mayhem-impact-native-delay",
        "build": original["build"],
        "protocol": original["protocol"],
        "replaySha256": original["replaySha256"],
        "sourceReceiptSha256": source_sha,
        "typedEffectSha256": typed_sha,
        "textureSha256": texture_sha,
        "originalUpdateRva": 0x1786280,
        "originalBirthHelperRva": 0x1789DF0,
        "observations": observations,
        **({"repeatedPlacements": placements} if repeated else {}),
        **({"fullMatchFlash": True} if args.full_match_flash else {}),
        "scope": {
            "suppliedUpdateCadence": True,
            "suppliedRandomSamples": True,
            "originalBirthHelperReached": True,
            "particleInserted": args.geometry,
            "geometryObserved": args.geometry,
            "browserDrawSubmitted": False,
        },
    }))


if __name__ == "__main__":
    main()
