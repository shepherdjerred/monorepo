#!/usr/bin/env bash
# Toolchain preamble — `source`d as the first line of every pipeline step
# that runs repo tasks. On a current ci-base image `mise install` is a fast
# no-op; on a stale one (a PR just changed .mise.toml, or the image predates
# this pipeline) mise bootstraps itself and installs the missing tools at
# runtime, so a toolchain change never waits for the main-only image refresh.
set -eu
# pipefail is not POSIX (dash lacks it) and a step may run under /bin/sh.
# Enable it when the shell is bash; plain sh proceeds without.
case "${BASH_VERSION:-}" in "") ;; *) set -o pipefail ;; esac
CI_TOOLCHAIN_STARTED=$(date +%s)

# Step scratch belongs on the workflow's ZFS volume, not the container's
# writable layer: that layer is the CI node's OS disk (Talos /var), and
# per-run test scratch such as Scout's Postgres cluster and Gradle's
# dependency downloads was wearing it out. TMPDIR is sticky and
# world-writable like /tmp, because root-hosted tests run the Postgres server
# as nobody.
case "${CI_WORKSPACE:-}" in
  /woodpecker/*)
    export TMPDIR=/woodpecker/tmp
    mkdir -p "$TMPDIR"
    chmod 1777 "$TMPDIR"
    # Gradle's writable caches require lock-owner communication, which does
    # not work across step pods. Keep the home on this workflow's volume,
    # overriding shared paths emitted by older configuration extensions too.
    export GRADLE_USER_HOME=/woodpecker/gradle
    if [ -d "$PWD/.git/ci-gradle-seed/modules-2" ]; then
      export GRADLE_RO_DEP_CACHE="$PWD/.git/ci-gradle-seed"
    fi
    ;;
esac

# Cargo keeps its registry and Git checkouts under CARGO_HOME next to the
# rustup-managed toolchain, with no variable for the caches alone. Moving
# CARGO_HOME would move the toolchain too (and mise would reinstall it), so
# link just the two cache directories to the shared cache claim the emitter
# mounted. On an image layer the removal is a whiteout, not a copy-up.
if [ -n "${CI_CARGO_CACHE_DIR:-}" ]; then
  cargo_home="${CARGO_HOME:-$HOME/.cargo}"
  mkdir -p "$CI_CARGO_CACHE_DIR/registry" "$CI_CARGO_CACHE_DIR/git" "$cargo_home"
  for cargo_cache in registry git; do
    rm -rf "${cargo_home:?}/${cargo_cache}"
    ln -s "$CI_CARGO_CACHE_DIR/$cargo_cache" "$cargo_home/$cargo_cache"
  done
fi

# Stale images without mise (the Playwright image) bootstrap the same release
# ci-base pins, so both read mise.lock's format identically.
# renovate: datasource=github-releases depName=jdx/mise
MISE_BOOTSTRAP_VERSION="v2026.10.6"
# An image baked before the pin carries an older mise that rejects the
# lockfile's format, so replace any mise older than the pin, not only a missing
# one. The installer targets ~/.local/bin, which the PATH below puts first.
mise_current() {
  command -v mise >/dev/null || return 1
  installed=$(mise --version | awk 'NR == 1 {print $1}')
  [ -n "$installed" ] || return 1
  oldest=$(printf '%s\n%s\n' "${MISE_BOOTSTRAP_VERSION#v}" "$installed" | sort -V | head -n 1)
  [ "$oldest" = "${MISE_BOOTSTRAP_VERSION#v}" ]
}
mise_current ||
  curl -fsSL https://mise.run | MISE_VERSION="$MISE_BOOTSTRAP_VERSION" sh
if [ "$(id -u)" -eq 0 ]; then
  # Root-hosted tests drop Postgres server processes to nobody. Keep the
  # mise shims and installed binaries outside /root so that user can execute
  # them.
  export MISE_DATA_DIR=/opt/mise
fi
export PATH="/opt/mise/shims:$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
# Install exactly the URLs and checksums mise.lock records instead of asking
# api.github.com to resolve versions and release assets: those lookups draw on
# the same 5,000/hr bucket as every other CI and agent GitHub read. Locked mode
# fails on a tool the lockfile does not cover rather than resolving it.
export MISE_LOCKED=1
# Downloads and provenance checks can still reach GitHub; unauthenticated calls
# share the cluster egress IP's 60/hr limit, which CI exhausts immediately.
# Scope the download-only identity to mise itself instead of exporting a
# general GitHub token to every command the step runs.
mise_ci() {
  if [ -n "${GITHUB_DOWNLOAD_TOKEN:-}" ]; then
    GITHUB_TOKEN="$GITHUB_DOWNLOAD_TOKEN" mise "$@"
  else
    mise "$@"
  fi
}
mise trust .mise.toml

# Recursive `chmod a+rX` limited to the entries that lack those bits. GNU chmod
# issues the syscall even when the mode already matches, and on an image layer
# every such call copies the file up into the container's writable layer -- the
# CI node's OS disk. A current image already carries the bits, so this touches
# nothing; a stale image's runtime installs still get exposed.
expose_tree() {
  find "$1" \( \( -type d ! -perm -0555 \) -o \( -type f ! -perm -0444 \) \
    -o \( -type f -perm /0111 ! -perm -0555 \) \) -exec chmod a+rX {} +
}

expose_postgres_tools() {
  if [ "$(id -u)" -eq 0 ] && [ -d "${MISE_DATA_DIR:-}/shims" ]; then
    # Root-hosted tests run the Postgres server as nobody. Runtime mise
    # installs inherit root's umask, so expose only the public shims and the
    # pinned Postgres installation to that test user.
    chmod a+rX "${MISE_DATA_DIR}" "${MISE_DATA_DIR}/shims"
    if [ -d "${MISE_DATA_DIR}/installs" ]; then
      chmod a+rX "${MISE_DATA_DIR}/installs"
    fi
    expose_tree "${MISE_DATA_DIR}/shims"
    if [ -d "${MISE_DATA_DIR}/installs/github-theseus-rs-postgresql-binaries" ]; then
      expose_tree "${MISE_DATA_DIR}/installs/github-theseus-rs-postgresql-binaries"
    fi
  fi
}

case "${MISE_TOOLCHAIN_SCOPE:-full}" in
  preflight)
    mise_ci install --yes bun gitleaks
    mise_ci reshim
    ;;
  runtime)
    # SQLite-only lanes need Bun but must not resolve unrelated tools such as
    # the PostgreSQL binaries, which can exhaust the shared GitHub API quota.
    mise_ci install --yes bun
    mise_ci reshim
    ;;
  tofu)
    # Grouped PR plan containers share installed workspace dependencies, but
    # each container still resolves its own pinned runtime from the CI image.
    mise_ci install --yes bun opentofu
    mise_ci reshim
    ;;
  automation)
    # Repository automation and remote image orchestration use these CLIs;
    # Docker/buildx and git are supplied by the pinned base image.
    mise_ci install --yes bun gh jq
    mise_ci reshim
    # Release-note refinement invokes gh from a login shell.
    GH_EXECUTABLE=$(mise_ci which gh)
    ln -sf "$GH_EXECUTABLE" /usr/local/bin/gh
    ;;
  deployment)
    # Helm/GitOps and site publication do not run the exhaustive test graph.
    mise_ci install --yes bun node gh jq helm argocd awscli
    mise_ci reshim
    ;;
  postgres)
    # The Playwright image carries browsers and Bun, but its refresh is
    # main-only: a PR that bumps .mise.toml would otherwise run E2E under a
    # stale Bun. Resolve the repo-pinned Bun at runtime (mise shims precede
    # /usr/local/bin on PATH, so the pin wins; a no-op on a fresh image).
    # Scout's Storybook preview must run under Node: Bun's HTTP response
    # stream can terminate the preview partway through the catalog suite.
    # Install the pinned Node runtime here so the `node` script cannot resolve
    # to Bun when the Playwright image lacks a mise-managed Node install.
    # Postgres binaries and the Temporal CLI ride along because this scope
    # skips the complete CI toolchain (which includes Rust/Cargo tools that
    # cannot build in that image). The Temporal CLI is a prebuilt aqua binary,
    # not a build, so it costs nothing extra here; the nightly Scout design
    # audit boots the real backend via scripts/dev/dev-web.ts, which spawns
    # `temporal server start-dev` unconditionally (dev-web-temporal.ts) and
    # has no way to run without it.
    mise_ci install --yes bun node 'github:theseus-rs/postgresql-binaries' 'aqua:temporalio/cli'
    mise_ci reshim
    expose_postgres_tools
    ;;
  full)
    mise_ci install --yes
    # The CI manifest runs Temporal workflow suites under Node rather than
    # Bun. A stale image can retain a broken install record for Node while
    # `mise install` otherwise succeeds, so repair that exact tool and prove
    # it resolves before allowing the manifest runner to start.
    if ! mise_ci where node; then
      mise_ci install --yes --force node
      mise_ci where node
    fi
    expose_postgres_tools
    # Runtime installs can add a tool without creating its executable shim on a
    # stale ci-base image. Rebuild shims so commands such as gh are reachable
    # through the PATH exported above (release build 6529).
    mise_ci reshim
    # Public SDK bootstrap only; product behavior does not use environment vars.
    # Match ci/ci-image/Dockerfile and repair stale x86_64 images at runtime.
    export ANDROID_HOME=/opt/android-sdk
    export ANDROID_SDK_ROOT="$ANDROID_HOME"
    if [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]; then
      bash ci/scripts/android-sdk.sh
    fi
    # Codex executes tool calls through a login shell, whose /etc/profile can
    # replace PATH and hide mise shims (release build 6549). Expose the real
    # mise-managed binary on the login shell's stable system path.
    GH_EXECUTABLE=$(mise_ci which gh)
    ln -sf "$GH_EXECUTABLE" /usr/local/bin/gh

    # System tools the tasks shell out to that mise doesn't manage. Baked into
    # the fresh ci-base; bootstrapped here on a stale image.
    if ! command -v rsync >/dev/null; then
      apt-get update -qq && apt-get install -y -qq --no-install-recommends rsync
    fi
    # RWF blind-review media tests exercise real encoding and metadata removal.
    # Install both executables on older images before the test manifest runs.
    if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
      apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg
    fi
    ffmpeg -version >/dev/null
    ffprobe -version >/dev/null
    if ! ldconfig -p | grep -Fq 'libxml2.so.2'; then
      apt-get update -qq && apt-get install -y -qq --no-install-recommends libxml2
    fi
    # Verify capabilities even when the executable exists; stale static builds
    # skip configured rules. The shared producer exports only a private runtime.
    bash ci/scripts/swiftlint/bootstrap.sh
    ;;
  *)
    echo "Unknown MISE_TOOLCHAIN_SCOPE: ${MISE_TOOLCHAIN_SCOPE}" >&2
    false
    ;;
esac

# Emit only fixed-schema measurements. Local shells without a CI commit do not
# produce pipeline evidence; malformed commit identifiers are never interpolated.
case "${CI_COMMIT_SHA:-}" in
  ''|*[!0-9a-f]*) ;;
  *)
    if [ "${#CI_COMMIT_SHA}" -eq 40 ]; then
      CI_TOOLCHAIN_FINISHED=$(date +%s)
      printf 'CI_BOOTSTRAP_DIAGNOSTIC {"schemaVersion":1,"sourceSha":"%s","scope":"%s","elapsedSeconds":%s}\n' \
        "$CI_COMMIT_SHA" "${MISE_TOOLCHAIN_SCOPE:-full}" "$((CI_TOOLCHAIN_FINISHED - CI_TOOLCHAIN_STARTED))"
    fi
    ;;
esac
