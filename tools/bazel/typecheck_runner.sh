#!/usr/bin/env bash
# Shell wrapper for running tsc type checking in the Bazel sandbox.
# Sets up workspace package symlinks before running tsc, so that
# cross-package imports resolve correctly.
#
# This mirrors the workspace resolution logic from bun_test_runner.sh.

set -euo pipefail

# Resolve tool paths to absolute before changing directories
BUN_BINARY="$(cd "$(dirname "$BUN_TOOL")" && pwd)/$(basename "$BUN_TOOL")"

# Add Bun to PATH for running inline JS helpers
BUN_DIR="$(dirname "$BUN_BINARY")"
export PATH="$BUN_DIR:$PATH"

# Change to the package directory within the runfiles tree
RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

# Discover the bin tree path by resolving a source file symlink.
BIN_PKG_DIR=""
BIN_ROOT=""

FIRST_LINK=$(find . -maxdepth 4 -type l \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) ! -path '*/node_modules/*' 2>/dev/null | head -1)

if [ -n "$FIRST_LINK" ]; then
  REAL_PATH=$("$BUN_BINARY" -e "console.log(require('fs').realpathSync(process.argv[1]))" "$FIRST_LINK" 2>/dev/null || true)
  if [ -n "$REAL_PATH" ]; then
    REL_SUFFIX="${FIRST_LINK#./}"
    BIN_PKG_DIR="${REAL_PATH%/"$REL_SUFFIX"}"
    BIN_ROOT="${BIN_PKG_DIR%/"$PKG_DIR"}"
  fi
fi

# Only proceed with bin tree operations if we resolved to a sandboxed bin tree
IS_BIN_TREE=false
case "$BIN_ROOT" in
  */bazel-out/*|*/sandbox/*|*/execroot/*) IS_BIN_TREE=true ;;
esac

# Link workspace packages into node_modules so tsc can resolve them.
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

# Link devDependency-as-peer packages into their consumer's node_modules.
# Some packages (e.g. discord-player-youtubei) import packages that are only
# listed as devDependencies, so aspect_rules_js doesn't add them to the sandbox.
# Without this, TypeScript can't resolve those imports via real paths when
# --preserveSymlinks is off. Set DEV_PEER_LINKS="consumer:dep" in BUILD.bazel.
if [ -n "${DEV_PEER_LINKS:-}" ] && [ "$IS_BIN_TREE" = true ] && [ -n "$BIN_ROOT" ]; then
  ASPECT_DIR="$BIN_ROOT/node_modules/.aspect_rules_js"
  if [ -d "$ASPECT_DIR" ]; then
    IFS=',' read -ra PAIRS <<< "$DEV_PEER_LINKS"
    for pair in "${PAIRS[@]}"; do
      CONSUMER="${pair%%:*}"
      DEP="${pair##*:}"
      # Find the consumer's versioned dir in .aspect_rules_js
      CONSUMER_VERSIONED=""
      for d in "$ASPECT_DIR/${CONSUMER}@"*/; do
        [ -d "$d" ] && CONSUMER_VERSIONED="$(basename "$d")" && break
      done
      if [ -n "$CONSUMER_VERSIONED" ]; then
        CONSUMER_NM="$ASPECT_DIR/$CONSUMER_VERSIONED/node_modules"
        if [ -d "$CONSUMER_NM" ] && [ ! -e "$CONSUMER_NM/$DEP" ]; then
          # Find the dep's versioned dir
          DEP_VERSIONED=""
          for d in "$ASPECT_DIR/${DEP}@"*/; do
            [ -d "$d" ] && DEP_VERSIONED="$(basename "$d")" && break
          done
          if [ -n "$DEP_VERSIONED" ]; then
            DEP_TARGET="$ASPECT_DIR/$DEP_VERSIONED/node_modules/$DEP"
            if [ -d "$DEP_TARGET" ]; then
              ln -sf "$DEP_TARGET" "$CONSUMER_NM/$DEP" 2>/dev/null || true
            fi
          fi
        fi
      fi
    done
  fi
fi

# Mirror runfiles tree entries into bin tree for cross-package data deps
if [ "$IS_BIN_TREE" = true ] && [ -n "$BIN_ROOT" ]; then
  RUNFILES_PKG="$RUNFILES/$WS"
  if [ -d "$RUNFILES_PKG/packages" ]; then
    find "$RUNFILES_PKG/packages" \( -type f -o -type l \) 2>/dev/null | while IFS= read -r rf_file; do
      file_rel="${rf_file#"$RUNFILES_PKG"/}"
      bin_target="$BIN_ROOT/$file_rel"
      if [ ! -e "$bin_target" ]; then
        mkdir -p "$(dirname "$bin_target")" 2>/dev/null || true
        ln -sf "$rf_file" "$bin_target" 2>/dev/null || true
      fi
    done
  fi
  # Mirror root-level files (e.g. tsconfig.base.json) from runfiles to bin tree
  # so that relative extends paths like "../../tsconfig.base.json" resolve.
  for rf_file in "$RUNFILES_PKG"/tsconfig*.json; do
    [ -e "$rf_file" ] || continue
    file_rel="${rf_file#"$RUNFILES_PKG"/}"
    bin_target="$BIN_ROOT/$file_rel"
    if [ ! -e "$bin_target" ]; then
      ln -sf "$rf_file" "$bin_target" 2>/dev/null || true
    fi
  done
fi

# Generate Prisma client if PRISMA_SCHEMA is set.
# Prisma's @prisma/client exports model types (PrismaClient, etc.) only after
# `prisma generate`. We generate in a writable temp directory, then symlink
# the output into the bin tree where tsc can find it.
if [ -n "${PRISMA_SCHEMA:-}" ] && [ "$IS_BIN_TREE" = true ] && [ -n "$BIN_PKG_DIR" ]; then
  SCHEMA_PATH="$BIN_PKG_DIR/$PRISMA_SCHEMA"
  if [ -f "$SCHEMA_PATH" ]; then
    PRISMA_CLI=$(find "$BIN_PKG_DIR/node_modules" -path '*/prisma/build/index.js' 2>/dev/null | head -1)
    if [ -z "$PRISMA_CLI" ]; then
      PRISMA_CLI=$(find "$BIN_ROOT/node_modules/.aspect_rules_js" -path '*/node_modules/prisma/build/index.js' 2>/dev/null | head -1)
    fi
    if [ -n "$PRISMA_CLI" ]; then
      PRISMA_TMPDIR=$(mktemp -d)
      mkdir -p "$PRISMA_TMPDIR/prisma"
      cp "$SCHEMA_PATH" "$PRISMA_TMPDIR/prisma/schema.prisma"
      echo '{"name":"prisma-gen-tmp"}' > "$PRISMA_TMPDIR/package.json"

      PRISMA_VER="${PRISMA_CLI##*prisma@}"
      PRISMA_VER="${PRISMA_VER%%_*}"
      PRISMA_VER="${PRISMA_VER%%/*}"
      [ -z "$PRISMA_VER" ] && PRISMA_VER="6.19.2"

      (cd "$PRISMA_TMPDIR" && \
        HOME="$PRISMA_TMPDIR" \
        "$BUN_BINARY" add "@prisma/client@$PRISMA_VER" 2>/dev/null) || true

      (cd "$PRISMA_TMPDIR" && \
        HOME="$PRISMA_TMPDIR" \
        PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
        "$BUN_BINARY" x --bun "prisma@$PRISMA_VER" generate \
          --schema=prisma/schema.prisma --no-engine --no-hints 2>/dev/null) || true

      GENERATED=$(find "$PRISMA_TMPDIR" -path '*/.prisma/client' -type d 2>/dev/null | head -1)
      if [ -n "$GENERATED" ] && [ -d "$GENERATED" ]; then
        # Copy generated .prisma/client into all node_modules locations where
        # tsc might resolve it. We use cp -R instead of symlinks because the
        # sandbox may not follow symlinks to temp directories.

        # 1. Bin tree's @prisma/client sibling
        PRISMA_CLIENT_PKG_FILE=$(find "$BIN_ROOT/node_modules/.aspect_rules_js" -path '*/@prisma+client@*/node_modules/@prisma/client/default.js' 2>/dev/null | head -1)
        if [ -n "$PRISMA_CLIENT_PKG_FILE" ]; then
          NM_DIR="$(dirname "$(dirname "$(dirname "$PRISMA_CLIENT_PKG_FILE")")")"
          rm -rf "$NM_DIR/.prisma/client" 2>/dev/null || true
          mkdir -p "$NM_DIR/.prisma" 2>/dev/null || true
          cp -R "$GENERATED" "$NM_DIR/.prisma/client" 2>/dev/null || true
        fi

        # 2. Package-level node_modules in bin tree
        if [ -d "$BIN_PKG_DIR/node_modules" ]; then
          rm -rf "$BIN_PKG_DIR/node_modules/.prisma/client" 2>/dev/null || true
          mkdir -p "$BIN_PKG_DIR/node_modules/.prisma" 2>/dev/null || true
          cp -R "$GENERATED" "$BIN_PKG_DIR/node_modules/.prisma/client" 2>/dev/null || true
        fi

        # 3. Runfiles-level package node_modules (tsc cwd)
        RUNFILES_NM="$RUNFILES/$WS/$PKG_DIR/node_modules"
        if [ -d "$RUNFILES_NM" ]; then
          rm -rf "$RUNFILES_NM/.prisma/client" 2>/dev/null || true
          mkdir -p "$RUNFILES_NM/.prisma" 2>/dev/null || true
          cp -R "$GENERATED" "$RUNFILES_NM/.prisma/client" 2>/dev/null || true
        fi

        # 4. Root runfiles node_modules (aspect_rules_js @prisma/client sibling)
        RUNFILES_ROOT_NM="$RUNFILES/$WS/node_modules/.aspect_rules_js"
        PRISMA_CLIENT_ASPECT=$(find "$RUNFILES_ROOT_NM" -maxdepth 5 -path '*/@prisma+client@*/node_modules/@prisma/client' -type d 2>/dev/null | head -1)
        if [ -n "$PRISMA_CLIENT_ASPECT" ]; then
          ASPECT_NM_DIR="$(dirname "$(dirname "$PRISMA_CLIENT_ASPECT")")"
          rm -rf "$ASPECT_NM_DIR/.prisma/client" 2>/dev/null || true
          mkdir -p "$ASPECT_NM_DIR/.prisma" 2>/dev/null || true
          cp -R "$GENERATED" "$ASPECT_NM_DIR/.prisma/client" 2>/dev/null || true
        fi
      fi
    fi
  fi
fi

# Find tsc.js from node_modules (typescript/lib/tsc.js)
RUNFILES_ROOT="$RUNFILES/$WS"
TSC_JS="$RUNFILES_ROOT/node_modules/typescript/lib/tsc.js"
if [ ! -f "$TSC_JS" ]; then
  echo "ERROR: tsc.js not found at $TSC_JS" >&2
  exit 1
fi

# Run tsc via Bun (Bun is our Node.js replacement in the sandbox)
# --preserveSymlinks is needed for workspace symlink resolution but breaks
# packages with complex export maps (e.g. discord.js). Controlled via env var.
TSC_ARGS=(--noEmit --skipLibCheck --project tsconfig.json)
if [ "${NO_PRESERVE_SYMLINKS:-}" != "1" ]; then
  TSC_ARGS+=(--preserveSymlinks)
fi
exec "$BUN_BINARY" "$TSC_JS" "${TSC_ARGS[@]}" "$@"
