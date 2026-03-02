"""OCI image for obsidian-headless: installs the npm package on node:22-slim.

The genrule uses bare `npm` because the monorepo's Node.js toolchain is Bun
(which doesn't include npm). This target is tagged `manual` so it only runs
when explicitly requested. The container's own node:22-slim base provides npm
at runtime, and the genrule relies on a system npm during the build step.
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
    native.genrule(
        name = name + "_npm_layer",
        outs = [name + "_npm_layer.tar"],
        cmd = """
            EXECROOT=$$PWD && \
            OUTPUT_TAR=$$EXECROOT/$@ && \
            TMPDIR=$$(mktemp -d) && \
            trap 'rm -rf $$TMPDIR' EXIT && \
            cd $$TMPDIR && \
            npm install --global --prefix $$TMPDIR/usr/local obsidian-headless@0.0.4 && \
            (tar --sort=name --mtime='1970-01-01 00:00:00' --owner=0 --group=0 --numeric-owner -cf $$OUTPUT_TAR -C $$TMPDIR usr/local 2>/dev/null || tar -cf $$OUTPUT_TAR -C $$TMPDIR usr/local)
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
