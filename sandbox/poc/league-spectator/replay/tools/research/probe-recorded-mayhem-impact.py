"""Observe the recorded Mayhem impact's native birth and quad geometry."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "source_receipt", "typed_effect", "texture"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--geometry", action="store_true")
    args = parser.parse_args()
    if not __debug__:
        raise RuntimeError("Run this probe with Python assertions enabled")

    harness_path = Path(__file__).with_name("probe-recorded-detached-quad-expiry.py")
    spec = importlib.util.spec_from_file_location("detached_quad_probe", harness_path)
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)

    archive_sha = "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
    source_sha = "12eff6675a2a8b86ee51290c724fca394d42aadffddfd41c638017790c6958f3"
    typed_sha = "abb416ee3c2f3ceba9de8b7ba107df530be5ee6f981c29c4d1ff52e5a3f722bd"
    original = json.loads(checked_bytes(args.source_receipt, source_sha))
    typed = json.loads(checked_bytes(args.typed_effect, typed_sha))
    texture_sha = original["emitter"]["textureSha256"]
    checked_bytes(args.texture, texture_sha)
    image = harness.read_replication_image(
        checked_bytes(args.archive, archive_sha), harness.CURRENT_BUILD
    )
    fields = typed["fields"]["868eb76a"]["elements"][1]["fields"]
    assert typed["pathHash"] == "e70b381c"
    assert fields["3d25b8ce"]["value"] == "Flash"
    assert fields["3c6468f4"]["value"] == original["emitter"]["texture"]

    observations = []
    for placement in original["placements"]:
        assert placement["flags"] == 32 and placement["scaleRate"] == [1, 1]
        event = {"descriptor": {
            "positions": [placement["position"]],
            "scaleRate": placement["scaleRate"],
        }}
        for cadence in (60, 120):
            for supplied_random in (0.125, 0.875):
                cameras = ((5900, 1500, 6200), (6150, 1700, 5950)) if args.geometry else (None,)
                for camera in cameras:
                    observations.append({
                        "handle": placement["handle"],
                        "cameraControl": camera,
                        **harness.run(
                            image, event, fields, cadence, supplied_random, camera,
                            observe_delay_only=not args.geometry,
                            configure_impact_shape=configure_spawn_shape if args.geometry else None,
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
