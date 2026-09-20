#!/usr/bin/env bash
# Toolchain preamble — `source`d as the first line of every pipeline step
# that runs repo tasks. On a current ci-base image `mise install` is a fast
# no-op; on a stale one (a PR just changed .mise.toml, or the image predates
# this pipeline) mise bootstraps itself and installs the missing tools at
# runtime, so a toolchain change never waits for the main-only image refresh.
set -eu
# pipefail is not POSIX (dash lacks it) and the agent may run steps under
# /bin/sh (build 5651/5654 — the agent-stack registration env forces the
# agent image's default shell until the step-shell controller fix is
# deployed). Enable it when the shell is bash; plain sh proceeds without.
case "${BASH_VERSION:-}" in "") ;; *) set -o pipefail ;; esac

command -v mise >/dev/null || curl -fsSL https://mise.run | sh
if [ "$(id -u)" -eq 0 ]; then
  # Root-hosted tests drop Postgres server processes to nobody. Keep the
  # mise shims and installed binaries outside /root so that user can execute
  # them.
  export MISE_DATA_DIR=/opt/mise
fi
export PATH="/opt/mise/shims:$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
# mise resolves tool versions via api.github.com; unauthenticated calls share
# the cluster egress IP's 60/hr limit, which CI exhausts immediately. Scope the
# download-only identity to mise itself instead of exporting a general GitHub
# token to every command the step runs.
mise_ci() {
  if [ -n "${GITHUB_DOWNLOAD_TOKEN:-}" ]; then
    GITHUB_TOKEN="$GITHUB_DOWNLOAD_TOKEN" mise "$@"
  else
    mise "$@"
  fi
}
mise trust .mise.toml

expose_postgres_tools() {
  if [ "$(id -u)" -eq 0 ] && [ -d "${MISE_DATA_DIR:-}/shims" ]; then
    # Root-hosted tests run the Postgres server as nobody. Runtime mise
    # installs inherit root's umask, so expose only the public shims and the
    # pinned Postgres installation to that test user.
    chmod a+rX "${MISE_DATA_DIR}" "${MISE_DATA_DIR}/shims"
    if [ -d "${MISE_DATA_DIR}/installs" ]; then
      chmod a+rX "${MISE_DATA_DIR}/installs"
    fi
    chmod -R a+rX "${MISE_DATA_DIR}/shims"
    if [ -d "${MISE_DATA_DIR}/installs/ubi-theseus-rs-postgresql-binaries" ]; then
      chmod -R a+rX "${MISE_DATA_DIR}/installs/ubi-theseus-rs-postgresql-binaries"
    fi
  fi
}

case "${MISE_TOOLCHAIN_SCOPE:-full}" in
  runtime)
    # SQLite-only lanes need Bun but must not resolve unrelated tools such as
    # the PostgreSQL binaries, which can exhaust the shared GitHub API quota.
    mise_ci install --yes bun
    mise_ci reshim
    ;;
  postgres)
    # The Playwright image carries browsers and Bun, but its refresh is
    # main-only: a PR that bumps .mise.toml would otherwise run E2E under a
    # stale Bun. Resolve the repo-pinned Bun at runtime (mise shims precede
    # /usr/local/bin on PATH, so the pin wins; a no-op on a fresh image).
    # Postgres binaries and the Temporal CLI ride along because this scope
    # skips the complete CI toolchain (which includes Rust/Cargo tools that
    # cannot build in that image). The Temporal CLI is a prebuilt aqua binary,
    # not a build, so it costs nothing extra here; the nightly Scout design
    # audit boots the real backend via scripts/dev/dev-web.ts, which spawns
    # `temporal server start-dev` unconditionally (dev-web-temporal.ts) and
    # has no way to run without it.
    mise_ci install --yes bun 'ubi:theseus-rs/postgresql-binaries' 'aqua:temporalio/cli'
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
    if ! ldconfig -p | grep -Fq 'libxml2.so.2'; then
      apt-get update -qq && apt-get install -y -qq --no-install-recommends libxml2
    fi
    if ! command -v swiftlint >/dev/null; then
      # Official linux artifact; same recipe as ci/ci-image/Dockerfile
      # (which bakes it in) — keep the two in sync.
      # renovate: datasource=github-releases depName=realm/SwiftLint
      SWIFTLINT_VERSION="0.61.0"
      curl -fsSL "https://github.com/realm/SwiftLint/releases/download/${SWIFTLINT_VERSION}/swiftlint_linux_amd64.zip" -o /tmp/swiftlint.zip
      unzip -q -o /tmp/swiftlint.zip -d /usr/local/swiftlint
      # The dynamic binary needs Swift runtime libs the zip doesn't carry
      # (exec fails as 127); the -static build is self-contained.
      ln -sf /usr/local/swiftlint/swiftlint-static /usr/local/bin/swiftlint
      rm /tmp/swiftlint.zip
    fi
    ;;
  *)
    echo "Unknown MISE_TOOLCHAIN_SCOPE: ${MISE_TOOLCHAIN_SCOPE}" >&2
    false
    ;;
esac
