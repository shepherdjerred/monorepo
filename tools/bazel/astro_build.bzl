"""Astro build macro using local Starlark rule.

Runs `bun run build` for Astro-based packages. Uses local = True because
Astro needs full filesystem access for virtual module resolution
(astro:content, etc.), plugin resolution, and content collections.
"""

def _astro_build_impl(ctx):
    out_dir = ctx.actions.declare_directory(ctx.attr.name + "_dist")
    pkg_path = ctx.label.package
    marker = ctx.file.marker
    bun = ctx.file._bun

    ctx.actions.run_shell(
        outputs = [out_dir],
        inputs = [marker, bun],
        command = """
            set -euo pipefail
            # Save the execroot so we can resolve output paths after cd
            EXECROOT="$PWD"
            OUT_DIR="$EXECROOT/{out_path}"
            mkdir -p "$OUT_DIR"
            # Set up bun in PATH
            BUN_DIR=$(dirname $(readlink -f '{bun_path}'))
            export PATH="$BUN_DIR:/bin:/usr/bin:/usr/local/bin"
            export HOME="${{TMPDIR:-/tmp}}"
            # Resolve the real workspace directory from the marker file symlink
            MARKER_REAL=$(readlink -f '{marker_path}')
            WORKSPACE_DIR=$(echo "$MARKER_REAL" | sed 's|/{pkg_path}/BUILD.bazel$||')
            cd "$WORKSPACE_DIR/{pkg_path}"
            {build_cmd}
            cp -r dist/* "$OUT_DIR/"
        """.format(
            bun_path = bun.path,
            marker_path = marker.path,
            pkg_path = pkg_path,
            build_cmd = ctx.attr.build_cmd,
            out_path = out_dir.path,
        ),
        execution_requirements = {
            "local": "1",
            "no-remote-cache": "1",
        },
        mnemonic = "AstroBuild",
        progress_message = "Building Astro package %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([out_dir]))]

_astro_build_rule = rule(
    implementation = _astro_build_impl,
    attrs = {
        "build_cmd": attr.string(default = "bun run build"),
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

def astro_build(name, build_cmd = "bun run build", tags = [], **kwargs):
    """Astro build that captures dist/ as a tree artifact.

    Args:
        name: Target name (conventionally "build")
        build_cmd: Build command to run (default: "bun run build")
        tags: Additional tags
        **kwargs: Additional args passed to the rule
    """
    _astro_build_rule(
        name = name,
        build_cmd = build_cmd,
        marker = ":BUILD.bazel",
        tags = ["no-remote-cache", "manual"] + tags,
        **kwargs
    )
