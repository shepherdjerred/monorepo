"""OCI image for obsidian-headless: installs the package globally via bun.

The genrule uses bare `bun` because the target is tagged `manual` and runs
locally. The container's own bun base provides bun at runtime, and the
genrule relies on a system bun during the build step.
"""

load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

def obsidian_headless_image(name, visibility = None):
    """Build an OCI image that runs obsidian-headless CLI.

    Installs obsidian-headless globally via bun on an oven/bun:slim base.
    Currently tagged manual — requires local bun for the build step.

    Args:
      name: name for the oci_image target.
      visibility: Bazel visibility for the image and push targets.
    """

    # Layer with globally-installed obsidian-headless.
    # hermeticity-exempt: uses system bun because Bazel toolchain doesn't expose a global install command
    native.genrule(
        name = name + "_bun_layer",
        outs = [name + "_bun_layer.tar"],
        cmd = """
            EXECROOT=$$PWD && \
            OUTPUT_TAR=$$EXECROOT/$@ && \
            TMPDIR=$$(mktemp -d) && \
            trap 'rm -rf $$TMPDIR' EXIT && \
            cd $$TMPDIR && \
            # renovate: datasource=npm depName=obsidian-headless
            BUN_INSTALL=$$TMPDIR/usr/local bun add --global obsidian-headless@0.0.7 && \
            (tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf $$OUTPUT_TAR -C $$TMPDIR usr/local 2>/dev/null || tar -cf $$OUTPUT_TAR -C $$TMPDIR usr/local)
        """,
        local = True,
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
        base = "@bun_slim",
        tars = [
            ":" + name + "_bun_layer",
            ":" + name + "_vault_layer",
        ],
        entrypoint = ["/bin/sh", "-c"],
        cmd = ['ob sync-setup --vault "$OBSIDIAN_VAULT_NAME" --password "$OBSIDIAN_VAULT_PASSWORD" --path /vault && while true; do rm -rf /vault/.obsidian/.sync.lock; ob sync --continuous --path /vault; echo "Sync exited, retrying in 10s..."; sleep 10; done'],
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
