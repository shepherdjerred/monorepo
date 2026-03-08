"""Astro check macro using local Starlark rule.

Runs `bunx astro check` for Astro packages. Uses local = True because
astro check needs to resolve virtual modules (astro:content, etc.)
that are only available through the Astro build pipeline.

This replaces manual typecheck targets on Astro packages where tsc
cannot resolve virtual modules in the Bazel sandbox.
"""

def _astro_check_impl(ctx):
    stamp = ctx.actions.declare_file(ctx.attr.name + ".stamp")
    pkg_path = ctx.label.package
    marker = ctx.file.marker
    bun = ctx.file._bun

    ctx.actions.run_shell(
        outputs = [stamp],
        inputs = [marker, bun],
        command = """
            set -euo pipefail
            # Save the execroot so we can resolve output paths after cd
            EXECROOT="$PWD"
            STAMP_FILE="$EXECROOT/{stamp_path}"
            # Set up bun in PATH (bunx is a bun subcommand)
            BUN_DIR=$(dirname $(readlink -f '{bun_path}'))
            export PATH="$BUN_DIR:/bin:/usr/bin:/usr/local/bin"
            export HOME="${{TMPDIR:-/tmp}}"
            # Resolve the real workspace directory from the marker file symlink
            MARKER_REAL=$(readlink -f '{marker_path}')
            WORKSPACE_DIR=$(echo "$MARKER_REAL" | sed 's|/{pkg_path}/BUILD.bazel$||')
            cd "$WORKSPACE_DIR/{pkg_path}"
            bun x astro check
            touch "$STAMP_FILE"
        """.format(
            bun_path = bun.path,
            marker_path = marker.path,
            pkg_path = pkg_path,
            stamp_path = stamp.path,
        ),
        execution_requirements = {
            "local": "1",
            "no-remote-cache": "1",
        },
        mnemonic = "AstroCheck",
        progress_message = "Running astro check for %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([stamp]))]

_astro_check_rule = rule(
    implementation = _astro_check_impl,
    attrs = {
        "marker": attr.label(
            allow_single_file = True,
            mandatory = True,
        ),
        "_bun": attr.label(
            default = "//tools/bun",
            allow_single_file = True,
            executable = True,
            cfg = "exec",
        ),
    },
)

def astro_check(name, tags = [], **kwargs):
    """Astro type checking via `bun x astro check`.

    Replaces tsc-based typecheck for Astro packages where virtual
    modules prevent tsc from resolving imports in the sandbox.

    Args:
        name: Target name (conventionally "astro_check")
        tags: Additional tags
        **kwargs: Additional args passed to the rule
    """
    _astro_check_rule(
        name = name,
        marker = ":BUILD.bazel",
        tags = ["no-remote-cache", "typecheck", "manual"] + tags,
        **kwargs
    )
