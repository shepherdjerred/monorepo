"""Hold an OS advisory lock until the owning Node process closes its pipe."""

import fcntl
import os
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(2)
    descriptor = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(3) from None
        sys.stdout.write("locked\n")
        sys.stdout.flush()
        # EOF is delivered even when the parent is killed without running finally.
        sys.stdin.buffer.read()
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    main()
