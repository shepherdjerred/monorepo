"""materialize_tree action for rules_bun.

Creates a self-contained TreeArtifact directory containing all sources,
npm packages, workspace deps, and optional prisma client.
"""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")

def _write_manifest(ctx, manifest_file, bun_info, extra_files, tsconfig, prisma_client, data_files, all_npm_sources):
    """Write a manifest file listing all COPY/COPYDIR operations.

    Files are placed at their monorepo-relative paths so that all relative
    references (tsconfig extends, eslint config discovery, etc.) work as-is.
    """
    lines = []
    pkg_dir = ctx.label.package

    # Copy source files — preserve monorepo-relative paths
    for f in bun_info.sources.to_list():
        lines.append("COPY\t%s\t%s" % (f.path, f.short_path))

    # Copy package.json at its monorepo location
    if bun_info.package_json:
        lines.append("COPY\t%s\t%s/package.json" % (bun_info.package_json.path, pkg_dir))

    # Copy tsconfig at its monorepo location
    if tsconfig:
        lines.append("COPY\t%s\t%s/tsconfig.json" % (tsconfig.path, pkg_dir))

    # Copy extra files at their monorepo-relative paths
    for f in extra_files:
        lines.append("COPY\t%s\t%s" % (f.path, f.short_path))

    # Copy data files — preserve monorepo-relative paths
    for f in data_files:
        lines.append("COPY\t%s\t%s" % (f.path, f.short_path))

    # Copy npm package files preserving .bun/<key> structure.
    # Files live at .bun/<key>/node_modules/<pkg>/... paths which
    # preserves version isolation — inter-entry dep symlinks and
    # top-level hoisted symlinks are created by hoisted_links.sh.
    # Deduplicate by destination path -- first entry wins.
    seen_npm_paths = {}
    for f in all_npm_sources:
        sp = f.short_path

        # Find the FIRST "node_modules/" segment to preserve .bun/<key> paths.
        # For .bun/<key>/node_modules/<pkg>/file.js, this gives
        # .bun/<key>/node_modules/<pkg>/file.js (preserving version structure).
        idx = sp.find("/node_modules/")
        if idx < 0:
            continue
        rel = sp[idx + len("/node_modules/"):]

        # Skip bin stubs and cache metadata
        if rel.startswith(".bin") or rel.startswith(".cache"):
            continue

        dest = "%s/node_modules/%s" % (pkg_dir, rel)
        if dest in seen_npm_paths:
            continue
        seen_npm_paths[dest] = True

        if f.is_directory:
            lines.append("COPYDIR\t%s\t%s" % (f.path, dest))
        else:
            lines.append("COPY\t%s\t%s" % (f.path, dest))

    # Copy workspace dep sources into {pkg_dir}/node_modules/<pkg_name>/
    for ws_dep in bun_info.workspace_deps.to_list():
        dep_pkg_dir = ws_dep.target.package
        dep_name = _workspace_dep_name(ws_dep)

        for f in ws_dep.sources.to_list():
            rel_path = f.short_path
            if rel_path.startswith(dep_pkg_dir + "/"):
                rel_path = rel_path[len(dep_pkg_dir) + 1:]
            lines.append("COPY\t%s\t%s/node_modules/%s/%s" % (f.path, pkg_dir, dep_name, rel_path))

        if ws_dep.package_json:
            lines.append("COPY\t%s\t%s/node_modules/%s/package.json" % (ws_dep.package_json.path, pkg_dir, dep_name))

    # Copy prisma client if provided
    if prisma_client:
        lines.append("COPYDIR\t%s\t%s/.prisma/client" % (prisma_client.path, pkg_dir))
        lines.append("COPYDIR\t%s\t%s/node_modules/.prisma/client" % (prisma_client.path, pkg_dir))

    # Create node_modules symlinks at each ancestor directory so that files
    # at parent levels (e.g. shared eslint configs) can resolve npm imports.
    parts = pkg_dir.split("/")
    for i in range(len(parts)):
        link_dir = "/".join(parts[:i]) if i > 0 else ""
        rel_target = "/".join(parts[i:]) + "/node_modules"
        if link_dir:
            lines.append("LINK\t%s\t%s/node_modules" % (rel_target, link_dir))
        else:
            lines.append("LINK\t%s\tnode_modules" % rel_target)

    ctx.actions.write(
        output = manifest_file,
        content = "\n".join(lines) + "\n",
    )

def _workspace_dep_name(bun_info):
    """Extract the npm package name from a workspace dep's package directory.

    WARNING: Scoped packages (e.g. @shepherdjerred/eslint-config) MUST set
    `package_name` on their bun_library, otherwise this function returns only
    the last path segment (e.g. "eslint-config") which won't match the
    node_modules/@scope/name directory.
    """
    if bun_info.package_name:
        return bun_info.package_name
    parts = bun_info.target.package.split("/")
    if len(parts) >= 2:
        return parts[-1]
    return bun_info.target.package

_MATERIALIZE_SCRIPT = """\
#!/usr/bin/env bash
set -euo pipefail

# Portable realpath: works on macOS (which may lack readlink -f) and Linux
_realpath() {
    local path="$1"
    if command -v realpath >/dev/null 2>&1; then
        realpath "$path"
    elif command -v readlink >/dev/null 2>&1 && readlink -f "$path" 2>/dev/null; then
        return 0
    else
        # POSIX fallback: resolve symlinks manually
        local dir base
        while [ -L "$path" ]; do
            dir="$(cd -P "$(dirname "$path")" && pwd)"
            path="$(readlink "$path")"
            # Handle relative symlink targets
            case "$path" in /*) ;; *) path="$dir/$path" ;; esac
        done
        dir="$(cd -P "$(dirname "$path")" && pwd)"
        base="$(basename "$path")"
        echo "$dir/$base"
    fi
}

MANIFEST="$1"
OUT_DIR="$2"
LINKS_SCRIPT="${3:-}"
PKG_DIR="${4:-}"

# Phase 1: Pre-create ALL destination directories in one batch.
# This avoids ~80k individual mkdir -p calls (the biggest perf bottleneck).
# Only COPY and COPYDIR — LINK destinations are symlinks, not directories.
awk -F'\\t' '
    $1 == "COPY"    { sub(/\\/[^\\/]*$/, "", $3); if ($3 != "") print d "/" $3 }
    $1 == "COPYDIR" { print d "/" $3 }
' d="$OUT_DIR" "$MANIFEST" | sort -u | xargs mkdir -p

# Phase 2: Batch copy regular files.
# awk can't output NUL bytes, so we use newline-delimited pairs (src\\ndst)
# and read two lines at a time.
awk -F'\\t' '$1 == "COPY" { print $2; print d "/" $3 }' d="$OUT_DIR" "$MANIFEST" \\
    | while IFS= read -r src && IFS= read -r dst; do
    cp -f "$src" "$dst" 2>/dev/null || true
done

# Phase 3: Copy directory artifacts (few operations).
awk -F'\\t' '$1 == "COPYDIR" { print $2 "\\t" $3 }' "$MANIFEST" | while IFS=$'\\t' read -r src dst; do
    cp -R "$src/." "$OUT_DIR/$dst/" 2>/dev/null || true
done

# Phase 4: Create symlinks (few operations, mkdir inline is fine).
awk -F'\\t' '$1 == "LINK" { print $2 "\\t" $3 }' "$MANIFEST" | while IFS=$'\\t' read -r src dst; do
    mkdir -p "$OUT_DIR/$(dirname "$dst")" 2>/dev/null || true
    ln -sf "$src" "$OUT_DIR/$dst" 2>/dev/null || true
done

# Create inter-entry dep symlinks and top-level hoisted symlinks.
# This recreates bun's .bun/<key>/node_modules/<dep> -> ../../<dep_key>/...
# symlink structure for correct version-specific resolution.
if [ -n "$LINKS_SCRIPT" ] && [ -f "$LINKS_SCRIPT" ]; then
    bash "$LINKS_SCRIPT" "$OUT_DIR/$PKG_DIR/node_modules"
fi

# Dereference @prisma/client symlinks so TypeScript resolves .prisma/client locally.
# Previously done in per-runner templates; centralized here for all consumers.
if [ -n "$PKG_DIR" ] && [ -d "$OUT_DIR/$PKG_DIR/node_modules/.prisma/client" ] && [ -d "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client" ]; then
    TMP_PRISMA=$(mktemp -d)
    cp -RL "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client" "$TMP_PRISMA/"
    rm -rf "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client"
    mv "$TMP_PRISMA/client" "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client"
    rm -rf "$TMP_PRISMA"
fi

# Dereference .d.ts symlinks that point outside the tree.
# TypeScript's project service follows realpath and escapes the tree,
# causing spurious type errors.  Only dereference .d.ts files — runtime
# JS files must keep their symlinks so Bun can leverage the store's
# nested node_modules for correct version resolution.
# Use -P to avoid following directory symlinks (dep links).
find -P "$OUT_DIR" -type l \\( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.d.mts' -o -name '*.d.cts' \\) -print0 2>/dev/null | while IFS= read -r -d '' link; do
    target=$(_realpath "$link" 2>/dev/null) || continue
    case "$target" in
        "$OUT_DIR"/*) ;;  # points inside the tree — keep it
        *)
            rm -f "$link"
            cp -f "$target" "$link" 2>/dev/null || true
            ;;
    esac
done
"""

def collect_all_npm_sources(deps):
    """Collect all npm_sources from deps.

    Args:
      deps: list of targets that may provide BunInfo or DefaultInfo.

    Returns:
      A depset of all npm source files from the given deps.
    """
    sources = []
    for dep in deps:
        if BunInfo in dep:
            sources.append(dep[BunInfo].npm_sources)
        elif DefaultInfo in dep:
            sources.append(dep[DefaultInfo].files)
    return depset(transitive = sources)

def materialize_tree(ctx, name, bun_info, tsconfig = None, extra_files = None, prisma_client = None, data_files = None, additional_npm_sources = None, hoisted_links = None):
    """Create a TreeArtifact with a self-contained package directory.

    Args:
      ctx: rule context.
      name: base name for declared outputs.
      bun_info: BunInfo provider with sources and deps.
      tsconfig: optional tsconfig.json File.
      extra_files: optional list of additional files to copy.
      prisma_client: optional Prisma client TreeArtifact.
      data_files: optional list of data files to copy.
      additional_npm_sources: optional depset of extra npm source files.
      hoisted_links: optional File for hoisted_links.sh script that creates
          inter-entry dep symlinks and top-level hoisted symlinks.

    Returns:
      A TreeArtifact File containing the materialized package tree.
    """
    if extra_files == None:
        extra_files = []
    if data_files == None:
        data_files = []
    if additional_npm_sources == None:
        additional_npm_sources = depset()

    tree = ctx.actions.declare_directory(name + "_tree")
    manifest = ctx.actions.declare_file(name + "_manifest.txt")

    # Merge npm sources as a depset — shared across targets, avoids flat list copies.
    all_npm_sources_depset = depset(transitive = [bun_info.npm_sources, additional_npm_sources])

    # Manifest writing needs iteration (unavoidable), but only once.
    _write_manifest(ctx, manifest, bun_info, extra_files, tsconfig, prisma_client, data_files, all_npm_sources_depset.to_list())

    script = ctx.actions.declare_file(name + "_materialize.sh")
    ctx.actions.write(
        output = script,
        content = _MATERIALIZE_SCRIPT,
        is_executable = True,
    )

    # Build action inputs as a depset so Bazel can share structure across
    # targets that use the same npm packages (lint, typecheck, test for one
    # package all reference the same npm_sources depset).
    direct_inputs = [manifest, script]
    if bun_info.package_json:
        direct_inputs.append(bun_info.package_json)
    if tsconfig:
        direct_inputs.append(tsconfig)
    direct_inputs.extend(extra_files)
    direct_inputs.extend(data_files)
    if prisma_client:
        direct_inputs.append(prisma_client)

    transitive_inputs = [bun_info.sources, all_npm_sources_depset]

    ws_dep_direct = []
    for ws_dep in bun_info.workspace_deps.to_list():
        transitive_inputs.append(ws_dep.sources)
        transitive_inputs.append(ws_dep.npm_sources)
        if ws_dep.package_json:
            ws_dep_direct.append(ws_dep.package_json)

    # Build arguments: manifest, output dir, [links script, pkg_dir]
    args = [manifest.path, tree.path]
    if hoisted_links:
        direct_inputs.append(hoisted_links)
        args.append(hoisted_links.path)
        args.append(ctx.label.package)

    ctx.actions.run(
        outputs = [tree],
        inputs = depset(direct = direct_inputs + ws_dep_direct, transitive = transitive_inputs),
        executable = script,
        arguments = args,
        mnemonic = "BunMaterialize",
        progress_message = "Materializing Bun package tree for %s" % ctx.label,
    )

    return tree
