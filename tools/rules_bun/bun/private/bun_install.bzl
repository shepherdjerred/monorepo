"""Repository rule that runs `bun install` to create a hermetic npm dependency repo.

Creates an external Bazel repository (@bun_modules) containing:
- node_modules/ with all installed npm packages
- package_rule.bzl: rule that wraps packages with BunInfo
- BUILD.bazel: per-package filegroup + bun_npm_package targets
- defs.bzl: bun_link_all_packages macro (per-workspace transitive deps)
"""

_PACKAGE_RULE_BZL = """\
load("@monorepo//tools/rules_bun/bun:providers.bzl", "BunInfo")

def _bun_npm_dir_impl(ctx):
    \"\"\"Wraps npm package files into a TreeArtifact (directory artifact).

    Bazel tracks the TreeArtifact as a single input instead of thousands
    of individual files, dramatically reducing stat overhead during
    dependency checking and output scanning.
    \"\"\"
    # Use src_dir in the output name so the TreeArtifact's short_path
    # contains the .bun/<key>/node_modules/<pkg> structure that
    # _format_npm_entry needs to extract the destination path.
    out = ctx.actions.declare_directory(ctx.attr.src_dir)
    # Prefix src_dir with workspace root so it's valid from the exec root
    ws_root = ctx.label.workspace_root
    src_path = ws_root + "/" + ctx.attr.src_dir if ws_root else ctx.attr.src_dir
    ctx.actions.run_shell(
        outputs = [out],
        inputs = ctx.attr.pkg_files[DefaultInfo].files,
        command = 'if [ -d "%s" ]; then cp -Rc "%s/." "%s/" 2>/dev/null || cp -R "%s/." "%s/"; fi' % (
            src_path, src_path, out.path, src_path, out.path,
        ),
        mnemonic = "BunNpmDir",
        progress_message = "Packaging npm dir %s" % ctx.attr.src_dir,
        execution_requirements = {"no-sandbox": "1"},
    )
    return [DefaultInfo(files = depset([out]))]

bun_npm_dir = rule(
    implementation = _bun_npm_dir_impl,
    attrs = {
        "src_dir": attr.string(mandatory = True),
        "pkg_files": attr.label(mandatory = True),
    },
)

def _bun_npm_package_impl(ctx):
    pkg_files = ctx.attr.pkg_files[DefaultInfo].files
    return [
        DefaultInfo(files = pkg_files),
        BunInfo(
            target = ctx.label,
            sources = depset(),
            package_json = None,
            package_name = ctx.attr.package_name,
            transitive_sources = depset(),
            npm_sources = pkg_files,
            workspace_deps = depset(),
        ),
    ]

bun_npm_package = rule(
    implementation = _bun_npm_package_impl,
    attrs = {
        "package_name": attr.string(),
        "pkg_files": attr.label(mandatory = True),
    },
)
"""

# Script to parse bun.lock and produce workspace deps + package list as JSON.
# bun.lock uses JSONC (trailing commas) so we use bun to parse it.
_PARSE_LOCK_SCRIPT = """\
const text = await Bun.file(process.argv[2]).text();
const clean = text.replace(/,([\\s\\n]*[}\\]])/g, '$1');
const lock = JSON.parse(clean);

const workspaces = lock.workspaces || {};
const result = { workspaceDeps: {}, allPackages: [], workspaceRefs: {} };

// Build package name -> workspace path map by reading package.json files
const nameToPath = {};
for (const wsPath of Object.keys(workspaces)) {
    try {
        const pkgPath = wsPath ? wsPath + '/package.json' : 'package.json';
        const pkgJson = JSON.parse(await Bun.file(pkgPath).text());
        if (pkgJson.name) {
            nameToPath[pkgJson.name] = wsPath;
        }
    } catch(e) {}
}

// Collect deps per workspace and track workspace references
for (const [wsPath, wsInfo] of Object.entries(workspaces)) {
    const deps = new Set();
    const wsRefs = new Set();
    const allDeps = {
        ...wsInfo.dependencies || {},
        ...wsInfo.devDependencies || {},
        ...wsInfo.optionalDependencies || {},
    };
    for (const [name, ver] of Object.entries(allDeps)) {
        if (ver.startsWith('workspace:')) {
            const refPath = nameToPath[name];
            if (refPath !== undefined) wsRefs.add(refPath);
        } else {
            deps.add(name);
        }
    }
    for (const name of Object.keys(wsInfo.peerDependencies || {})) {
        deps.add(name);
    }
    result.workspaceDeps[wsPath] = [...deps].sort();
    result.workspaceRefs[wsPath] = [...wsRefs].sort();
}

// Extract leaf package names from lockfile packages section.
// Strip version suffix (e.g., "object.entries@1.1.9" -> "object.entries").
const allPkgs = new Set();
for (const key of Object.keys(lock.packages || {})) {
    const parts = key.split('/');
    const last = parts[parts.length - 1];
    const atIdx = last.indexOf('@');
    const name = atIdx > 0 ? last.substring(0, atIdx) : last;
    if (parts.length >= 2 && parts[parts.length - 2].startsWith('@')) {
        allPkgs.add(parts[parts.length - 2] + '/' + name);
    } else {
        allPkgs.add(name);
    }
}
result.allPackages = [...allPkgs].sort();

console.log(JSON.stringify(result));
"""

# Script to map packages to paths and extract the npm dependency graph from
# .bun/ cache entries. Each .bun/<key>/node_modules/ contains the primary
# package and its direct npm deps. We use this to compute per-workspace
# transitive npm deps.
#
# Output: JSON {
#   paths: { "pkg": "node_modules/..." },
#   npmDeps: { "pkg": ["dep1", ...] }
# }
_MAP_PACKAGES_SCRIPT = """\
import { readdirSync, existsSync, readlinkSync } from 'fs';
import { join, resolve } from 'path';

const nm = process.argv[2];
const npmDeps = {};
const bunKeys = {};
const hoistedKeys = {};
const allKeysByPkg = {};
const entryDeps = {};
const aliasToReal = {};

function listPackages(dir) {
    const pkgs = [];
    try {
        for (const entry of readdirSync(dir)) {
            if (entry.startsWith('.')) continue;
            if (entry.startsWith('@')) {
                try {
                    for (const sub of readdirSync(join(dir, entry))) {
                        pkgs.push(entry + '/' + sub);
                    }
                } catch(e) {}
            } else {
                pkgs.push(entry);
            }
        }
    } catch(e) {}
    return pkgs;
}

// Scan .bun cache entries for primary package keys, deps, and per-entry dep resolution
const bunDir = join(nm, '.bun');
if (existsSync(bunDir)) {
    for (const key of readdirSync(bunDir)) {
        if (key === 'install' || key === 'cache') continue;
        const nmDir = join(bunDir, key, 'node_modules');
        if (!existsSync(nmDir)) continue;

        const pkgsInEntry = listPackages(nmDir);

        let primary = null;
        for (const pkg of pkgsInEntry) {
            const normalized = pkg.replace('/', '+');
            if (key.startsWith(normalized + '@') || key === normalized) {
                primary = pkg;
                break;
            }
        }

        if (primary) {
            // Track all keys for this package (for multi-version filegroups)
            if (!(primary in allKeysByPkg)) {
                allKeysByPkg[primary] = [];
            }
            allKeysByPkg[primary].push(key);

            // For the "default" key, prefer highest version
            if (!(primary in bunKeys) || key > bunKeys[primary]) {
                bunKeys[primary] = key;
            }

            if (!(primary in npmDeps)) {
                npmDeps[primary] = [];
            }

            // Track per-entry deps with their resolved keys
            entryDeps[key] = {};
            for (const pkg of pkgsInEntry) {
                if (pkg !== primary) {
                    if (!npmDeps[primary].includes(pkg)) {
                        npmDeps[primary].push(pkg);
                    }
                    // Read symlink to find which .bun/<dep_key> this dep resolves to
                    try {
                        const link = readlinkSync(join(nmDir, pkg));
                        const segments = link.split('/');
                        for (const seg of segments) {
                            if (seg !== '..') {
                                entryDeps[key][pkg] = seg;
                                break;
                            }
                        }
                    } catch(e) {}
                }
            }

            // Detect alias deps: dep symlinks where the dep name differs
            // from the primary package in the target entry.
            // e.g., wrap-ansi-cjs -> ../../wrap-ansi@7.0.0/node_modules/wrap-ansi
            // Here dep_name="wrap-ansi-cjs" but target primary is "wrap-ansi"
            for (const [depName, depKey] of Object.entries(entryDeps[key])) {
                // Extract target primary from symlink target path
                try {
                    const link = readlinkSync(join(nmDir, depName));
                    // link = ../../wrap-ansi@7.0.0/node_modules/wrap-ansi
                    const nmIdx = link.lastIndexOf('/node_modules/');
                    if (nmIdx >= 0) {
                        const targetPkg = link.substring(nmIdx + '/node_modules/'.length);
                        if (targetPkg && targetPkg !== depName) {
                            if (!(depName in aliasToReal)) {
                                aliasToReal[depName] = targetPkg;
                            }
                        }
                    }
                } catch(e) {}
            }
        }
    }
}

// Check hoisted packages and resolve their symlinks to .bun/ keys.
// Hoisted version OVERRIDES any previously found key since bun chose
// this version to be the "default" for the workspace.
for (const pkg of listPackages(nm)) {
    try {
        const link = readlinkSync(join(nm, pkg));
        const match = link.match(/\\.bun\\/([^/]+)\\//);
        if (match) {
            hoistedKeys[pkg] = match[1];
            bunKeys[pkg] = match[1];
        }
    } catch(e) {
        if (!(pkg in bunKeys)) {
            bunKeys[pkg] = pkg;
        }
    }
}

console.log(JSON.stringify({ bunKeys, npmDeps, hoistedKeys, allKeysByPkg, entryDeps, aliasToReal }));
"""

def _sanitize_name(name):
    """Convert npm package name to valid Bazel target name."""
    return name.replace("@", "").replace("/", "+")

def _compute_transitive_deps(direct_deps, npm_deps, alias_to_real = {}):
    """Compute transitive closure of npm deps for a set of direct deps.

    When an alias (e.g. wrap-ansi-cjs) is encountered, the real package
    (e.g. wrap-ansi) is also included so that inter-entry dep symlinks
    have valid targets in the materialized tree.
    """
    visited = {}
    queue = list(direct_deps)
    for _ in range(100000):
        if not queue:
            break
        pkg = queue[0]
        queue = queue[1:]
        if pkg in visited:
            continue
        visited[pkg] = True

        # If this is an alias, also include the real package
        real = alias_to_real.get(pkg, "")
        if real and real not in visited:
            queue.append(real)

        for dep in npm_deps.get(pkg, []):
            if dep not in visited:
                queue.append(dep)
    return sorted(visited.keys())

def _generate_build_file(packages, bun_keys, all_keys_by_pkg):
    """Generate BUILD.bazel content with per-package filegroups and targets.

    Each package gets a filegroup that globs its files across ALL version
    entries in .bun/. For multi-version packages (e.g. brace-expansion
    v1/v2/v5), the filegroup includes files from every version so that
    inter-entry dep symlinks can resolve correctly.
    """
    lines = [
        'load(":package_rule.bzl", "bun_npm_dir", "bun_npm_package")',
        "",
        'package(default_visibility = ["//visibility:public"])',
        "",
        'exports_files(["hoisted_links.sh"])',
        "",
    ]

    for pkg_name in sorted(packages):
        sanitized = _sanitize_name(pkg_name)
        keys = all_keys_by_pkg.get(pkg_name, [])

        # Glob this package's files across all version entries
        if keys:
            glob_patterns = [
                "node_modules/.bun/%s/node_modules/%s/**" % (key, pkg_name)
                for key in sorted(keys)
            ]
            # Source directories for TreeArtifact creation
            src_dirs = [
                "node_modules/.bun/%s/node_modules/%s" % (key, pkg_name)
                for key in sorted(keys)
            ]
        else:
            glob_patterns = ["node_modules/%s/**" % pkg_name]
            src_dirs = ["node_modules/%s" % pkg_name]

        patterns_str = ", ".join(['"%s"' % p for p in glob_patterns])

        # Filegroup for Bazel change detection (inputs to bun_npm_dir)
        lines.append("filegroup(")
        lines.append('    name = "_npm_files_%s",' % sanitized)
        lines.append("    srcs = glob([%s], allow_empty = True)," % patterns_str)
        lines.append(")")
        lines.append("")

        # TreeArtifact per version entry — Bazel tracks 1 directory instead of N files
        for i, src_dir in enumerate(src_dirs):
            dir_name = "_npm_dir_%s_%d" % (sanitized, i) if len(src_dirs) > 1 else "_npm_dir_%s" % sanitized
            lines.append("bun_npm_dir(")
            lines.append('    name = "%s",' % dir_name)
            lines.append('    src_dir = "%s",' % src_dir)
            lines.append('    pkg_files = ":_npm_files_%s",' % sanitized)
            lines.append(")")
            lines.append("")

        # bun_npm_package uses TreeArtifact(s) instead of raw filegroup
        if len(src_dirs) == 1:
            pkg_files_target = ":_npm_dir_%s" % sanitized
        else:
            # Multi-version: create a filegroup of all TreeArtifacts
            dir_targets = [":_npm_dir_%s_%d" % (sanitized, i) for i in range(len(src_dirs))]
            dirs_str = ", ".join(['"%s"' % t for t in dir_targets])
            lines.append("filegroup(")
            lines.append('    name = "_npm_dirs_%s",' % sanitized)
            lines.append("    srcs = [%s]," % dirs_str)
            lines.append(")")
            lines.append("")
            pkg_files_target = ":_npm_dirs_%s" % sanitized

        lines.append("bun_npm_package(")
        lines.append('    name = "%s",' % sanitized)
        lines.append('    package_name = "%s",' % pkg_name)
        lines.append('    pkg_files = "%s",' % pkg_files_target)
        lines.append(")")
        lines.append("")

    return "\n".join(lines)

def _compute_ws_deps(ws_path, workspace_deps, workspace_refs, npm_deps, alias_to_real = {}):
    """Compute full transitive npm deps for a workspace.

    Includes: own deps + root deps + deps from all transitive workspace refs.
    Then computes npm transitive closure.
    """

    # Compute transitive workspace references (A->B->C)
    ws_visited = {}
    ws_queue = [ws_path]
    for _ in range(1000):
        if not ws_queue:
            break
        ws = ws_queue[0]
        ws_queue = ws_queue[1:]
        if ws in ws_visited:
            continue
        ws_visited[ws] = True
        for ref in workspace_refs.get(ws, []):
            if ref not in ws_visited:
                ws_queue.append(ref)

    # Collect direct npm deps from all transitive workspace refs
    merged = {}
    for ws in ws_visited:
        for dep in workspace_deps.get(ws, []):
            merged[dep] = True

    # Always include root deps (bun hoists them to all workspaces)
    for dep in workspace_deps.get("", []):
        merged[dep] = True

    return _compute_transitive_deps(sorted(merged.keys()), npm_deps, alias_to_real)

def _generate_defs_bzl(workspace_deps, npm_deps, all_packages, hoisted_keys, workspace_refs, alias_to_real = {}):
    """Generate defs.bzl with per-workspace bun_link_all_packages macro.

    Each workspace gets only its transitive npm deps (own + root + workspace
    dep npm deps). This keeps materialized trees small (~100-200 packages)
    instead of including all 2776 packages.
    """

    # Compute per-workspace dep sets
    ws_dep_sets = {}
    for ws_path in workspace_deps:
        ws_dep_sets[ws_path] = _compute_ws_deps(
            ws_path,
            workspace_deps,
            workspace_refs,
            npm_deps,
            alias_to_real,
        )

    lines = [
        '"""Generated by bun_install repository rule. Do not edit."""',
        "",
        "def _sanitize_name(name):",
        '    return name.replace("@", "").replace("/", "+")',
        "",
        "_WORKSPACE_DEPS = {",
    ]

    for ws_path in sorted(ws_dep_sets.keys()):
        deps = ws_dep_sets[ws_path]
        dep_strs = ", ".join(['"%s"' % d for d in deps])
        lines.append('    "%s": [%s],' % (ws_path, dep_strs))

    lines.extend([
        "}",
        "",
        'def bun_link_all_packages(name = "node_modules"):',
        '    """Create aliases for this workspace\'s npm deps."""',
        "    pkg_dir = native.package_name()",
        "",
        "    # Find matching workspace (longest prefix match for sub-packages)",
        "    deps = _WORKSPACE_DEPS.get(pkg_dir)",
        "    if deps == None:",
        '        parts = pkg_dir.split("/")',
        "        for i in range(len(parts) - 1, 0, -1):",
        '            parent = "/".join(parts[:i])',
        "            deps = _WORKSPACE_DEPS.get(parent)",
        "            if deps != None:",
        "                break",
        "    if deps == None:",
        '        deps = _WORKSPACE_DEPS.get("", [])',
        "",
        "    aliases = []",
        "    for dep_name in deps:",
        '        alias_name = "%s/%s" % (name, dep_name)',
        "        native.alias(",
        "            name = alias_name,",
        '            actual = "@bun_modules//:%s" % _sanitize_name(dep_name),',
        '            visibility = ["//visibility:public"],',
        "        )",
        '        aliases.append(":%s" % alias_name)',
        "",
        "    # Aggregate target for node_modules attr",
        "    native.filegroup(",
        "        name = name,",
        "        srcs = aliases,",
        '        visibility = ["//visibility:public"],',
        "    )",
        "",
    ])

    return "\n".join(lines)

def _generate_hoisted_links_script(bun_keys, entry_deps, primary_by_key, alias_to_real = {}):
    """Generate a shell script that creates node_modules symlinks.

    Creates two kinds of symlinks:
    1. Inter-entry dep symlinks: .bun/<key>/node_modules/<dep> ->
       ../../<dep_key>/node_modules/<dep>  (version-correct resolution)
    2. Top-level hoisted symlinks: <pkg> -> .bun/<key>/node_modules/<pkg>
       (standard node_modules resolution from package code)

    Both use existence checks so only entries with materialized files
    get symlinks. This keeps the script fast (~1-2s) vs creating all
    10k+ symlinks unconditionally.
    """
    lines = [
        "#!/usr/bin/env bash",
        "# Generated by bun_install. Creates node_modules symlinks.",
        "# Only creates symlinks for entries that have materialized files.",
        'NM_DIR="$1"',
    ]

    # Inter-entry dep symlinks, grouped by entry with existence check
    for key in sorted(entry_deps.keys()):
        deps = entry_deps[key]
        if not deps:
            continue
        primary = primary_by_key.get(key, "")
        if not primary:
            continue

        lines.append('if [ -d "$NM_DIR/.bun/%s/node_modules/%s" ]; then' % (key, primary))
        for dep_name in sorted(deps.keys()):
            dep_key = deps[dep_name]

            # For alias deps (e.g. wrap-ansi-cjs -> wrap-ansi), the symlink
            # target must use the real package name (the primary of the target
            # entry), not the alias name.
            target_pkg = alias_to_real.get(dep_name, dep_name)

            # Only create symlink if the target entry's files are materialized.
            # Per-workspace deps mean not all packages are present in every tree.
            target_dir = ".bun/%s/node_modules/%s" % (dep_key, target_pkg)
            if "/" in dep_name:
                scope = dep_name.split("/")[0]
                target = "../../../%s/node_modules/%s" % (dep_key, target_pkg)
                lines.append('  [ -d "$NM_DIR/%s" ] && mkdir -p "$NM_DIR/.bun/%s/node_modules/%s" && ln -sf "%s" "$NM_DIR/.bun/%s/node_modules/%s"' % (target_dir, key, scope, target, key, dep_name))
            else:
                target = "../../%s/node_modules/%s" % (dep_key, target_pkg)
                lines.append('  [ -d "$NM_DIR/%s" ] && ln -sf "%s" "$NM_DIR/.bun/%s/node_modules/%s"' % (target_dir, target, key, dep_name))
        lines.append("fi")

    # Top-level hoisted symlinks (only if the .bun entry has files)
    for pkg_name in sorted(bun_keys.keys()):
        key = bun_keys[pkg_name]
        rel = ".bun/%s/node_modules/%s" % (key, pkg_name)
        if "/" in pkg_name:
            scope = pkg_name.split("/")[0]
            lines.append('if [ -d "$NM_DIR/%s" ]; then mkdir -p "$NM_DIR/%s" && ln -sf "../%s" "$NM_DIR/%s"; fi' % (rel, scope, rel, pkg_name))
        else:
            lines.append('if [ -d "$NM_DIR/%s" ]; then ln -sf "%s" "$NM_DIR/%s"; fi' % (rel, rel, pkg_name))
    return "\n".join(lines) + "\n"

def _bun_install_impl(rctx):
    bun = rctx.which("bun")
    if not bun:
        fail("bun not found on PATH. Install bun: https://bun.sh")

    # Symlink bun.lock from workspace
    rctx.symlink(rctx.attr.bun_lock, "bun.lock")

    # Symlink package.json files
    for pkg_json in rctx.attr.package_jsons:
        pkg_path = pkg_json.package
        if pkg_path:
            rctx.symlink(pkg_json, "%s/package.json" % pkg_path)
        else:
            rctx.symlink(pkg_json, "package.json")

    # Symlink additional data files (patches, configs, etc.) at workspace-relative paths
    for f in rctx.attr.data:
        f_pkg = f.package
        if f_pkg:
            rctx.symlink(f, "%s/%s" % (f_pkg, f.name))
        else:
            rctx.symlink(f, f.name)

    # Run bun install
    print("[bun_install] Running bun install (%d package.json files)..." % len(rctx.attr.package_jsons))
    result = rctx.execute(
        [bun, "install", "--frozen-lockfile", "--ignore-scripts"],
        timeout = 300,
        quiet = False,
    )
    if result.return_code != 0:
        result = rctx.execute(
            [bun, "install", "--no-save", "--ignore-scripts"],
            timeout = 300,
            quiet = False,
        )
        if result.return_code != 0:
            fail("bun install failed (exit %d):\nstdout: %s\nstderr: %s" % (
                result.return_code,
                result.stdout,
                result.stderr,
            ))
    print("[bun_install] bun install complete")

    # Parse bun.lock to get workspace deps mapping
    print("[bun_install] Parsing bun.lock...")
    parse_script = rctx.path("_parse_lock.ts")
    rctx.file("_parse_lock.ts", _PARSE_LOCK_SCRIPT)

    result = rctx.execute(
        [bun, "run", str(parse_script), "bun.lock"],
        timeout = 30,
    )
    if result.return_code != 0:
        fail("Failed to parse bun.lock:\nstdout: %s\nstderr: %s" % (
            result.stdout,
            result.stderr,
        ))

    lock_data = json.decode(result.stdout.strip())
    workspace_deps = lock_data["workspaceDeps"]
    workspace_refs = lock_data.get("workspaceRefs", {})

    all_packages = {}
    for pkg in lock_data.get("allPackages", []):
        all_packages[pkg] = True
    for deps in workspace_deps.values():
        for dep in deps:
            all_packages[dep] = True
    for pkg_name in rctx.attr.bins.keys():
        all_packages[pkg_name] = True

    print("[bun_install] Parsed %d workspace entries" % len(workspace_deps))

    # Map packages to paths and extract npm dependency graph
    print("[bun_install] Mapping npm package graph...")
    map_script = rctx.path("_map_packages.ts")
    rctx.file("_map_packages.ts", _MAP_PACKAGES_SCRIPT)

    result = rctx.execute(
        [bun, "run", str(map_script), "node_modules"],
        timeout = 60,
    )
    if result.return_code != 0:
        fail("Failed to map packages:\nstdout: %s\nstderr: %s" % (
            result.stdout,
            result.stderr,
        ))

    map_data = json.decode(result.stdout.strip())
    bun_keys = map_data["bunKeys"]
    npm_deps = map_data["npmDeps"]
    hoisted_keys = map_data["hoistedKeys"]
    all_keys_by_pkg = map_data["allKeysByPkg"]
    entry_deps = map_data["entryDeps"]
    alias_to_real = map_data.get("aliasToReal", {})

    # Add all packages from bunKeys and npmDeps to all_packages
    # (lockfile parsing may miss some transitive deps)
    for pkg_name in bun_keys:
        all_packages[pkg_name] = True
    for pkg_name in npm_deps:
        all_packages[pkg_name] = True
        for dep in npm_deps[pkg_name]:
            all_packages[dep] = True

    print("[bun_install] Found %d npm packages" % len(all_packages))

    # Generate files
    print("[bun_install] Generating BUILD.bazel + defs.bzl...")
    rctx.file("package_rule.bzl", _PACKAGE_RULE_BZL)
    rctx.file("BUILD.bazel", _generate_build_file(all_packages, bun_keys, all_keys_by_pkg))
    rctx.file("defs.bzl", _generate_defs_bzl(workspace_deps, npm_deps, all_packages, hoisted_keys, workspace_refs, alias_to_real))

    # Compute primary package name for each entry key
    primary_by_key = {}
    for pkg_name in all_keys_by_pkg:
        for key in all_keys_by_pkg[pkg_name]:
            primary_by_key[key] = pkg_name

    # Generate symlink script (inter-entry deps + top-level hoisted)
    rctx.file("hoisted_links.sh", _generate_hoisted_links_script(bun_keys, entry_deps, primary_by_key, alias_to_real))

    print("[bun_install] Generated BUILD.bazel (%d packages), defs.bzl, hoisted_links.sh" % len(all_packages))

    # Clean up temp files
    rctx.delete("_parse_lock.ts")
    rctx.delete("_map_packages.ts")

bun_install = repository_rule(
    implementation = _bun_install_impl,
    attrs = {
        "bun_lock": attr.label(
            mandatory = True,
            allow_single_file = True,
            doc = "Label for bun.lock file",
        ),
        "package_jsons": attr.label_list(
            mandatory = True,
            allow_files = ["package.json"],
            doc = "Labels for all workspace package.json files",
        ),
        "data": attr.label_list(
            default = [],
            allow_files = True,
            doc = "Additional files needed during bun install (patches, configs, etc.)",
        ),
        "bins": attr.string_list_dict(
            default = {},
            doc = "Map of package name to list of bin entries (e.g. tsc=./bin/tsc)",
        ),
    },
    environ = ["HOME", "PATH", "BUN_INSTALL"],
)
