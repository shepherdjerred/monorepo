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

    # Copy npm package files into {pkg_dir}/node_modules
    # Deduplicate by destination path — first entry wins
    seen_npm_paths = {}
    for f in all_npm_sources:
        sp = f.short_path

        # Extract package-relative path from the last "node_modules/" segment.
        # Works for both workspace files (packages/foo/node_modules/react/...)
        # and external repo files (../bun_modules/node_modules/react/...).
        parts = sp.split("/node_modules/")
        if len(parts) >= 2:
            pkg_relative = parts[-1]

            # Skip bun cache internals and bin stubs
            if pkg_relative.startswith(".bun") or pkg_relative.startswith(".bin") or pkg_relative.startswith(".cache"):
                continue

            dest = "%s/node_modules/%s" % (pkg_dir, pkg_relative)
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
    """Extract the npm package name from a workspace dep's package directory."""
    if bun_info.package_name:
        return bun_info.package_name
    parts = bun_info.target.package.split("/")
    if len(parts) >= 2:
        return parts[-1]
    return bun_info.target.package

_MATERIALIZE_SCRIPT = """\
#!/usr/bin/env bash
set -euo pipefail

MANIFEST="$1"
OUT_DIR="$2"

mkdir -p "$OUT_DIR"

while IFS=$'\\t' read -r op src dst; do
    case "$op" in
        COPY)
            mkdir -p "$OUT_DIR/$(dirname "$dst")"
            cp -f "$src" "$OUT_DIR/$dst" 2>/dev/null || true
            ;;
        COPYDIR)
            mkdir -p "$OUT_DIR/$dst"
            cp -R "$src/." "$OUT_DIR/$dst/" 2>/dev/null || true
            ;;
        LINK)
            mkdir -p "$OUT_DIR/$(dirname "$dst")"
            ln -sf "$src" "$OUT_DIR/$dst" 2>/dev/null || true
            ;;
    esac
done < "$MANIFEST"

# Dereference .d.ts symlinks that point outside the tree.
# TypeScript's project service follows realpath and escapes the tree,
# causing spurious type errors.  Only dereference .d.ts files — runtime
# JS files must keep their symlinks so Bun can leverage the store's
# nested node_modules for correct version resolution.
find "$OUT_DIR" -type l \\( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.d.mts' -o -name '*.d.cts' \\) -print0 2>/dev/null | while IFS= read -r -d '' link; do
    target=$(readlink -f "$link" 2>/dev/null) || continue
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
      deps: list of targets that may provide BunInfo.

    Returns:
      A depset of all npm source files from the given deps.
    """
    sources = []
    for dep in deps:
        if BunInfo in dep:
            sources.append(dep[BunInfo].npm_sources)
    return depset(transitive = sources)

def materialize_tree(ctx, name, bun_info, tsconfig = None, extra_files = [], prisma_client = None, data_files = [], additional_npm_sources = depset()):
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

    Returns:
      A TreeArtifact File containing the materialized package tree.
    """
    tree = ctx.actions.declare_directory(name + "_tree")
    manifest = ctx.actions.declare_file(name + "_manifest.txt")

    all_npm_sources = depset(transitive = [bun_info.npm_sources, additional_npm_sources]).to_list()

    _write_manifest(ctx, manifest, bun_info, extra_files, tsconfig, prisma_client, data_files, all_npm_sources)

    script = ctx.actions.declare_file(name + "_materialize.sh")
    ctx.actions.write(
        output = script,
        content = _MATERIALIZE_SCRIPT,
        is_executable = True,
    )

    inputs = []
    inputs.append(manifest)
    inputs.extend(bun_info.sources.to_list())
    if bun_info.package_json:
        inputs.append(bun_info.package_json)
    if tsconfig:
        inputs.append(tsconfig)
    inputs.extend(extra_files)
    inputs.extend(data_files)
    inputs.extend(all_npm_sources)

    for ws_dep in bun_info.workspace_deps.to_list():
        inputs.extend(ws_dep.sources.to_list())
        if ws_dep.package_json:
            inputs.append(ws_dep.package_json)

    if prisma_client:
        inputs.append(prisma_client)

    ctx.actions.run(
        outputs = [tree],
        inputs = inputs + [script],
        executable = script,
        arguments = [manifest.path, tree.path],
        mnemonic = "BunMaterialize",
        progress_message = "Materializing Bun package tree for %s" % ctx.label,
    )

    return tree
