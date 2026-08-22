#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOLCHAIN="${SCRIPT_DIR}/toolchain.sh"
CI_IMAGE="${SCRIPT_DIR}/../ci-image/Dockerfile"
CI_PLAYWRIGHT_IMAGE="${SCRIPT_DIR}/../ci-playwright/Dockerfile"
BUN_INSTALL_WRAPPER="${SCRIPT_DIR}/bun-install.sh"
MACOS_NATIVE_ENV="${SCRIPT_DIR}/macos-native-env.sh"
BUN_CACHE_GC="${SCRIPT_DIR}/../../packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite-bun-cache-gc.sh"
MAC_CI_BOOTSTRAP="${SCRIPT_DIR}/../../packages/homelab/mac-ci/bootstrap.sh"

if ! awk '
  $0 ~ /^[[:space:]]*mise_ci install --yes[[:space:]]*$/ { install_line = NR }
  $0 ~ /^[[:space:]]*mise_ci reshim[[:space:]]*$/ { reshim_line = NR }
  $0 ~ /^[[:space:]]*GH_EXECUTABLE=\$\(mise_ci which gh\)[[:space:]]*$/ { gh_lookup_line = NR }
  $0 ~ /^[[:space:]]*ln -sf "\$GH_EXECUTABLE" \/usr\/local\/bin\/gh[[:space:]]*$/ { gh_link_line = NR }
  END {
    valid = install_line > 0
    valid = valid && reshim_line > install_line
    valid = valid && gh_lookup_line > reshim_line
    valid = valid && gh_link_line > gh_lookup_line
    if (!valid) {
      exit 1
    }
  }
' "$TOOLCHAIN"; then
  echo "toolchain must expose the installed gh binary to login shells" >&2
  exit 1
fi

if ! rg -Fq 'mise_ci where node' "$TOOLCHAIN" ||
  ! rg -Fq 'mise_ci install --yes --force node' "$TOOLCHAIN"; then
  echo "CI toolchain must repair and verify Node for manifest Node runtimes" >&2
  exit 1
fi

if ! rg -Fq 'ln -sf "$(mise which gh)" /usr/local/bin/gh' "$CI_IMAGE" ||
  ! rg -Fq '&& gh --version' "$CI_IMAGE"; then
  echo "ci image must expose the mise-owned gh binary to login shells" >&2
  exit 1
fi

if ! rg -wq 'util-linux' "$CI_IMAGE" ||
  ! rg -Fq '&& flock --version' "$CI_IMAGE"; then
  echo "ci image must explicitly install and verify flock for cross-pod cache locking" >&2
  exit 1
fi

if ! rg -wq 'libxml2' "$CI_IMAGE" ||
  ! rg -Fq "libxml2.so.2" "$TOOLCHAIN"; then
  echo "CI toolchain must provide libxml2 for the mise-managed PostgreSQL binaries" >&2
  exit 1
fi

if rg -q 'apt-get|playwright install|bun x' "$CI_PLAYWRIGHT_IMAGE" ||
  ! rg -Fq 'Bun.file("/ms-playwright/.docker-info").json()' "$CI_PLAYWRIGHT_IMAGE" ||
  ! rg -Fq 'typeof info.driverVersion !== "string"' "$CI_PLAYWRIGHT_IMAGE" ||
  ! rg -Fq 'chromium-*/chrome-linux*/chrome' "$CI_PLAYWRIGHT_IMAGE" ||
  ! rg -Fq 'firefox-*/firefox/firefox' "$CI_PLAYWRIGHT_IMAGE" ||
  ! rg -Fq 'webkit-*/minibrowser-gtk/MiniBrowser' "$CI_PLAYWRIGHT_IMAGE"; then
  echo "Playwright CI image must use the pinned browser inventory without runtime installation" >&2
  exit 1
fi

if ! rg -Fq 'ARG MISE_MINISIGN_PUBLIC_KEY=' "$CI_IMAGE" ||
  ! rg -Fq 'minisign -V -P "${MISE_MINISIGN_PUBLIC_KEY}"' "$CI_IMAGE" ||
  ! rg -Fq 'checksum_line="$(grep -F "  ./${mise_asset}" SHASUMS256.txt)"' "$CI_IMAGE" ||
  rg -q '^ARG MISE_(AMD64|ARM64)_SHA256=' "$CI_IMAGE"; then
  echo "ci image must derive mise asset checksums from the signed release manifest" >&2
  exit 1
fi

if ! rg -Fq 'flock --shared 9' "$BUN_INSTALL_WRAPPER" ||
  ! rg -Fq 'bun install "$@"' "$BUN_INSTALL_WRAPPER" ||
  ! rg -Fq ') 9>"$CACHE_LOCK_FILE"' "$BUN_INSTALL_WRAPPER"; then
  echo "bun install wrapper must hold the shared cache lock for the complete install" >&2
  exit 1
fi

if ! rg -Fq 'flock --exclusive 9' "$BUN_CACHE_GC" ||
  ! rg -Fq 'find "$CACHE_DIR" -mindepth 1 -depth -delete' "$BUN_CACHE_GC"; then
  echo "bun cache collector must clear only while holding the exclusive cache lock" >&2
  exit 1
fi

if ! rg -Fq 'shell="/bin/bash -e -c"' "$MAC_CI_BOOTSTRAP"; then
  echo "macOS agent config must pin bash for the native steps that source macos-native-env.sh" >&2
  exit 1
fi
if ! rg -Fq 'AGENT_BUILD_PATH="$HOME/.buildkite-agent/builds"' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'mise settings set trusted_config_paths "$AGENT_BUILD_PATH"' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'build-path="$AGENT_BUILD_PATH"' "$MAC_CI_BOOTSTRAP"; then
  echo "macOS bootstrap must trust the same Buildkite checkout root it configures" >&2
  exit 1
fi

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/cache/data" "$TEST_ROOT/control"

cat >"$TEST_ROOT/bin/df" <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'cache 100 50 50 %s%% /cache\n' "$BUN_GC_TEST_USAGE"
EOF
cat >"$TEST_ROOT/bin/bun" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$BUN_GC_TEST_LOG"
EOF
cat >"$TEST_ROOT/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TEST_ROOT/bin/df" "$TEST_ROOT/bin/bun" "$TEST_ROOT/bin/flock"

touch "$TEST_ROOT/cache/data/below-threshold-marker"
BUN_INSTALL_CACHE_DIR="$TEST_ROOT/cache/data" \
  BUN_CACHE_LOCK_FILE="$TEST_ROOT/control/.gc.lock" \
  BUN_CACHE_GC_THRESHOLD_PERCENT=60 \
  BUN_GC_TEST_USAGE=42 \
  BUN_GC_TEST_LOG="$TEST_ROOT/bun.log" \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$BUN_CACHE_GC"
if [[ ! -e "$TEST_ROOT/cache/data/below-threshold-marker" ]]; then
  echo "bun cache collector must preserve a cache below its threshold" >&2
  exit 1
fi

mkdir -p "$TEST_ROOT/cache/data/nested"
touch "$TEST_ROOT/cache/data/nested/cache-entry"
BUN_INSTALL_CACHE_DIR="$TEST_ROOT/cache/data" \
  BUN_CACHE_LOCK_FILE="$TEST_ROOT/control/.gc.lock" \
  BUN_CACHE_GC_THRESHOLD_PERCENT=60 \
  BUN_GC_TEST_USAGE=75 \
  BUN_GC_TEST_LOG="$TEST_ROOT/bun.log" \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$BUN_CACHE_GC"
if [[ -n $(find "$TEST_ROOT/cache/data" -mindepth 1 -print -quit) ]]; then
  echo "bun cache collector must remove every cache entry above its threshold" >&2
  exit 1
fi
if [[ ! -e "$TEST_ROOT/control/.gc.lock" ]]; then
  echo "bun cache collector must preserve the independent coordination lock" >&2
  exit 1
fi

: >"$TEST_ROOT/bun.log"
BUN_CACHE_LOCK_FILE="$TEST_ROOT/control/.gc.lock" \
  BUN_INSTALL_LOCK_MODE=shared \
  BUN_GC_TEST_LOG="$TEST_ROOT/bun.log" \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$BUN_INSTALL_WRAPPER" --frozen-lockfile --filter example
if [[ $(<"$TEST_ROOT/bun.log") != "install --frozen-lockfile --filter example" ]]; then
  echo "bun install wrapper must preserve every install argument" >&2
  exit 1
fi

: >"$TEST_ROOT/bun.log"
BUN_INSTALL_LOCK_MODE=local \
  BUN_GC_TEST_LOG="$TEST_ROOT/bun.log" \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$BUN_INSTALL_WRAPPER" --frozen-lockfile --filter native-example
if [[ $(<"$TEST_ROOT/bun.log") != "install --frozen-lockfile --filter native-example" ]]; then
  echo "local Bun install mode must preserve every install argument" >&2
  exit 1
fi

if BUN_INSTALL_LOCK_MODE=local \
  BUN_CACHE_LOCK_FILE="$TEST_ROOT/control/.gc.lock" \
  BUN_GC_TEST_LOG="$TEST_ROOT/bun.log" \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$BUN_INSTALL_WRAPPER" --frozen-lockfile; then
  echo "local Bun install mode must reject a shared lock path" >&2
  exit 1
fi

if BUN_INSTALL_LOCK_MODE=unknown \
  BUN_GC_TEST_LOG="$TEST_ROOT/bun.log" \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$BUN_INSTALL_WRAPPER" --frozen-lockfile; then
  echo "Bun install wrapper must reject an unknown lock mode" >&2
  exit 1
fi

mkdir -p "$TEST_ROOT/home"
HOME="$TEST_ROOT/home" \
  BUN_CACHE_LOCK_FILE="$TEST_ROOT/control/.gc.lock" \
  TURBO_API=http://linux-cache.invalid \
  TURBO_CACHE=remote:rw \
  TURBO_SCM_BASE=origin/main \
  TURBO_TEAM=monorepo \
  TURBO_TELEMETRY_DISABLED=1 \
  TURBO_TOKEN=secret \
  bash -c '
    set -euo pipefail
    source "$1"
    [[ "$BUN_INSTALL_LOCK_MODE" == "local" ]]
    [[ "$MISE_AUTO_INSTALL" == "0" ]]
    [[ "$MISE_NOT_FOUND_AUTO_INSTALL" == "0" ]]
    [[ "$BUN_INSTALL_CACHE_DIR" == "$HOME/Library/Caches/Bun/install/cache" ]]
    [[ -z "${BUN_CACHE_LOCK_FILE+x}" ]]
    [[ -z "${TURBO_API+x}" ]]
    [[ -z "${TURBO_CACHE+x}" ]]
    [[ -z "${TURBO_SCM_BASE+x}" ]]
    [[ -z "${TURBO_TEAM+x}" ]]
    [[ -z "${TURBO_TELEMETRY_DISABLED+x}" ]]
    [[ -z "${TURBO_TOKEN+x}" ]]
  ' _ "$MACOS_NATIVE_ENV"

# A non-bash shell is simulated by unsetting BASH_VERSION rather than invoking
# /bin/sh, which is bash in POSIX mode on macOS and would still define it.
if bash -c 'unset BASH_VERSION; . "$1"' _ "$MACOS_NATIVE_ENV" \
  >"$TEST_ROOT/native-env-shell.log" 2>&1; then
  echo "macos-native-env.sh must refuse a shell that is not bash" >&2
  exit 1
fi
if ! rg -Fq 'requires bash' "$TEST_ROOT/native-env-shell.log"; then
  echo "macos-native-env.sh must name the bash requirement when it refuses" >&2
  exit 1
fi

echo "toolchain and cache-lifecycle tests passed"
