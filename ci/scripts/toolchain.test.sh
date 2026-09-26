#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TOOLCHAIN="${SCRIPT_DIR}/toolchain.sh"
CI_IMAGE="${SCRIPT_DIR}/../ci-image/Dockerfile"
CI_PLAYWRIGHT_IMAGE="${SCRIPT_DIR}/../ci-playwright/Dockerfile"
BUN_INSTALL_WRAPPER="${SCRIPT_DIR}/bun-install.sh"
MACOS_NATIVE_ENV="${SCRIPT_DIR}/macos-native-env.sh"
REVIEW_GATE="${SCRIPT_DIR}/review-gate.sh"
MAC_CI_BOOTSTRAP="${SCRIPT_DIR}/../../packages/homelab/mac-ci/bootstrap.sh"
MAC_CI_PROVISIONER="${SCRIPT_DIR}/../../packages/homelab/mac-ci/provision-host.sh"
MACOS_LANES="${SCRIPT_DIR}/../../packages/woodpecker-config-extension/src/pipeline/lanes/macos.ts"

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

if ! rg -Fq 'BUN_INSTALL_LOCK_MODE=shared "$GATE_DIR/ci/scripts/bun-install.sh"' "$REVIEW_GATE"; then
  echo "main-sourced review gate must select shared locking for older PR pipelines" >&2
  exit 1
fi

# The bun cache garbage collector was removed with the Buildkite maintenance
# worker that ran it. Woodpecker's cache claim has no collector yet; if one is
# added, its exclusive-lock contract belongs back here.

# The bash guarantee moved from the agent to the pipeline: Buildkite took a
# `shell` setting in the agent config, while Woodpecker's local backend reads
# the step's `image` field as the interpreter. The native steps source
# macos-native-env.sh, so that field must stay `bash`.
if ! rg -Fq 'image: "bash"' "$MACOS_LANES"; then
  echo "macOS lanes must pin bash as the local-backend interpreter for macos-native-env.sh" >&2
  exit 1
fi
if ! rg -Fq 'WOODPECKER_BACKEND=local' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'WOODPECKER_AGENT_LABELS=platform=darwin/' "$MAC_CI_BOOTSTRAP"; then
  echo "macOS agent must run the local backend and carry the label the native lanes select on" >&2
  exit 1
fi
if ! rg -Fq 'AGENT_BUILD_PATH="$HOME/.woodpecker/builds"' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'mise settings set trusted_config_paths "$AGENT_BUILD_PATH"' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'WOODPECKER_BACKEND_LOCAL_TEMP_DIR=$AGENT_BUILD_PATH' "$MAC_CI_BOOTSTRAP"; then
  echo "macOS bootstrap must trust the same checkout root it configures" >&2
  exit 1
fi
if ! rg -Fq 'mise exec --cd "$REPO_ROOT" -- rustup target add' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'aarch64-apple-darwin' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'x86_64-apple-darwin' "$MAC_CI_BOOTSTRAP"; then
  echo "macOS bootstrap must install both TaskNotes universal Rust targets" >&2
  exit 1
fi
if ! rg -Fq 'displaysleep 0' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'com.apple.screensaver idleTime -int 0' "$MAC_CI_BOOTSTRAP" ||
  ! rg -Fq 'sysadminctl -screenLock off -password -' "$MAC_CI_BOOTSTRAP"; then
  echo "macOS bootstrap must keep the accepted CI GUI session unlocked" >&2
  exit 1
fi
if ! rg -Fq 'sudo /usr/bin/automationmodetool enable-automationmode-without-authentication' "$MAC_CI_PROVISIONER" ||
  ! rg -Fq '/usr/bin/automationmodetool' "$MAC_CI_PROVISIONER"; then
  echo "macOS provisioner must configure passwordless Automation Mode" >&2
  exit 1
fi

# The bun cache garbage collector's behavioural tests were removed with the
# collector itself. If a Woodpecker equivalent is written, its below-threshold
# preservation and exclusive-lock behaviour belong back here.

echo "toolchain and cache-lifecycle tests passed"
