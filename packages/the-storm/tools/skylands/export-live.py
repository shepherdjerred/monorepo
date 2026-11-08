"""Export via native save-off/flush/save-on, without requiring a prerequisite image deployment."""

import argparse
import importlib
import json
import os
import re
import subprocess
import sys
import tarfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
KUBE = ["kubectl", "exec", "-n", "minecraft-tsmc", "minecraft-tsmc-0", "-c", "minecraft-tsmc", "--"]
exec_prefix = KUBE


def console(command: str) -> str:
    env = {key: value for key, value in os.environ.items() if key != "OP_SERVICE_ACCOUNT_TOKEN"}
    result = subprocess.run(
        [*exec_prefix, "rcon-cli", *command.split()], check=True, capture_output=True, text=True, timeout=120, env=env
    )
    return result.stdout.strip()


def main(output: Path) -> None:
    output = output.resolve()
    if output.exists():
        raise ValueError("Refusing to reuse an export directory")
    players = console("list")
    if not players.startswith("There are 0 of a max of "):
        raise ValueError("Export requires no connected players")
    output.mkdir(parents=True, mode=0o700)
    archive = output / "skylands-export.tar"
    restore_saving = False
    try:
        # Restore saving even if the response is lost after applying save-off.
        restore_saving = True
        response = console("save-off")
        if "already" in response.lower():
            restore_saving = False
            raise ValueError("Saving was already disabled; another operation may own it")
        if "disabled" not in response.lower() and "turned off" not in response.lower():
            raise ValueError("Unexpected save-off response: " + response)
        response = console("save-all flush")
        if "Saved the game" not in response:
            raise ValueError("Save flush did not confirm completion: " + response)
        script = (PACKAGE / "server/maintenance/skylands_stream.py").read_text()
        env = {key: value for key, value in os.environ.items() if key != "OP_SERVICE_ACCOUNT_TOKEN"}
        with archive.open("xb") as target, (output / "export-stderr.log").open("x") as errors:
            subprocess.run(
                [*exec_prefix, "python3", "-c", script, "--data", "/data"],
                stdout=target,
                stderr=errors,
                check=True,
                timeout=1800,
                env=env,
            )
    finally:
        if restore_saving:
            response = console("save-on")
            if "enabled" not in response.lower() and "turned on" not in response.lower():
                raise ValueError("Saving restoration did not confirm completion: " + response)
            print("Automatic saving is enabled.", flush=True)
    with tarfile.open(archive) as source:
        source.extractall(output, filter="data")
    payload = output / "payload"
    # The operator entry point lives outside the server's Python import root.
    sys.path.insert(0, str(PACKAGE / "server"))
    transfer = importlib.import_module("maintenance.skylands_transfer")
    manifest = transfer.validate_payload(payload)
    receipt = json.loads((output / "export.json").read_text())
    if receipt != {"schemaVersion": 1, "files": manifest}:
        raise ValueError("Extracted files differ from verified export")
    print(
        json.dumps({"payload": str(payload), "files": len(manifest), "digest": transfer.manifest_digest(manifest)}),
        flush=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--confirm-live-export", action="store_true")
    parser.add_argument("--sandbox", help="Local mc-harness Docker container instead of production")
    arguments = parser.parse_args()
    if arguments.sandbox is not None:
        if arguments.confirm_live_export or not re.fullmatch(r"mc-harness-sbx-[a-z0-9]{6}", arguments.sandbox):
            parser.error("Choose an exact local sandbox container, without --confirm-live-export")
        exec_prefix = ["docker", "exec", arguments.sandbox]
    elif not arguments.confirm_live_export:
        parser.error("Production exports require --confirm-live-export")
    main(arguments.output)
