"""Shared utilities for rules_bun2 rule implementations."""

load("//tools/rules_bun2/bun:providers.bzl", "BunInfo")

# Common attributes shared by all rules that run bun commands.
COMMON_ATTRS = {
    "srcs": attr.label_list(allow_files = True),
    "deps": attr.label_list(),
    "data": attr.label_list(allow_files = True),
    "extra_files": attr.label_list(allow_files = True),
    "node_modules": attr.label(mandatory = True, allow_single_file = True),
    "generated_dirs": attr.label_keyed_string_dict(
        doc = "Map of label -> relative path. Each label's output directory is symlinked into the work dir at the given path (relative to the package dir of the target using this attr).",
        default = {},
    ),
}

def collect_sources(ctx):
    """Collect all source files from srcs + transitive deps."""
    return depset(
        ctx.files.srcs,
        transitive = [
            dep[BunInfo].transitive_sources
            for dep in ctx.attr.deps
            if BunInfo in dep
        ],
    )

def collect_workspace_dep_links(ctx):
    """Generate shell commands to symlink workspace deps into node_modules."""
    lines = []
    for dep in ctx.attr.deps:
        if BunInfo in dep:
            info = dep[BunInfo]
            if info.package_name:
                scope = "/".join(info.package_name.split("/")[:-1]) if "/" in info.package_name else ""
                if scope:
                    lines.append(
                        'mkdir -p "$WORK/node_modules/{scope}" && ln -sfn "$WORK/{dir}" "$WORK/node_modules/{name}"'.format(
                            scope = scope,
                            name = info.package_name,
                            dir = info.package_dir,
                        ),
                    )
                else:
                    lines.append(
                        'ln -sfn "$WORK/{dir}" "$WORK/node_modules/{name}"'.format(
                            name = info.package_name,
                            dir = info.package_dir,
                        ),
                    )
    return lines

def collect_generated_dir_links(ctx):
    """Generate shell commands to symlink generated directories into the work dir."""
    lines = []
    for label, rel_path in ctx.attr.generated_dirs.items():
        files = label.files.to_list()
        if files:
            # TreeArtifact: single directory entry
            dir_file = files[0]
            dest = "{pkg_dir}/{rel_path}".format(
                pkg_dir = ctx.label.package,
                rel_path = rel_path,
            )
            lines.append(
                'mkdir -p "$WORK/$(dirname "{dest}")" && ln -sfn "$WS_ROOT/{src}" "$WORK/{dest}"'.format(
                    src = dir_file.short_path,
                    dest = dest,
                ),
            )
    return lines

def build_runfiles(ctx, bun, all_srcs, nm_depset):
    """Build runfiles including bun binary, sources, data, extra_files, and node_modules."""
    generated_files = []
    for label in ctx.attr.generated_dirs:
        generated_files.extend(label.files.to_list())
    return ctx.runfiles(
        files = [bun] + ctx.files.data + ctx.files.extra_files + generated_files,
        transitive_files = depset(transitive = [all_srcs, nm_depset]),
    )

def get_source_paths(all_srcs, data_files, extra_files):
    """Get all file short_paths for linking into the work dir."""
    paths = []
    for f in all_srcs.to_list():
        paths.append(f.short_path)
    for f in data_files:
        paths.append(f.short_path)
    for f in extra_files:
        paths.append(f.short_path)
    return paths

# Shared shell script preamble for setting up the work directory.
SCRIPT_PREAMBLE = """\
#!/usr/bin/env bash
set -euo pipefail

# Find runfiles root
if [[ -n "${{RUNFILES_DIR:-}}" ]]; then
    RUNFILES_ROOT="$RUNFILES_DIR"
elif [[ -d "$0.runfiles" ]]; then
    RUNFILES_ROOT="$0.runfiles"
else
    echo "ERROR: Cannot find runfiles" >&2
    exit 1
fi

# Workspace root in runfiles (bzlmod uses _main/)
WS_ROOT="$RUNFILES_ROOT/_main"

# Create a temporary workspace layout
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Copy all files into work dir, preserving directory structure.
# We copy instead of symlink so that tools can write sibling files
# (e.g., bun test snapshots, eslint cache, tsc output).
SOURCE_FILES="{source_files}"
for src in $SOURCE_FILES; do
    dir=$(dirname "$WORK/$src")
    mkdir -p "$dir"
    cp "$WS_ROOT/$src" "$WORK/$src"
done

# Link node_modules from external repo
NM_REAL=$(cd "$WS_ROOT" && cd "$(dirname "{nm_root}")" && pwd)/$(basename "{nm_root}")
ln -sfn "$NM_REAL" "$WORK/node_modules"


# Link workspace deps into node_modules
{workspace_dep_links}

# Link generated directories (e.g., Prisma client)
{generated_dir_links}
"""
