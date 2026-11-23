"""Observe original replay controls with an explicit existing ROFL launch input.

The retained archived-bootstrap and first registered-control observers remain
unchanged. Only the already recovered original launch-kind selection is added;
the supplied replay is not reported loaded, playable or selected as a spectator.
"""
import argparse
import hashlib
import importlib.util
import sys
from pathlib import Path

from unicorn import x86_const as r
from replay_client_configuration_native import initialize_replay_client_configuration

observer_path = Path(__file__).with_name("observe-native-registered-replay-controls.py")
spec = importlib.util.spec_from_file_location("launched_replay_base_observer", observer_path)
observer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = observer
spec.loader.exec_module(observer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["assets", "client", "installation", "fixture_cache", "replay", "output"]:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    replay = args.replay.resolve(strict=True)
    if not replay.is_file() or replay.suffix != ".rofl":
        raise ValueError("Explicit retained ROFL file required")
    with replay.open("rb") as source:
        replay_sha = hashlib.file_digest(source, "sha256").hexdigest()
    original_observe = observer.observe

    def observe_launched(n):
        try:
            observer.observations["replayLaunchInput"] = {"path": str(replay),
                "bytes": replay.stat().st_size, "sha256": replay_sha,
                "originalConfiguration": initialize_replay_client_configuration(n, replay.as_posix()),
                "replayFileLoaded": False}
        except Exception as error:
            observer.observations.update(phase="original-rofl-launch-selection",
                boundary={"phase": "original-rofl-launch-selection", "kind": type(error).__name__,
                    "message": str(error), "rva": n.u.reg_read(r.UC_X86_REG_RIP) - n.base})
            return
        original_observe(n)

    observer.observe = observe_launched
    saved = sys.argv
    try:
        sys.argv = [str(observer_path), str(args.assets), str(args.client),
            str(args.installation), str(args.fixture_cache), str(args.output)]
        observer.main()
    finally:
        sys.argv = saved
        with replay.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != replay_sha:
                raise ValueError("Explicit ROFL launch input changed during native observation")


if __name__ == "__main__":
    main()
