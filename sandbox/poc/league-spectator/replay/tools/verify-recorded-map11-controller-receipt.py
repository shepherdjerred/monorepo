"""Recompute same-build Map11 visibility from the saved packet stream."""

import argparse
import importlib
import json
import subprocess
from hashlib import sha256
from pathlib import Path

controller = importlib.import_module("probe-exact-map11-controllers")
ARCHIVE = "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
ARCHIVE_8428 = "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7"
NAVGRID = "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9"


def verify(replay, geometry, materials, archive, navgrid, *, exact_8428=False, animation_diagnostics=None):
    archive_bytes, navgrid_bytes = archive.read_bytes(), navgrid.read_bytes()
    expected_archive = ARCHIVE_8428 if exact_8428 else ARCHIVE
    if sha256(archive_bytes).hexdigest() != expected_archive or sha256(navgrid_bytes).hexdigest() != NAVGRID:
        raise ValueError("Wrong archived executable or authored Map11 navgrid")
    extractor = Path(__file__).with_name("extract-exact-map11-controller-inputs.mjs")
    mode = "--exact-8428" if exact_8428 else "--same-build"
    extracted = subprocess.run(
        ["bun", str(extractor), str(replay), str(geometry), str(materials), "-", mode],
        check=True,
        stdout=subprocess.PIPE,
    )
    return controller.evaluate(
        json.loads(extracted.stdout),
        archive_bytes,
        navgrid_bytes,
        validate_replay=True,
        animation_diagnostics=animation_diagnostics,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("replay", "geometry", "materials", "archive", "navgrid", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--expect", type=Path)
    parser.add_argument("--exact-8428", action="store_true")
    parser.add_argument(
        "--animation-diagnostics",
        type=Path,
        help="Private .8428 verification only: omit unverified animation windows and record their snapshot boundaries",
    )
    args = parser.parse_args()
    if args.animation_diagnostics is not None and (
        not args.exact_8428
        or args.animation_diagnostics.resolve() == args.output.resolve()
        or args.animation_diagnostics.exists()
    ):
        parser.error("--animation-diagnostics requires --exact-8428 and a separate new output path")
    animation = [] if args.animation_diagnostics is not None else None
    receipt = verify(
        args.replay,
        args.geometry,
        args.materials,
        args.archive,
        args.navgrid,
        exact_8428=args.exact_8428,
        animation_diagnostics=animation,
    )
    encoded = json.dumps(receipt, indent=2, allow_nan=False)
    if args.expect is not None and encoded != args.expect.read_text(encoding="utf8"):
        raise ValueError("Carried terrain visibility receipt differs from the native replay result")
    with args.output.open("x", encoding="utf8") as output:
        output.write(encoded)
    if args.animation_diagnostics is not None:
        with args.animation_diagnostics.open("x", encoding="utf8") as output:
            json.dump(
                {
                    "replaySha256": receipt["replaySha256"],
                    "build": receipt["build"],
                    "archiveSha256": ARCHIVE_8428,
                    "unsupportedAnimatedWrites": animation,
                },
                output,
                indent=2,
                allow_nan=False,
            )


if __name__ == "__main__":
    main()
