#!/usr/bin/env bash
# Common shell functions shared by bun_test_runner.sh and typecheck_runner.sh.
# Each runner sources this file after setting RUNFILES and WS.
#
# Expected globals (set by caller before sourcing):
#   BUN_TOOL   — relative path to the Bun binary (from Bazel env)
#   PKG_DIR    — package directory relative to workspace root
#   RUNFILES   — runfiles root
#   WS         — workspace name (e.g. "_main")

# ---------- setup_bun ----------
# Resolves BUN_BINARY to absolute, adds its dir to PATH.
setup_bun() {
  BUN_BINARY="$(cd "$(dirname "$BUN_TOOL")" && pwd)/$(basename "$BUN_TOOL")"
  BUN_DIR="$(dirname "$BUN_BINARY")"
  export PATH="$BUN_DIR:$PATH"
}

# ---------- cd_to_package ----------
# Changes to the package directory within the runfiles tree.
cd_to_package() {
  cd "$RUNFILES/$WS/$PKG_DIR" || exit 1
}

# ---------- discover_bin_tree ----------
# Discovers the bin tree path by resolving a source file symlink.
# Sets: BIN_PKG_DIR, BIN_ROOT, IS_BIN_TREE
discover_bin_tree() {
  BIN_PKG_DIR=""
  BIN_ROOT=""

  FIRST_LINK=$(find . -maxdepth 4 -type l \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) ! -path '*/node_modules/*' 2>/dev/null | head -1 || true)

  if [ -n "$FIRST_LINK" ]; then
    REAL_PATH=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$FIRST_LINK" 2>/dev/null || true)
    if [ -n "$REAL_PATH" ]; then
      REL_SUFFIX="${FIRST_LINK#./}"
      BIN_PKG_DIR="${REAL_PATH%/"$REL_SUFFIX"}"
      BIN_ROOT="${BIN_PKG_DIR%/"$PKG_DIR"}"
    fi
  fi

  IS_BIN_TREE=false
  case "$BIN_ROOT" in
    */bazel-out/*|*/sandbox/*|*/execroot/*) IS_BIN_TREE=true ;;
  esac
}

# ---------- link_workspace_packages ----------
# Creates symlinks for workspace:* deps in the bin tree node_modules.
link_workspace_packages() {
  if [ ! -f package.json ] || [ -z "$BIN_PKG_DIR" ] || [ "$IS_BIN_TREE" != true ]; then
    return
  fi

  ws_deps=$("$BUN_BINARY" -e "
    const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const ws = Object.entries(deps)
      .filter(([, v]) => String(v).startsWith('workspace:'))
      .map(([k]) => k);
    console.log(JSON.stringify(ws));
  " 2>/dev/null || echo '[]')

  if [ "$ws_deps" = "[]" ]; then
    return
  fi

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
  "
}

# ---------- mirror_cross_package_deps ----------
# Mirrors runfiles tree entries into the bin tree so import.meta.dir-based
# relative paths can find cross-package data deps.
mirror_cross_package_deps() {
  if [ "$IS_BIN_TREE" != true ] || [ -z "$BIN_ROOT" ]; then
    return
  fi

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
}

# ---------- _copy_prisma_to_sandbox ----------
# Copies a pre-generated .prisma/client directory into the sandbox's
# node_modules locations where tsc/bun can resolve it.
# Args: $1 = path to directory containing .prisma/client contents
_copy_prisma_to_sandbox() {
  local SRC_DIR="$1"

  # Copy to the aspect_rules_js @prisma/client sibling location.
  # NOTE: This location in the bin tree is shared across sandboxes when
  # multiple Prisma tests run in parallel. The cp is best-effort.
  PRISMA_CLIENT_PKG_FILE=$(find "$BIN_ROOT/node_modules/.aspect_rules_js" -path '*/@prisma+client@*/node_modules/@prisma/client/default.js' 2>/dev/null | head -1)
  if [ -n "$PRISMA_CLIENT_PKG_FILE" ]; then
    NM_DIR="$(dirname "$(dirname "$(dirname "$PRISMA_CLIENT_PKG_FILE")")")"
    rm -rf "$NM_DIR/.prisma/client" 2>/dev/null || true
    mkdir -p "$NM_DIR/.prisma/client" 2>/dev/null || true
    cp -R "$SRC_DIR"/* "$NM_DIR/.prisma/client/" 2>/dev/null || true
  fi

  # Copy to package-level node_modules in bin tree
  if [ -d "$BIN_PKG_DIR/node_modules" ]; then
    rm -rf "$BIN_PKG_DIR/node_modules/.prisma/client" 2>/dev/null || true
    mkdir -p "$BIN_PKG_DIR/node_modules/.prisma/client" 2>/dev/null || true
    cp -R "$SRC_DIR"/* "$BIN_PKG_DIR/node_modules/.prisma/client/" 2>/dev/null || true
  fi

  # Call override hook if defined (typecheck_runner adds extra copy targets)
  if declare -f copy_prisma_client_extra >/dev/null 2>&1; then
    copy_prisma_client_extra "$SRC_DIR"
  fi
}

# ---------- generate_prisma_client ----------
# Sets up Prisma client in the sandbox.
# If PRISMA_CLIENT_DIR is set (pre-generated tree artifact from prisma.bzl),
# copies from there. Otherwise falls back to runtime generation via
# PRISMA_SCHEMA env var.
# Override hook: if copy_prisma_client_extra is defined, it is called with
# the path to the generated .prisma/client directory.
generate_prisma_client() {
  if [ "$IS_BIN_TREE" != true ] || [ -z "$BIN_PKG_DIR" ]; then
    return
  fi

  # Fast path: use pre-generated tree artifact from prisma.bzl rule
  if [ -n "${PRISMA_CLIENT_DIR:-}" ]; then
    local CLIENT_DIR
    # PRISMA_CLIENT_DIR is relative to runfiles root; resolve to absolute
    CLIENT_DIR="$(cd "$RUNFILES/$WS" && cd "$(dirname "$PRISMA_CLIENT_DIR")" && pwd)/$(basename "$PRISMA_CLIENT_DIR")"
    if [ -d "$CLIENT_DIR" ]; then
      _copy_prisma_to_sandbox "$CLIENT_DIR"

      # Support custom output path (e.g. scout-for-lol's generated/prisma/client)
      if [ -n "${PRISMA_CUSTOM_OUTPUT_PATH:-}" ]; then
        local CUSTOM_TARGET="$BIN_PKG_DIR/$PRISMA_CUSTOM_OUTPUT_PATH"
        rm -rf "$CUSTOM_TARGET" 2>/dev/null || true
        mkdir -p "$(dirname "$CUSTOM_TARGET")" 2>/dev/null || true
        cp -R "$CLIENT_DIR" "$CUSTOM_TARGET" 2>/dev/null || true
      fi
    fi
    return
  fi

  # Fallback: runtime generation via PRISMA_SCHEMA
  if [ -z "${PRISMA_SCHEMA:-}" ]; then
    return
  fi

  SCHEMA_PATH="$BIN_PKG_DIR/$PRISMA_SCHEMA"
  if [ ! -f "$SCHEMA_PATH" ]; then
    return
  fi

  # Find the local prisma CLI from node_modules
  PRISMA_CLI=$(find "$BIN_PKG_DIR/node_modules" -path '*/prisma/build/index.js' 2>/dev/null | head -1)
  if [ -z "$PRISMA_CLI" ]; then
    PRISMA_CLI=$(find "$BIN_ROOT/node_modules/.aspect_rules_js" -path '*/node_modules/prisma/build/index.js' 2>/dev/null | head -1)
  fi
  if [ -z "$PRISMA_CLI" ]; then
    return
  fi

  # Run prisma generate in a writable temp directory
  PRISMA_TMPDIR=$(mktemp -d)
  mkdir -p "$PRISMA_TMPDIR/prisma"
  cp "$SCHEMA_PATH" "$PRISMA_TMPDIR/prisma/schema.prisma"
  echo '{"name":"prisma-gen-tmp"}' > "$PRISMA_TMPDIR/package.json"

  # Extract prisma version from the CLI path
  PRISMA_VER="${PRISMA_CLI##*prisma@}"
  PRISMA_VER="${PRISMA_VER%%_*}"
  PRISMA_VER="${PRISMA_VER%%/*}"
  [ -z "$PRISMA_VER" ] && PRISMA_VER="6.19.2"

  # Install @prisma/client so prisma generate can find its output target
  (cd "$PRISMA_TMPDIR" && \
    HOME="$PRISMA_TMPDIR" \
    "$BUN_BINARY" add "@prisma/client@$PRISMA_VER")

  (cd "$PRISMA_TMPDIR" && \
    HOME="$PRISMA_TMPDIR" \
    PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
    "$BUN_BINARY" x --bun "prisma@$PRISMA_VER" generate --schema=prisma/schema.prisma --no-engine --no-hints)

  # Find where prisma generated the .prisma/client output and copy it
  GENERATED=$(find "$PRISMA_TMPDIR" -path '*/.prisma/client' -type d 2>/dev/null | head -1)
  if [ -n "$GENERATED" ] && [ -d "$GENERATED" ]; then
    _copy_prisma_to_sandbox "$GENERATED"
  fi
}
