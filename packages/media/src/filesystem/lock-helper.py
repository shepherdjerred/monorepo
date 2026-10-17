"""Hold an OS advisory lock until the owning Node process closes its pipe."""

import fcntl
import json
import os
import resource
import sys


def lock_paths() -> list[str]:
    if len(sys.argv) != 2:
        raise SystemExit(2)
    if sys.argv[1] != "--batch":
        return [sys.argv[1]]
    raw = sys.stdin.buffer.readline(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024 or not raw.endswith(b"\n"):
        raise SystemExit(2)
    paths = json.loads(raw)
    if (
        not isinstance(paths, list)
        or not 1 <= len(paths) <= 128
        or any(not isinstance(path, str) or not path or "\0" in path for path in paths)
        or len(set(paths)) != len(paths)
    ):
        raise SystemExit(2)
    # Only this disposable child changes its soft limit, never its hard limit.
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    needed = len(paths) + 16
    if soft != resource.RLIM_INFINITY and soft < needed:
        if hard != resource.RLIM_INFINITY and hard < needed:
            raise SystemExit(2)
        resource.setrlimit(resource.RLIMIT_NOFILE, (needed, hard))
    return paths


def main() -> None:
    descriptors: list[int] = []
    try:
        for path in lock_paths():
            descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            descriptors.append(descriptor)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SystemExit(3) from None
        sys.stdout.write("locked\n")
        sys.stdout.flush()
        # EOF is delivered even when the parent is killed without running finally.
        sys.stdin.buffer.read()
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


if __name__ == "__main__":
    main()
