"""OCI image for obsidian-headless: installs the npm package on node:22-slim.

TODO(Phase 6): This genrule needs a real Node.js npm binary (not Bun).
Currently the node toolchain is Bun which doesn't include npm. Options:
1. Register a separate node toolchain for this one rule
2. Use a Docker-based build approach
3. Pre-build the layer outside Bazel
"""

load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

def obsidian_headless_image(name, visibility = None):
    """Build an OCI image that runs obsidian-headless CLI.

    Installs obsidian-headless globally via npm on a node:22-slim base.
    Currently tagged manual — requires npm which Bun toolchain doesn't provide.

    Args:
      name: name for the oci_image target.
      visibility: Bazel visibility for the image and push targets.
    """

    # Layer with globally-installed obsidian-headless.
    # TODO: Needs real npm, not Bun's node compatibility shim.
    native.genrule(
        name = name + "_npm_layer",
        outs = [name + "_npm_layer.tar"],
        cmd = """\\\r
            EXECROOT=$$PWD && \\\r
            OUTPUT_TAR=$$EXECROOT/$@ && \\\r
            TMPDIR=$$(mktemp -d) && \\\r
            trap 'rm -rf $$TMPDIR' EXIT && \\\r
            cd $$TMPDIR && \\\r
            npm install --global --prefix $$TMPDIR/usr/local obsidian-headless 2>/dev/null && \\\r
            tar -cf $$OUTPUT_TAR -C $$TMPDIR usr/local \\\r
        """,
        tags = ["requires-network", "manual"],
    )

    # Vault directory layer
    pkg_tar(
        name = name + "_vault_layer",
        srcs = [],
        empty_dirs = ["/vault"],
        tags = ["manual"],
    )

    oci_image(
        name = name,
        base = "@node_slim",
        tars = [
            ":" + name + "_npm_layer",
            ":" + name + "_vault_layer",
        ],
        entrypoint = ["/bin/sh", "-c"],
        cmd = ['ob sync-setup --vault "$OBSIDIAN_VAULT_NAME" --password "$OBSIDIAN_VAULT_PASSWORD" --path /vault && ob sync --continuous --path /vault'],
        labels = {
            "org.opencontainers.image.title": "obsidian-headless",
            "org.opencontainers.image.description": "Obsidian Headless CLI for syncing vaults from the command line",
            "org.opencontainers.image.source": "https://github.com/shepherdjerred/monorepo",
        },
        tags = ["manual"],
        visibility = visibility,
    )

    oci_push(
        name = name + "_push",
        image = ":" + name,
        repository = "ghcr.io/shepherdjerred/obsidian-headless",
        tags = ["manual"],
        visibility = visibility,
    )
