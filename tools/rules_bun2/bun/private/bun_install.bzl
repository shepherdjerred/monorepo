"""Repository rule that runs `bun install` once, producing a monolithic node_modules.

This replaces the per-package fetch+materialize pipeline with a single `bun install`
invocation. The entire node_modules directory is exposed as a filegroup, which
downstream rules consume as one unit.

Design rationale:
- `bun install` is ~200ms for 3000+ packages — fast enough to run monolithically
- Per-package materialization in Starlark is the bottleneck (~10 min), not installation
- A single filegroup means Bazel tracks individual files, but there's no Starlark
  lockfile parsing and no per-package repository rules
"""

_PLATFORMS = {
    "mac os x-aarch64": ("darwin", "aarch64"),
    "mac os x-x86_64": ("darwin", "x64"),
    "linux-aarch64": ("linux", "aarch64"),
    "linux-x86_64": ("linux", "x64"),
}

_BUN_SHA256 = {
    "1.3.9-darwin-aarch64": "cde6a4edf19cf64909158fa5a464a12026fd7f0d79a4a950c10cf0af04266d85",
    "1.3.9-darwin-x64": "588f4a48740b9a0c366a00f878810ab3ab5e6734d29b7c3cbdd9484b74a007de",
    "1.3.9-linux-aarch64": "a2c2862bcc1fd1c0b3a8dcdc8c7efb5e2acd871eb20ed2f17617884ede81c844",
    "1.3.9-linux-x64": "4680e80e44e32aa718560ceae85d22ecfbf2efb8f3641782e35e4b7efd65a1aa",
}

def _bun_install_impl(rctx):
    # Detect platform
    os_name = rctx.os.name.lower()
    arch = rctx.os.arch
    platform_key = "%s-%s" % (os_name, arch)

    if platform_key not in _PLATFORMS:
        fail("Unsupported platform: %s" % platform_key)

    os_short, arch_short = _PLATFORMS[platform_key]

    # Download Bun binary
    version = rctx.attr.bun_version
    archive_name = "bun-%s-%s" % (os_short, arch_short)
    url = "https://github.com/oven-sh/bun/releases/download/bun-v%s/%s.zip" % (version, archive_name)

    sha_key = "%s-%s-%s" % (version, os_short, arch_short)
    sha256 = _BUN_SHA256.get(sha_key, "")

    rctx.download_and_extract(
        url = url,
        output = "_bun",
        stripPrefix = archive_name,
        sha256 = sha256,
    )

    # Copy bun.lock as a regular file (not symlink) so we can strip workspace entries.
    rctx.file("bun.lock", rctx.read(rctx.attr.bun_lock))
    for pkg_json in rctx.attr.package_jsons:
        pkg_path = pkg_json.package
        if pkg_path:
            dest = "%s/package.json" % pkg_path
        else:
            dest = "package.json"
        rctx.file(dest, rctx.read(pkg_json))

    # Copy data files (patches, etc.) maintaining relative paths
    for data_label in rctx.attr.data:
        path = data_label.package
        name = data_label.name
        dest = "%s/%s" % (path, name) if path else name
        rctx.symlink(data_label, dest)

    bun_path = str(rctx.path("_bun/bun"))

    # Strip workspaces from package.json and bun.lock so bun installs everything
    # flat with no workspace symlinks. Merge workspace deps into root package.json,
    # remove workspace entries from bun.lock, and delete sub-package package.json files.
    prep_result = rctx.execute(
        [bun_path, "-e", """
            const fs = require('fs');
            const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

            // Remove workspaces config
            delete rootPkg.workspaces;

            // Merge deps from all workspace package.json files
            const pkgJsons = process.argv.slice(1);
            for (const pkgPath of pkgJsons) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    for (const depKey of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
                        if (pkg[depKey]) {
                            if (!rootPkg[depKey]) rootPkg[depKey] = {};
                            for (const [name, version] of Object.entries(pkg[depKey])) {
                                if (typeof version === 'string' && version.startsWith('workspace:')) continue;
                                if (!(name in rootPkg[depKey])) {
                                    rootPkg[depKey][name] = version;
                                }
                            }
                        }
                    }
                } catch {}
            }

            // Remove any remaining workspace:* deps from root
            for (const depKey of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
                if (rootPkg[depKey]) {
                    for (const [name, version] of Object.entries(rootPkg[depKey])) {
                        if (typeof version === 'string' && version.startsWith('workspace:')) {
                            delete rootPkg[depKey][name];
                        }
                    }
                }
            }

            fs.writeFileSync('package.json', JSON.stringify(rootPkg, null, 2));

            // Strip workspace entries from bun.lock so bun doesn't create
            // workspace symlinks in node_modules. The lockfile has two sections
            // that reference workspaces:
            // 1. "workspaces" keys like "packages/foo" (non-root workspace packages)
            // 2. Resolution entries like "@scope/pkg@workspace:packages/foo"
            const lock = JSON.parse(fs.readFileSync('bun.lock', 'utf8'));

            // Remove non-root workspace entries (keep "" which is the root)
            if (lock.workspaces) {
                for (const key of Object.keys(lock.workspaces)) {
                    if (key !== '') delete lock.workspaces[key];
                }
            }

            // Remove workspace resolution entries from packages
            if (lock.packages) {
                for (const [name, entries] of Object.entries(lock.packages)) {
                    if (Array.isArray(entries)) {
                        const filtered = entries.filter(e =>
                            typeof e !== 'string' || !e.includes('@workspace:')
                        );
                        if (filtered.length === 0) {
                            delete lock.packages[name];
                        } else {
                            lock.packages[name] = filtered;
                        }
                    }
                }
            }

            fs.writeFileSync('bun.lock', JSON.stringify(lock, null, 2));

        """] + [
            "%s/package.json" % p.package
            for p in rctx.attr.package_jsons
            if p.package  # skip root — these are passed as argv for dep merging
        ],
        timeout = 30,
    )

    if prep_result.return_code != 0:
        fail("Preprocessing failed (exit %d):\nstdout:\n%s\nstderr:\n%s" % (
            prep_result.return_code,
            prep_result.stdout,
            prep_result.stderr,
        ))

    # Delete sub-package package.json files and their parent directories so bun
    # doesn't auto-detect workspaces from directory structure. Also remove the
    # rewritten bun.lock — bun install works fine without it (just slower resolution).
    sub_pkg_paths = [
        "%s/package.json" % p.package
        for p in rctx.attr.package_jsons
        if p.package  # skip root
    ]
    if sub_pkg_paths:
        rm_result = rctx.execute(["rm", "-f"] + sub_pkg_paths, timeout = 10)
        if rm_result.return_code != 0:
            fail("Failed to delete sub-package package.json files: %s" % rm_result.stderr)

    # Run bun install — produces a flat node_modules with all deps hoisted.
    # Note: we keep bun.lock (stripped of workspace entries) to ensure reproducible
    # resolution. Without it, bun resolves from the registry.
    result = rctx.execute(
        [bun_path, "install"],
        environment = {
            "HOME": str(rctx.path(".")),
            "BUN_INSTALL_CACHE_DIR": str(rctx.path("_cache")),
        },
        timeout = 300,
    )

    if result.return_code != 0:
        fail("bun install failed (exit %d):\nstdout:\n%s\nstderr:\n%s" % (
            result.return_code,
            result.stdout,
            result.stderr,
        ))

    # Remove workspace symlinks from node_modules. Bun creates symlinks for workspace
    # packages that point outside the repo. Bazel can't represent these in a
    # TreeArtifact. Downstream rules link workspace deps at test time instead.
    rctx.execute(
        [
            "find",
            "node_modules",
            "-maxdepth",
            "3",
            "-type",
            "l",
            "-exec",
            "sh",
            "-c",
            """
            for link; do
                target=$(readlink "$link")
                case "$target" in
                    /*|../*) rm -f "$link" ;;
                esac
            done
         """,
            "sh",
            "{}",
            "+",
        ],
        timeout = 10,
    )

    # Remove empty scoped dirs after workspace symlink removal (v6)
    rctx.execute(
        ["find", "node_modules", "-maxdepth", "1", "-type", "d", "-name", "@*", "-empty", "-delete"],
        timeout = 5,
    )

    # With BAZEL_TRACK_SOURCE_DIRECTORIES=1, Bazel treats source directories
    # as TreeArtifacts. We can reference node_modules/ directly — no filegroup,
    # no copy, no custom rule. Bazel handles it as a single artifact.
    rctx.file("BUILD.bazel", content = """\
package(default_visibility = ["//visibility:public"])

# With BAZEL_TRACK_SOURCE_DIRECTORIES=1, this directory is a TreeArtifact.
# Bazel tracks changes to files within it and symlinks it as one unit in sandboxes.
exports_files(["node_modules"])
""")

    # Generate defs.bzl for downstream BUILD files.
    # Use Label("//:node_modules") which resolves within this repo's context,
    # avoiding bzlmod canonical name issues.
    rctx.file("defs.bzl", content = """\
def npm_link_all_packages(name = "node_modules"):
    \"\"\"Create a local alias to the shared node_modules.

    In rules_bun2, node_modules is a single shared target from `bun install`.
    This macro creates a local alias so BUILD files can use `:node_modules`.
    \"\"\"
    native.alias(
        name = name,
        actual = Label("//:node_modules"),
        visibility = ["//visibility:public"],
    )
""")

bun_install = repository_rule(
    implementation = _bun_install_impl,
    attrs = {
        "bun_lock": attr.label(mandatory = True, allow_single_file = True),
        "bun_version": attr.string(default = "1.3.9"),
        "package_jsons": attr.label_list(mandatory = True, allow_files = ["package.json"]),
        "data": attr.label_list(default = [], allow_files = True),
    },
)
