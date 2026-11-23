"""Compare authored replay-control handles to original published object bytes.

This verifies field binding only. A partially completed native resource load is
not widget readiness, event-service admission or a rendered HUD proof.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native_receipt", "authored_json", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    own = Path(__file__).read_bytes()
    native_raw, authored_raw = args.native_receipt.read_bytes(), args.authored_json.read_bytes()
    native, authored = json.loads(native_raw), json.loads(authored_raw)
    original = args.authored_json.with_suffix(".bin").read_bytes()
    if (digest(original) != authored["tree"]["sourceSha256"] or
            authored["file"] != "gameplay.replaycontrols.bin" or
            not native["archive"]["originalSignatureValidationCompleted"]):
        raise ValueError("Signed original replay UI and exact authored input required")
    controllers = native["ownedSerializedControllers"]
    if len(controllers) != 1:
        raise ValueError("One original published replay controller required")
    controller = controllers[0]
    if controller["publicationGlobalRva"] != 0x24723C0 or controller["vtableRva"] != 0x23A9310:
        raise ValueError("Original replay controller publication/class differs")
    data = bytes.fromhex(controller["originalObjectHex"])
    if len(data) != 0x7E8:
        raise ValueError("Complete original replay controller object required")
    fields = authored["normalized"]["{788bc62d}"]
    rows = []
    for name, offset in [("Record.Button", 0x1E0), ("Play.Button", 0x238),
                         ("SpeedUp.Button", 0x290), ("SpeedDown.Button", 0x2E8),
                         ("SkipBack.Button", 0x340), ("SceneHandle", 0x6B0),
                         ("PlaybackSpeedTextHandle", 0x720)]:
        value = fields
        for key in name.split("."):
            value = value[key]
        if not isinstance(value, str) or len(value) != 10 or value[0] != "{" or value[-1] != "}":
            raise ValueError("Authored handle is not an exact 32-bit hash")
        expected = int(value[1:-1], 16)
        actual = struct.unpack_from("<I", data, offset)[0]
        if expected != actual or controller["fields"][name] != actual:
            raise ValueError("Original parsed replay-controller handle differs: " + name)
        rows.append({"field": name, "offset": offset, "authoredHash": value, "originalValue": actual})
    inputs = {str(args.native_receipt): digest(native_raw), str(args.authored_json): digest(authored_raw),
              str(args.authored_json.with_suffix(".bin")): digest(original), str(Path(__file__)): digest(own)}
    for filename, expected in inputs.items():
        if digest(Path(filename).read_bytes()) != expected:
            raise ValueError("Controller comparison input changed during execution")
    report = {"schema": 1, "kind": "original-replay-controller-authored-handle-comparison", "inputs": inputs,
              "nativeLoadBoundary": native["boundary"], "comparisons": rows, "mismatches": 0,
              "scope": {"originalPublishedControllerFieldsVerified": True, "widgetReady": False,
                        "nativeEventServiceAdmitted": False, "renderedHudVerified": False}}
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "comparisons": len(rows), "mismatches": 0}))


if __name__ == "__main__":
    main()
