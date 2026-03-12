#!/usr/bin/env bash
# Shell wrapper for running bun test in the Bazel sandbox.
# Invokes the Bun toolchain binary directly (no Node.js wrapper),
# avoiding the aspect_rules_js fs patches that break Bun.
#
# Also sets up node_modules symlinks for workspace packages so that
# Bun's module resolution can find them.

set -euo pipefail

# Resolve tool paths to absolute before changing directories
BUN_BINARY="$(cd "$(dirname "$BUN_TOOL")" && pwd)/$(basename "$BUN_TOOL")"
ENTRY="$(cd "$(dirname "$ENTRY_POINT")" && pwd)/$(basename "$ENTRY_POINT")"

# Export JS_BINARY__NODE_BINARY so the entry point script can find Bun
export JS_BINARY__NODE_BINARY="$BUN_BINARY"

# Add the Bun binary's directory to PATH so tests that spawn "bun" can find it
BUN_DIR="$(dirname "$BUN_BINARY")"
export PATH="$BUN_DIR:$PATH"

# Change to the package directory within the runfiles tree
RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

# Discover the bin tree path by resolving a source file symlink.
# Source files in the runfiles tree are symlinks into the sandbox's bin tree.
# Bun resolves module paths from the real (dereferenced) file path. So we must
# create node_modules entries where Bun actually resolves from — the bin tree
# path INSIDE the sandbox (not the persistent output directory).
BIN_PKG_DIR=""
BIN_ROOT=""

FIRST_LINK=$(find . -maxdepth 4 -type l \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) ! -path '*/node_modules/*' 2>/dev/null | head -1 || true)

if [ -n "$FIRST_LINK" ]; then
  REAL_PATH=$("$BUN_BINARY" -e "console.log(require('fs').realpathSync(process.argv[1]))" "$FIRST_LINK" 2>/dev/null || true)
  if [ -n "$REAL_PATH" ]; then
    REL_SUFFIX="${FIRST_LINK#./}"
    BIN_PKG_DIR="${REAL_PATH%/"$REL_SUFFIX"}"
    BIN_ROOT="${BIN_PKG_DIR%/"$PKG_DIR"}"
  fi
fi

# Only proceed with bin tree operations if we resolved to a sandboxed bin tree
# (not the source tree). The bin tree path contains "bazel-out" or a sandbox path.
IS_BIN_TREE=false
case "$BIN_ROOT" in
  */bazel-out/*|*/sandbox/*|*/execroot/*) IS_BIN_TREE=true ;;
esac

# Link workspace packages into node_modules so Bun can resolve them.
if [ -f package.json ] && [ -n "$BIN_PKG_DIR" ] && [ "$IS_BIN_TREE" = true ]; then
  ws_deps=$("$BUN_BINARY" -e "
    const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const ws = Object.entries(deps)
      .filter(([, v]) => String(v).startsWith('workspace:'))
      .map(([k]) => k);
    console.log(JSON.stringify(ws));
  " 2>/dev/null || echo '[]')

  if [ "$ws_deps" != "[]" ]; then
    # Scan the bin tree for workspace packages and create symlinks
    "$BUN_BINARY" -e "
      const fs = require('fs');
      const path = require('path');

      const wsDeps = $ws_deps;
      if (wsDeps.length === 0) process.exit(0);

      const binPkgDir = '$BIN_PKG_DIR';
      const binRoot = '$BIN_ROOT';

      // Scan bin tree for package.json files to map name -> path
      function findPackageJsons(dir, depth) {
        if (depth > 6) return [];
        const results = [];
        try {
          for (const entry of fs.readdirSync(dir)) {
            if (entry === 'node_modules' || entry === '.aspect_rules_js') continue;
            const full = path.join(dir, entry);
            try {
              const stat = fs.statSync(full);
              if (stat.isFile() && entry === 'package.json') {
                results.push(full);
              } else if (stat.isDirectory()) {
                results.push(...findPackageJsons(full, depth + 1));
              }
            } catch (_) {}
          }
        } catch (_) {}
        return results;
      }

      const packagesDir = path.join(binRoot, 'packages');
      const pkgMap = new Map();
      if (fs.existsSync(packagesDir)) {
        for (const pj of findPackageJsons(packagesDir, 0)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
            if (pkg.name) pkgMap.set(pkg.name, path.dirname(pj));
          } catch (_) {}
        }
      }

      // Create symlinks in the sandbox's bin tree node_modules
      for (const dep of wsDeps) {
        const targetDir = pkgMap.get(dep);
        if (!targetDir) continue;

        const parts = dep.split('/');
        const linkPath = path.join(binPkgDir, 'node_modules', ...parts);
        const linkDir = path.dirname(linkPath);

        try { fs.mkdirSync(linkDir, { recursive: true }); } catch (_) {}
        try { fs.unlinkSync(linkPath); } catch (_) {}
        try { fs.symlinkSync(targetDir, linkPath); } catch (_) {}
      }
    " || true
  fi
fi

# Symlink cross-package data deps into the bin tree so import.meta.dir-based
# relative paths can find them. Data deps appear in the runfiles tree but not
# in the bin tree where Bun resolves import.meta.dir to.
if [ "$IS_BIN_TREE" = true ] && [ -n "$BIN_ROOT" ]; then
  RUNFILES_PKG="$RUNFILES/$WS"
  if [ -d "$RUNFILES_PKG/packages" ]; then
    # Mirror runfiles tree entries into the bin tree. Only creates symlinks
    # for paths that don't already exist in the bin tree.
    find "$RUNFILES_PKG/packages" \( -type f -o -type l \) 2>/dev/null | while IFS= read -r rf_file; do
      file_rel="${rf_file#"$RUNFILES_PKG"/}"
      bin_target="$BIN_ROOT/$file_rel"
      if [ ! -e "$bin_target" ]; then
        mkdir -p "$(dirname "$bin_target")" 2>/dev/null || true
        ln -sf "$rf_file" "$bin_target" 2>/dev/null || true
      fi
    done
  fi
fi

# Make snapshot files writable so Bun's toMatchSnapshot() can open them.
# Bazel outputs are read-only by default, but Bun opens .snap files in r/w mode.
if [ -n "${BIN_PKG_DIR:-}" ]; then
  find "$BIN_PKG_DIR" -name '__snapshots__' -type d 2>/dev/null | while IFS= read -r snap_dir; do
    chmod -R u+w "$snap_dir" 2>/dev/null || true
  done
fi

# Generate Prisma client if PRISMA_SCHEMA is set.
# Prisma's @prisma/client/default.js requires .prisma/client/default which
# is only present after `prisma generate`. We generate in a writable temp
# directory, then symlink the output into the bin tree where Bun can find it.
if [ -n "${PRISMA_SCHEMA:-}" ] && [ "$IS_BIN_TREE" = true ] && [ -n "$BIN_PKG_DIR" ]; then
  SCHEMA_PATH="$BIN_PKG_DIR/$PRISMA_SCHEMA"
  if [ -f "$SCHEMA_PATH" ]; then
    # Find the local prisma CLI from node_modules (not bunx which may fetch latest)
    PRISMA_CLI=$(find "$BIN_PKG_DIR/node_modules" -path '*/prisma/build/index.js' 2>/dev/null | head -1)
    if [ -z "$PRISMA_CLI" ]; then
      PRISMA_CLI=$(find "$BIN_ROOT/node_modules/.aspect_rules_js" -path '*/node_modules/prisma/build/index.js' 2>/dev/null | head -1)
    fi
    if [ -n "$PRISMA_CLI" ]; then
      # Run prisma generate in a writable temp directory using bunx.
      # We use bunx to run the exact prisma version from our lockfile.
      # bunx handles all dependency resolution in a writable cache.
      PRISMA_TMPDIR=$(mktemp -d)
      trap 'rm -rf "$PRISMA_TMPDIR"' EXIT
      mkdir -p "$PRISMA_TMPDIR/prisma"
      cp "$SCHEMA_PATH" "$PRISMA_TMPDIR/prisma/schema.prisma"
      echo '{"name":"prisma-gen-tmp"}' > "$PRISMA_TMPDIR/package.json"

      # Extract prisma version from the CLI path (e.g., prisma@6.19.2_typescript_5.9.3)
      PRISMA_VER="${PRISMA_CLI##*prisma@}"
      PRISMA_VER="${PRISMA_VER%%_*}"
      PRISMA_VER="${PRISMA_VER%%/*}"
      [ -z "$PRISMA_VER" ] && PRISMA_VER="${PRISMA_FALLBACK_VER:-6.19.2}"

      # Install @prisma/client so prisma generate can find its output target
      (cd "$PRISMA_TMPDIR" && \
        HOME="$PRISMA_TMPDIR" \
        "$BUN_BINARY" add "@prisma/client@$PRISMA_VER" 2>/dev/null) || true

      (cd "$PRISMA_TMPDIR" && \
        HOME="$PRISMA_TMPDIR" \
        PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
        "$BUN_BINARY" x --bun "prisma@$PRISMA_VER" generate --schema=prisma/schema.prisma --no-engine --no-hints 2>/dev/null) || true

      # Find where prisma generated the .prisma/client output and copy it
      # (cp -R instead of symlinks — sandbox may not follow symlinks to temp dirs)
      GENERATED=$(find "$PRISMA_TMPDIR" -path '*/.prisma/client' -type d 2>/dev/null | head -1)
      if [ -n "$GENERATED" ] && [ -d "$GENERATED" ]; then
        PRISMA_CLIENT_PKG_FILE=$(find "$BIN_ROOT/node_modules/.aspect_rules_js" -path '*/@prisma+client@*/node_modules/@prisma/client/default.js' 2>/dev/null | head -1)
        if [ -n "$PRISMA_CLIENT_PKG_FILE" ]; then
          NM_DIR="$(dirname "$(dirname "$(dirname "$PRISMA_CLIENT_PKG_FILE")")")"
          rm -rf "$NM_DIR/.prisma/client" 2>/dev/null || true
          mkdir -p "$NM_DIR/.prisma" 2>/dev/null || true
          cp -R "$GENERATED" "$NM_DIR/.prisma/client" 2>/dev/null || true
        fi

        # Also copy into package-level and runfiles node_modules
        if [ -d "$BIN_PKG_DIR/node_modules" ]; then
          rm -rf "$BIN_PKG_DIR/node_modules/.prisma/client" 2>/dev/null || true
          mkdir -p "$BIN_PKG_DIR/node_modules/.prisma" 2>/dev/null || true
          cp -R "$GENERATED" "$BIN_PKG_DIR/node_modules/.prisma/client" 2>/dev/null || true
        fi
      fi
    fi
  fi
fi

exec "$BUN_BINARY" "$ENTRY"
