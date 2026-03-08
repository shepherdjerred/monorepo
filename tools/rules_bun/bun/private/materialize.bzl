"""materialize_tree action for rules_bun.

Creates a self-contained TreeArtifact directory containing all sources,
npm packages, workspace deps, and optional prisma client.
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("//tools/rules_bun/bun:providers.bzl", "BunInfo")

def _write_manifest(ctx, manifest_file, bun_info, extra_files, tsconfig, prisma_client, data_files, all_npm_sources):
    """Write a manifest file listing all COPY/COPYDIR operations."""
    lines = []
    pkg_dir = ctx.label.package

    # Copy source files
    for f in bun_info.sources.to_list():
        rel_path = f.short_path
        if rel_path.startswith(pkg_dir + "/"):
            rel_path = rel_path[len(pkg_dir) + 1:]
        lines.append("COPY\t%s\t%s" % (f.path, rel_path))

    # Copy package.json
    if bun_info.package_json:
        lines.append("COPY\t%s\tpackage.json" % bun_info.package_json.path)

    # Copy tsconfig if provided
    if tsconfig:
        lines.append("COPY\t%s\ttsconfig.json" % tsconfig.path)

    # Copy extra files (e.g., tsconfig_base)
    for f in extra_files:
        lines.append("COPY\t%s\t%s" % (f.path, f.basename))

    # Copy data files
    for f in data_files:
        rel_path = f.short_path
        if rel_path.startswith(pkg_dir + "/"):
            rel_path = rel_path[len(pkg_dir) + 1:]
        lines.append("COPY\t%s\t%s" % (f.path, rel_path))

    # Copy npm package files into node_modules
    # Deduplicate by destination path — first entry wins
    seen_npm_paths = {}
    for f in all_npm_sources:
        sp = f.short_path
        if sp.startswith("../"):
            continue

        # Extract package-relative path from the last "node_modules/" segment
        parts = sp.split("/node_modules/")
        if len(parts) >= 2:
            pkg_relative = parts[-1]
            if pkg_relative.startswith(".aspect_rules_js") or pkg_relative.startswith(".bin"):
                continue

            dest = "node_modules/%s" % pkg_relative
            if dest in seen_npm_paths:
                continue
            seen_npm_paths[dest] = True

            if f.is_directory:
                lines.append("COPYDIR\t%s\t%s" % (f.path, dest))
            else:
                lines.append("COPY\t%s\t%s" % (f.path, dest))

    # Copy workspace dep sources into node_modules/<pkg_name>/
    for ws_dep in bun_info.workspace_deps.to_list():
        dep_pkg_dir = ws_dep.target.package
        dep_name = _workspace_dep_name(ws_dep)

        for f in ws_dep.sources.to_list():
            rel_path = f.short_path
            if rel_path.startswith(dep_pkg_dir + "/"):
                rel_path = rel_path[len(dep_pkg_dir) + 1:]
            lines.append("COPY\t%s\tnode_modules/%s/%s" % (f.path, dep_name, rel_path))

        if ws_dep.package_json:
            lines.append("COPY\t%s\tnode_modules/%s/package.json" % (ws_dep.package_json.path, dep_name))

    # Copy prisma client if provided
    if prisma_client:
        lines.append("COPYDIR\t%s\t.prisma/client" % prisma_client.path)

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
    esac
done < "$MANIFEST"
"""

def collect_all_npm_sources(deps):
    """Collect all npm_sources from deps, including dev deps.

    Args:
      deps: list of targets that may provide BunInfo or JsInfo.

    Returns:
      A depset of all npm source files from the given deps.
    """
    sources = []
    for dep in deps:
        if BunInfo in dep:
            sources.append(dep[BunInfo].npm_sources)
        elif JsInfo in dep:
            sources.append(dep[JsInfo].npm_sources)
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
