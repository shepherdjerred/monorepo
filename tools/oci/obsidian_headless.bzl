"""OCI image for obsidian-headless.

obsidian-headless v0.0.7+ requires better-sqlite3 (native module) which is
not supported by Bun. The image uses node:22-slim as the runtime.

This image is built and pushed manually via Docker, not through Bazel:

    docker build --platform linux/amd64 \\
        -t ghcr.io/shepherdjerred/obsidian-headless:TAG \\
        -f tools/oci/Dockerfile.obsidian-headless .
    docker push ghcr.io/shepherdjerred/obsidian-headless:TAG

The Bazel targets below are kept for reference but may not work without
Docker available in the sandbox.
"""

def obsidian_headless_image(name, visibility = None):
    """Placeholder for obsidian-headless image targets.

    The actual image is built via Docker (see module docstring).
    Only the push target is defined for CI integration.

    Args:
      name: name for targets.
      visibility: Bazel visibility.
    """

    # No-op build target — image is built externally via Docker
    native.filegroup(
        name = name,
        srcs = [],
        tags = ["manual"],
        visibility = visibility,
    )

    native.filegroup(
        name = name + "_push",
        srcs = [],
        tags = ["manual"],
        visibility = visibility,
    )
