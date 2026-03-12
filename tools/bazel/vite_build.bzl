"""Vite build macro using local Starlark rule.

Runs `bun run build` for Vite-based packages. Uses local = True because
Vite needs full filesystem access for plugin resolution, PostCSS, Tailwind,
and other toolchain integrations that can't be sandboxed.
"""

def _vite_build_impl(ctx):
    out_dir = ctx.actions.declare_directory(ctx.attr.name + "_dist")
    pkg_path = ctx.label.package
    marker = ctx.file.marker
    bun = ctx.file._bun
    dist_dir = ctx.attr.dist_dir

    ctx.actions.run_shell(
        outputs = [out_dir],
        inputs = [marker, bun],
        command = """
            set -euo pipefail
            _realpath() {{ cd "$(dirname "$1")" && echo "$PWD/$(basename "$1")"; }}
            # Save the execroot so we can resolve output paths after cd
            EXECROOT="$PWD"
            OUT_DIR="$EXECROOT/{out_path}"
            mkdir -p "$OUT_DIR"
            # Set up bun in PATH
            BUN_DIR=$(dirname $(_realpath '{bun_path}'))
            export PATH="$BUN_DIR:/bin:/usr/bin"
            export HOME="${{TMPDIR:-/tmp}}"
            # Resolve the real workspace directory from the marker file symlink
            MARKER_REAL=$(_realpath '{marker_path}')
            WORKSPACE_DIR=$(echo "$MARKER_REAL" | sed 's|/{pkg_path}/BUILD.bazel$||')
            cd "$WORKSPACE_DIR/{pkg_path}"
            {build_cmd}
            cp -r {dist_dir}/* "$OUT_DIR/"
        """.format(
            bun_path = bun.path,
            marker_path = marker.path,
            pkg_path = pkg_path,
            build_cmd = ctx.attr.build_cmd,
            dist_dir = dist_dir,
            out_path = out_dir.path,
        ),
        execution_requirements = {
            "local": "1",
            "no-remote-cache": "1",
        },
        mnemonic = "ViteBuild",
        progress_message = "Building Vite package %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([out_dir]))]

_vite_build_rule = rule(
    implementation = _vite_build_impl,
    attrs = {
        "build_cmd": attr.string(default = "bun run build"),
        "dist_dir": attr.string(default = "dist"),
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

def vite_build(name, build_cmd = "bun run build", dist_dir = "dist", tags = [], **kwargs):
    """Vite build that captures dist/ as a tree artifact.

    Args:
        name: Target name (conventionally "build")
        build_cmd: Build command to run (default: "bun run build")
        dist_dir: Directory where build output is written (default: "dist")
        tags: Additional tags
        **kwargs: Additional args passed to the rule
    """
    _vite_build_rule(
        name = name,
        build_cmd = build_cmd,
        dist_dir = dist_dir,
        marker = ":BUILD.bazel",
        tags = ["no-remote-cache", "manual"] + tags,
        **kwargs
    )
