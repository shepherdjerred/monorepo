"""materialize_tree action for rules_bun.

Creates a self-contained TreeArtifact directory containing all sources,
npm packages, workspace deps, and optional prisma client.
"""

load("//tools/rules_bun/bun:providers.bzl", "BunInfo")

def _format_npm_entry(f):
    """Format an npm source file as a package directory entry.

    Returns "src_dir\\tpkg_rel" where src_dir is the exec-root path to the
    npm package directory and pkg_rel is the .bun/<key>/node_modules/<pkg>
    relative path. Many files map to the same directory — use uniquify=True
    on Args.add_all() to deduplicate.

    Called by Args.add_all() during the execution phase (not analysis),
    which avoids blocking Bazel's single-threaded analysis with a costly
    .to_list() on the large npm depset.
    """
    sp = f.short_path
    idx = sp.find("/node_modules/")
    if idx < 0:
        return None
    rel = sp[idx + 14:]  # len("/node_modules/") == 14
    if rel.startswith(".bin") or rel.startswith(".cache"):
        return None

    # Extract package directory from rel path.
    # Format: .bun/<key>/node_modules/<pkg>/sub/path/file.js
    # Scoped: .bun/<key>/node_modules/@scope/pkg/sub/path/file.js
    parts = rel.split("/")
    if len(parts) < 4:
        return None

    # Package boundary: 4 segments for regular, 5 for scoped (@scope/pkg)
    pkg_end = 5 if parts[3].startswith("@") else 4
    if len(parts) < pkg_end:
        return None

    pkg_rel = "/".join(parts[:pkg_end])

    # Derive source directory by trimming file-specific suffix from exec path
    file_suffix = "/".join(parts[pkg_end:])
    src_dir = f.path
    if file_suffix:
        src_dir = src_dir[:-(len(file_suffix) + 1)]

    return "%s\t%s" % (src_dir, pkg_rel)

def _write_partial_manifest(ctx, manifest_file, bun_info, extra_files, tsconfig, prisma_client, data_files):
    """Write manifest for source files, extra files, workspace deps, and links.

    npm sources are handled separately via directory-level copies (Phase 0
    of the materialize script), not through this manifest.
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

MANIFEST="$1"
OUT_DIR="$2"
LINKS_SCRIPT="${3:-}"
PKG_DIR="${4:-}"
BUN="${5:-}"
NPM_LIST="${6:-}"


# Phase 0: Copy npm package directories using bun's native fs.cpSync.
# A single bun process does ~1.1k directory copies with direct syscalls
# (clonefile on macOS APFS, hardlinks on Linux) — no shell fork per dir.
if [ -n "$NPM_LIST" ] && [ -f "$NPM_LIST" ]; then
    if [ -n "$BUN" ] && [ -x "$BUN" ]; then
        "$BUN" -e "
var {cpSync:c,mkdirSync:m}=require('fs'),{dirname:d}=require('path');
var ls=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\\n');
var ps=new Set(),pairs=[];
for(var l of ls){var[s,r]=l.split('\\t');var dst=process.argv[2]+'/'+process.argv[3]+'/node_modules/'+r;ps.add(d(dst));pairs.push([s,dst])}
for(var p of ps)m(p,{recursive:true});
for(var[s,dst]of pairs)c(s,dst,{recursive:true});
" "$NPM_LIST" "$OUT_DIR" "$PKG_DIR"
    else
        # Fallback: bash loop (slower, ~17s vs ~2s)
        while IFS=$'\\t' read -r src_dir pkg_rel; do
            dest="$OUT_DIR/$PKG_DIR/node_modules/$pkg_rel"
            mkdir -p "$dest"
            cp -Rc "$src_dir/." "$dest/" 2>/dev/null ||
            cp -R "$src_dir/." "$dest/" ||
            { echo "FATAL: npm dir copy failed: $src_dir -> $dest" >&2; exit 1; }
        done < "$NPM_LIST"
    fi
fi

# Phase 1: Pre-create ALL destination directories in one batch.
# This avoids ~80k individual mkdir -p calls (the biggest perf bottleneck).
# Only COPY and COPYDIR — LINK destinations are symlinks, not directories.
# Use NUL-delimited output to handle paths with spaces.
awk -F'\\t' '
    $1 == "COPY"    { orig=$3; sub(/\\/[^\\/]*$/, "", $3); if ($3 != "" && $3 != orig) print d "/" $3 }
    $1 == "COPYDIR" { print d "/" $3 }
' d="$OUT_DIR" "$MANIFEST" | sort -u | while IFS= read -r dir; do
    mkdir -p "$dir"
done

# Phase 2: Link-first regular files.
# Try hardlink first (near-instant, same filesystem), fall back to copy.
# awk can't output NUL bytes, so we use newline-delimited pairs (src\\ndst)
# and read two lines at a time.
awk -F'\\t' '$1 == "COPY" { print $2; print d "/" $3 }' d="$OUT_DIR" "$MANIFEST" \\
    | while IFS= read -r src && IFS= read -r dst; do
    ln -f "$src" "$dst" 2>/dev/null || cp -f "$src" "$dst" || { echo "FATAL: link/copy failed: $src -> $dst" >&2; exit 1; }
done

# Phase 3: Copy directory artifacts (few operations).
awk -F'\\t' '$1 == "COPYDIR" { print $2 "\\t" $3 }' "$MANIFEST" | while IFS=$'\\t' read -r src dst; do
    cp -R "$src/." "$OUT_DIR/$dst/" || { echo "FATAL: copydir failed: $src -> $OUT_DIR/$dst/" >&2; exit 1; }
done

# Phase 4: Create symlinks (few operations, mkdir inline is fine).
awk -F'\\t' '$1 == "LINK" { print $2 "\\t" $3 }' "$MANIFEST" | while IFS=$'\\t' read -r src dst; do
    mkdir -p "$OUT_DIR/$(dirname "$dst")" 2>/dev/null || true
    ln -sf "$src" "$OUT_DIR/$dst" || { echo "FATAL: symlink failed: $src -> $OUT_DIR/$dst" >&2; exit 1; }
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

def materialize_tree(ctx, name, bun_info, tsconfig = None, extra_files = None, prisma_client = None, data_files = None, additional_npm_sources = None, hoisted_links = None, bun_binary = None):
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
    partial_manifest = ctx.actions.declare_file(name + "_manifest.txt")

    # Merge npm sources as a depset — shared across targets, avoids flat list copies.
    all_npm_sources_depset = depset(transitive = [bun_info.npm_sources, additional_npm_sources])

    # Write partial manifest (everything except npm sources).
    # npm sources are passed via Args param file to avoid costly .to_list()
    # on the large npm depset during Bazel's single-threaded analysis phase.
    _write_partial_manifest(ctx, partial_manifest, bun_info, extra_files, tsconfig, prisma_client, data_files)

    script = ctx.actions.declare_file(name + "_materialize.sh")
    ctx.actions.write(
        output = script,
        content = _MATERIALIZE_SCRIPT,
        is_executable = True,
    )

    # Fixed arguments: partial manifest, output dir, links script, pkg_dir, bun binary
    fixed_args = ctx.actions.args()
    fixed_args.add(partial_manifest)
    fixed_args.add(tree.path)
    if hoisted_links:
        fixed_args.add(hoisted_links)
    else:
        fixed_args.add("")
    fixed_args.add(ctx.label.package)
    if bun_binary:
        fixed_args.add(bun_binary)
    else:
        fixed_args.add("")

    # npm sources as param file — iteration deferred to execution phase
    # (parallelized) instead of analysis phase (single-threaded).
    npm_args = ctx.actions.args()
    npm_args.set_param_file_format("multiline")
    npm_args.use_param_file("%s", use_always = True)
    npm_args.add_all(all_npm_sources_depset, map_each = _format_npm_entry, uniquify = True)

    # Build action inputs as a depset so Bazel can share structure across
    # targets that use the same npm packages.
    direct_inputs = [partial_manifest, script]
    if bun_info.package_json:
        direct_inputs.append(bun_info.package_json)
    if tsconfig:
        direct_inputs.append(tsconfig)
    direct_inputs.extend(extra_files)
    direct_inputs.extend(data_files)
    if prisma_client:
        direct_inputs.append(prisma_client)
    if hoisted_links:
        direct_inputs.append(hoisted_links)
    if bun_binary:
        direct_inputs.append(bun_binary)

    transitive_inputs = [bun_info.sources, all_npm_sources_depset]

    ws_dep_direct = []
    for ws_dep in bun_info.workspace_deps.to_list():
        transitive_inputs.append(ws_dep.sources)
        transitive_inputs.append(ws_dep.npm_sources)
        if ws_dep.package_json:
            ws_dep_direct.append(ws_dep.package_json)

    ctx.actions.run(
        outputs = [tree],
        inputs = depset(direct = direct_inputs + ws_dep_direct, transitive = transitive_inputs),
        executable = script,
        arguments = [fixed_args, npm_args],
        mnemonic = "BunMaterialize",
        progress_message = "Materializing Bun package tree for %s" % ctx.label,
        execution_requirements = {"no-sandbox": "1"},
    )

    return tree
