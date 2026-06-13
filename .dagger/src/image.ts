/**
 * OCI image build and push helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, Platform, Secret } from "@dagger.io/dagger";

import {
  ARGOCD_CLI_VERSION,
  BUN_IMAGE,
  BUN_CACHE,
  BUILDKITE_CLI_VERSION,
  CADDY_BUILDER_IMAGE,
  CADDY_S3_PROXY_MODULE,
  CADDY_IMAGE,
  CLAUDE_CODE_VERSION,
  CODEX_CLI_VERSION,
  EMSCRIPTEN_IMAGE,
  GH_CLI_VERSION,
  GITHUB_MCP_SERVER_VERSION,
  KUBECTL_VERSION,
  OBSIDIAN_HEADLESS_BASE_IMAGE,
  TALOSCTL_VERSION,
  TEMPORAL_CLI_VERSION,
  TOFU_VERSION,
  VELERO_CLI_VERSION,
} from "./constants";
import versions from "./versions";

export const PRISMA_BUN_SERVICE_START_COMMAND =
  "bunx --trust prisma generate && bunx prisma db push && bun run src/index.ts";

function withGitHubCli(container: Container): Container {
  return container
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "curl",
      "git",
    ])
    .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ]);
}

/**
 * Install the GitHub CLI, Claude Code CLI, and Codex CLI into a Bun-based container.
 *
 * The birmel Discord bot's editor sub-agent shells out to both:
 * - `gh` — opens pull requests on the user's behalf after an editor session
 * - `claude` — runs the actual code edits
 *
 * Without these binaries the editor agent logs "feature will not work" on
 * every restart and silently fails any user request that hits its tools.
 *
 * `BUN_INSTALL=/usr/local` forces `bun add -g` to drop the `claude` binary
 * into `/usr/local/bin` (world-readable) instead of `/root/.bun/bin`, which
 * the container's non-root user (UID 1000) cannot reach. Without this the
 * docs-groom workflow fails with `Executable not found in $PATH: claude`.
 */
function withEditorClis(container: Container): Container {
  return withGitHubCli(container)
    .withEnvVariable("BUN_INSTALL", "/usr/local")
    .withExec([
      "bun",
      "add",
      "-g",
      `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`,
    ])
    .withExec(["claude", "--version"])
    .withExec(["bun", "add", "-g", `@openai/codex@${CODEX_CLI_VERSION}`])
    .withExec(["codex", "--version"]);
}

/** Install only the Codex CLI for runtime agent loops such as Pokemon goal mode. */
function withCodexCli(container: Container): Container {
  return container
    .withEnvVariable("BUN_INSTALL", "/usr/local")
    .withExec(["bun", "add", "-g", `@openai/codex@${CODEX_CLI_VERSION}`])
    .withExec(["codex", "--version"]);
}

/**
 * Install runtime binaries required by Birmel's Discord music stack.
 *
 * discord-player-youtubei shells out through youtube-dl-exec. That path needs
 * a real Node binary for the package runtime wrapper and Python for yt-dlp itself.
 * ffmpeg-static and @snazzah/davey are package dependencies, but this helper installs
 * the system interpreters before dependency install so the later image smoke checks can
 * prove the final image is voice-playback-ready. curl is needed to fetch the yt-dlp
 * binary from the release CDN (see installYtDlp) instead of youtube-dl-exec's own
 * rate-limited api.github.com postinstall.
 */
function withBirmelMusicRuntime(container: Container): Container {
  return container
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "curl",
      "nodejs",
      "python3",
    ])
    .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"])
    .withExec(["node", "--version"])
    .withExec(["python3", "--version"]);
}

/**
 * Download the architecture-appropriate yt-dlp standalone binary from the GitHub
 * release CDN and install it (executable) at `destPath`.
 *
 * Why this instead of letting the consumer fetch yt-dlp itself: youtube-dl-exec's
 * postinstall downloads from `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`
 * UNAUTHENTICATED. Shared CI runners share an egress IP, so they exhaust GitHub's
 * 60 req/hr anonymous REST limit and the build dies with "API rate limit exceeded".
 * Release-asset downloads (`releases/latest/download/...`) are served from the asset
 * CDN and are NOT subject to the REST API rate limit, so this path is rate-limit-proof.
 *
 * The asset is verified against the release's published SHA2-256SUMS so a swapped or
 * compromised binary can't be baked in, and curl retries ride out transient 5xx/network
 * blips. yt-dlp ships per-arch static binaries: yt-dlp_linux (x86_64) and
 * yt-dlp_linux_aarch64 (arm64); the standalone binary is self-contained (no Python
 * needed) and works as a drop-in for anything that just spawns the executable.
 *
 * Requires curl + ca-certificates in the container (coreutils `install`/`sha256sum`
 * ship with the Debian base). Runs under dash (`sh`), which lacks `pipefail`, so the
 * checksum line is extracted with a redirect (not a pipe) — under `set -e` a missing or
 * renamed asset then aborts the build instead of silently skipping verification.
 */
function installYtDlp(container: Container, destPath: string): Container {
  return container.withExec([
    "sh",
    "-c",
    [
      "set -e",
      'arch="$(dpkg --print-architecture)"',
      'if [ "$arch" = "amd64" ]; then asset=yt-dlp_linux',
      'elif [ "$arch" = "arm64" ]; then asset=yt-dlp_linux_aarch64',
      'else echo "unsupported architecture: $arch" >&2; exit 1; fi',
      "base=https://github.com/yt-dlp/yt-dlp/releases/latest/download",
      'curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/$asset" -o "/tmp/$asset"',
      'curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$base/SHA2-256SUMS" -o /tmp/SHA2-256SUMS',
      "cd /tmp",
      // `grep > file` (not a pipe): under `set -e` a no-match exits non-zero and aborts,
      // so a missing/renamed asset can't slip past verification the way `grep | sha256sum`
      // would (dash has no pipefail).
      'grep " $asset$" SHA2-256SUMS > "$asset.sha256"',
      'sha256sum -c "$asset.sha256"',
      `install -D -m 0755 "/tmp/$asset" "${destPath}"`,
      // Don't leave the downloaded asset + checksums lying around in the image layer.
      'rm -f "/tmp/$asset" /tmp/SHA2-256SUMS "/tmp/$asset.sha256"',
    ].join("\n"),
  ]);
}

/**
 * Runtime for the streambot video-streaming bot. Installs:
 *  - ffmpeg: prepareStream() spawns the ffmpeg CLI to transcode the source.
 *  - build-essential / cmake / pkg-config / python3: native build deps for
 *    node-datachannel (WebRTC) and node-av (libav bindings), which Bun builds
 *    during `bun install` because they're listed in the package's
 *    trustedDependencies. These must be present BEFORE the install step.
 *  - yt-dlp: the system binary streambot shells out to (config default
 *    /usr/local/bin/yt-dlp). Intentionally tracks the latest release — yt-dlp
 *    must stay current or YouTube extraction breaks; it is a tool, not a lib.
 *  - Intel VAAPI stack (intel-media-va-driver iHD + libva): lets ffmpeg
 *    hardware-encode (h264_vaapi) on the cluster's Intel iGPU. The iHD driver
 *    lives in Debian non-free, so we enable that component first. Software
 *    encoding is the runtime fallback if the device/driver is missing.
 */
function withStreambotRuntime(container: Container): Container {
  const withApt = container
    .withExec([
      "sh",
      "-c",
      // Enable Debian contrib/non-free (where the Intel iHD driver lives). Handles both the
      // deb822 (`debian.sources`) and legacy one-line (`sources.list`) formats.
      [
        "set -e",
        'if [ -f /etc/apt/sources.list.d/debian.sources ]; then sed -i "s/^Components: main.*/Components: main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; fi',
        'if [ -f /etc/apt/sources.list ]; then sed -i "s/ main$/ main contrib non-free non-free-firmware/" /etc/apt/sources.list; fi',
      ].join("\n"),
    ])
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "curl",
      "python3",
      "build-essential",
      "cmake",
      "pkg-config",
      "ffmpeg",
      "libva2",
      "libva-drm2",
      "vainfo",
    ])
    .withExec([
      "sh",
      "-c",
      // The Intel iHD media driver (intel-media-va-driver-non-free) is x86-only; it has no
      // arm64 candidate. The production cluster is amd64, so install it there for VAAPI
      // hardware encoding, and skip it on arm64 (local Mac) builds — which have no Intel GPU
      // anyway and fall back to software encoding.
      [
        "set -e",
        'if [ "$(dpkg --print-architecture)" = "amd64" ]; then',
        "  apt-get install -y -qq --no-install-recommends intel-media-va-driver-non-free",
        "fi",
      ].join("\n"),
    ])
    .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"]);
  // streambot shells out to a system yt-dlp at /usr/local/bin/yt-dlp (config default).
  return installYtDlp(withApt, "/usr/local/bin/yt-dlp")
    .withExec(["ffmpeg", "-version"])
    .withExec(["yt-dlp", "--version"]);
}

/**
 * Runtime deps for the headless discord-plays-* bots (pokemon, mario-kart):
 *  - ffmpeg + libvips: prepareStream()'s fluent-ffmpeg encode path and sharp.
 *  - Intel VAAPI stack (libva + iHD driver): lets ffmpeg hardware-encode
 *    (h264_vaapi) the raw emulator frames on the cluster's Intel iGPU, freeing
 *    CPU for the software emulation. The iHD driver lives in Debian non-free and
 *    is x86-only, so we enable non-free first and install it amd64-only; arm64
 *    (local Mac) builds fall back to software libx264. Mirrors the VAAPI portion
 *    of withStreambotRuntime.
 */
function withDiscordPlaysRuntime(container: Container): Container {
  return container
    .withExec([
      "sh",
      "-c",
      // Enable Debian contrib/non-free (where the Intel iHD driver lives). Handles both the
      // deb822 (`debian.sources`) and legacy one-line (`sources.list`) formats.
      [
        "set -e",
        'if [ -f /etc/apt/sources.list.d/debian.sources ]; then sed -i "s/^Components: main.*/Components: main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; fi',
        'if [ -f /etc/apt/sources.list ]; then sed -i "s/ main$/ main contrib non-free non-free-firmware/" /etc/apt/sources.list; fi',
      ].join("\n"),
    ])
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "ffmpeg",
      "libvips42",
      "libva2",
      "libva-drm2",
      "vainfo",
    ])
    .withExec([
      "sh",
      "-c",
      // The Intel iHD media driver (intel-media-va-driver-non-free) is x86-only; it has no
      // arm64 candidate. The production cluster is amd64, so install it there for VAAPI
      // hardware encoding, and skip it on arm64 (local Mac) builds — which have no Intel GPU
      // anyway and fall back to software encoding.
      [
        "set -e",
        'if [ "$(dpkg --print-architecture)" = "amd64" ]; then',
        "  apt-get install -y -qq --no-install-recommends intel-media-va-driver-non-free",
        "fi",
      ].join("\n"),
    ])
    .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"])
    .withExec(["ffmpeg", "-version"]);
}

/**
 * Hand ownership of Bun's install cache to UID 1000.
 *
 * The oven/bun base image sets `BUN_INSTALL=/usr/local`, which makes Bun
 * resolve its install cache to `/usr/local/install/cache`. The build runs
 * as root, so the cache is root-owned in the final image. Bun's runtime
 * needs write access to that cache during `bun run` startup once the
 * dependency graph crosses some threshold — the failure manifests as the
 * misleading error `bun is unable to write files to tempdir: AccessDenied`
 * (traced via /proc/<pid>/fd to a denied open of /usr/local/install/cache).
 *
 * Call this AFTER the last `bun install` step in the build so newly written
 * cache entries are also reassigned. Inert no-op for any image that doesn't
 * set or inherit BUN_INSTALL=/usr/local.
 */
function withWritableBunInstallCache(container: Container): Container {
  return container.withExec([
    "chown",
    "-R",
    "1000:1000",
    "/usr/local/install/cache",
  ]);
}

/**
 * Install kubectl into a container that already has curl + ca-certificates
 * (e.g. one that has been through `withGitHubCli`).
 *
 * The temporal-worker's bugsink-housekeeping activity shells out to
 * `kubectl exec` to drive `bugsink-manage` Django commands inside the
 * bugsink pod. We use kubectl rather than @kubernetes/client-node's
 * WebSocket-based Exec because the latter rejects with opaque DOM-style
 * ErrorEvent objects under Bun (Node-only `ws` shim incompatibility).
 *
 * Pinned to match the cluster Kubernetes server minor (skew is ±1 minor
 * but matching gives the cleanest behavior). Verified via the upstream
 * SHA256 sum so a registry/CDN compromise can't substitute the binary.
 */
function withKubectl(container: Container): Container {
  const base = `https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${base} -o /usr/local/bin/kubectl`,
        `curl -fsSL ${base}.sha256 -o /tmp/kubectl.sha256`,
        `echo "$(cat /tmp/kubectl.sha256)  /usr/local/bin/kubectl" | sha256sum -c -`,
        `chmod +x /usr/local/bin/kubectl`,
        `rm /tmp/kubectl.sha256`,
      ].join(" && "),
    ])
    .withExec(["kubectl", "version", "--client"]);
}

/**
 * Install the GitHub MCP server binary. Required by the temporal-worker's
 * pr-agent activity, which spawns `claude -p --mcp-config ...` with the MCP
 * server as the GitHub I/O backend.
 *
 * Pinned and SHA-verified the same way as kubectl: download the tarball
 * and the upstream-published checksums file, compare, then extract.
 */
function withGithubMcpServer(container: Container): Container {
  const tag = `v${GITHUB_MCP_SERVER_VERSION}`;
  const baseUrl = `https://github.com/github/github-mcp-server/releases/download/${tag}`;
  const tarballName = "github-mcp-server_Linux_x86_64.tar.gz";
  const checksumsName = `github-mcp-server_${GITHUB_MCP_SERVER_VERSION}_checksums.txt`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${baseUrl}/${tarballName} -o /tmp/gms.tar.gz`,
        `curl -fsSL ${baseUrl}/${checksumsName} -o /tmp/gms.checksums.txt`,
        `expected=$(grep " ${tarballName}$" /tmp/gms.checksums.txt | awk '{print $1}')`,
        `[ -n "$expected" ] || (echo "no checksum entry for ${tarballName}" && exit 1)`,
        `actual=$(sha256sum /tmp/gms.tar.gz | awk '{print $1}')`,
        `[ "$expected" = "$actual" ] || (echo "github-mcp-server checksum mismatch (expected $expected, got $actual)" && exit 1)`,
        `tar -xzf /tmp/gms.tar.gz -C /usr/local/bin github-mcp-server`,
        `chmod +x /usr/local/bin/github-mcp-server`,
        `rm /tmp/gms.tar.gz /tmp/gms.checksums.txt`,
      ].join(" && "),
    ])
    .withExec(["github-mcp-server", "--version"]);
}

/**
 * Install talosctl. Required by the homelab daily audit workflow, which runs
 * `talosctl health`, `talosctl get members`, `talosctl version`, etc. as part
 * of §1 of the audit runbook.
 *
 * Talos publishes per-arch binaries (no tarball, no checksums file at a stable
 * URL) — we verify by re-running `talosctl version --client` and trusting the
 * GitHub release served over HTTPS. If a stricter chain is needed later,
 * sigstore signatures are published alongside the binaries.
 */
function withTalosctl(container: Container): Container {
  const url = `https://github.com/siderolabs/talos/releases/download/${TALOSCTL_VERSION}/talosctl-linux-amd64`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${url} -o /usr/local/bin/talosctl`,
        `chmod +x /usr/local/bin/talosctl`,
      ].join(" && "),
    ])
    .withExec(["talosctl", "version", "--client"]);
}

/**
 * Install OpenTofu. Required by the homelab daily audit workflow, which runs
 * `tofu plan -detailed-exitcode` against the cloudflare module to detect drift
 * (read-only inspection — never `tofu apply`).
 *
 * SHA-verified using the upstream-published checksums file the same way as
 * kubectl and github-mcp-server.
 */
function withTofu(container: Container): Container {
  const baseUrl = `https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}`;
  const tarballName = `tofu_${TOFU_VERSION}_linux_amd64.tar.gz`;
  const checksumsName = `tofu_${TOFU_VERSION}_SHA256SUMS`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${baseUrl}/${tarballName} -o /tmp/tofu.tar.gz`,
        `curl -fsSL ${baseUrl}/${checksumsName} -o /tmp/tofu.checksums.txt`,
        `expected=$(grep " ${tarballName}$" /tmp/tofu.checksums.txt | awk '{print $1}')`,
        `[ -n "$expected" ] || (echo "no checksum entry for ${tarballName}" && exit 1)`,
        `actual=$(sha256sum /tmp/tofu.tar.gz | awk '{print $1}')`,
        `[ "$expected" = "$actual" ] || (echo "tofu checksum mismatch (expected $expected, got $actual)" && exit 1)`,
        `tar -xzf /tmp/tofu.tar.gz -C /usr/local/bin tofu`,
        `chmod +x /usr/local/bin/tofu`,
        `rm /tmp/tofu.tar.gz /tmp/tofu.checksums.txt`,
      ].join(" && "),
    ])
    .withExec(["tofu", "version"]);
}

/**
 * Install the ArgoCD CLI for the homelab daily audit workflow's §13
 * Application Health Matrix step (`argocd app list`).
 *
 * No upstream checksums file at a stable path — verify the binary via
 * `argocd version --client` after install. The release page does carry
 * detached signatures; switching to those would harden this further.
 */
function withArgoCdCli(container: Container): Container {
  const url = `https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_CLI_VERSION}/argocd-linux-amd64`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${url} -o /usr/local/bin/argocd`,
        `chmod +x /usr/local/bin/argocd`,
      ].join(" && "),
    ])
    .withExec(["argocd", "version", "--client"]);
}

/**
 * Install the Velero CLI for the homelab daily audit workflow's §5 Storage &
 * Backups step (`velero backup get`, `velero schedule get`).
 */
function withVeleroCli(container: Container): Container {
  const tarballName = `velero-${VELERO_CLI_VERSION}-linux-amd64.tar.gz`;
  const url = `https://github.com/vmware-tanzu/velero/releases/download/${VELERO_CLI_VERSION}/${tarballName}`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${url} -o /tmp/velero.tar.gz`,
        `tar -xzf /tmp/velero.tar.gz -C /tmp`,
        `mv /tmp/velero-${VELERO_CLI_VERSION}-linux-amd64/velero /usr/local/bin/velero`,
        `chmod +x /usr/local/bin/velero`,
        `rm -rf /tmp/velero.tar.gz /tmp/velero-${VELERO_CLI_VERSION}-linux-amd64`,
      ].join(" && "),
    ])
    .withExec(["velero", "version", "--client-only"]);
}

/**
 * Install the Buildkite CLI for §11 of the homelab daily audit. Buildkite is
 * the source of truth for this monorepo's CI; GitHub status rollups are only a
 * fallback summary.
 */
function withBuildkiteCli(container: Container): Container {
  const tag = `v${BUILDKITE_CLI_VERSION}`;
  const baseUrl = `https://github.com/buildkite/cli/releases/download/${tag}`;
  const tarballName = `bk_${BUILDKITE_CLI_VERSION}_linux_amd64.tar.gz`;
  const checksumsName = `bk_${BUILDKITE_CLI_VERSION}_checksums.txt`;
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${baseUrl}/${tarballName} -o /tmp/bk.tar.gz`,
        `curl -fsSL ${baseUrl}/${checksumsName} -o /tmp/bk.checksums.txt`,
        `expected=$(grep " ${tarballName}$" /tmp/bk.checksums.txt | awk '{print $1}')`,
        `[ -n "$expected" ] || (echo "no checksum entry for ${tarballName}" && exit 1)`,
        `actual=$(sha256sum /tmp/bk.tar.gz | awk '{print $1}')`,
        `[ "$expected" = "$actual" ] || (echo "bk checksum mismatch (expected $expected, got $actual)" && exit 1)`,
        `tar -xzf /tmp/bk.tar.gz -C /usr/local/bin --strip-components=1 bk_${BUILDKITE_CLI_VERSION}_linux_amd64/bk`,
        `chmod +x /usr/local/bin/bk`,
        `rm /tmp/bk.tar.gz /tmp/bk.checksums.txt`,
      ].join(" && "),
    ])
    .withExec(["bk", "--version"]);
}

/**
 * Install the Temporal CLI so the audit can query schedules and frontend
 * health directly through TEMPORAL_ADDRESS without `kubectl exec`.
 */
function withTemporalCli(container: Container): Container {
  const tag = `v${TEMPORAL_CLI_VERSION}`;
  const baseUrl = `https://github.com/temporalio/cli/releases/download/${tag}`;
  const tarballName = `temporal_cli_${TEMPORAL_CLI_VERSION}_linux_amd64.tar.gz`;
  const checksumsName = "checksums.txt";
  return container
    .withExec([
      "sh",
      "-c",
      [
        `curl -fsSL ${baseUrl}/${tarballName} -o /tmp/temporal.tar.gz`,
        `curl -fsSL ${baseUrl}/${checksumsName} -o /tmp/temporal.checksums.txt`,
        `expected=$(grep " ${tarballName}$" /tmp/temporal.checksums.txt | awk '{print $1}')`,
        `[ -n "$expected" ] || (echo "no checksum entry for ${tarballName}" && exit 1)`,
        `actual=$(sha256sum /tmp/temporal.tar.gz | awk '{print $1}')`,
        `[ "$expected" = "$actual" ] || (echo "temporal checksum mismatch (expected $expected, got $actual)" && exit 1)`,
        `tar -xzf /tmp/temporal.tar.gz -C /usr/local/bin temporal`,
        `chmod +x /usr/local/bin/temporal`,
        `rm /tmp/temporal.tar.gz /tmp/temporal.checksums.txt`,
      ].join(" && "),
    ])
    .withExec(["temporal", "--version"]);
}

/**
 * Bundle the homelab-audit CLIs into a
 * container. Used only by the temporal-worker image — pr-agent and the other
 * Bun services don't need them.
 */
function withHomelabAuditClis(container: Container): Container {
  return withTemporalCli(
    withBuildkiteCli(
      withVeleroCli(withArgoCdCli(withTofu(withTalosctl(container)))),
    ),
  );
}

/**
 * Compile the in-tree `packages/toolkit` CLI into a single static binary at
 * `/usr/local/bin/toolkit`.
 *
 * The audit runbook (`packages/docs/guides/2026-04-04_homelab-audit-runbook.md`)
 * invokes `toolkit pd incidents`, `toolkit bugsink issues`, and
 * `toolkit gf query|logs|alerts` — the homelab-audit-daily workflow needs
 * these in the worker image.
 *
 * Built in a side stage from the `toolkitDir` directory (mounted via the
 * WORKSPACE_DEPS map for `temporal` — see `.dagger/src/deps.ts`). The result
 * is a single self-contained binary; no `bun` runtime dependency at run-time.
 *
 * `eslintConfigDir` must also be present at /workspace/packages/eslint-config
 * because toolkit's package.json depends on `file:../eslint-config`. Temporal
 * already pulls it in as one of its own deps, so this is satisfied.
 */
function withToolkit(container: Container): Container {
  return container
    .withWorkdir("/workspace/packages/toolkit")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec([
      "bun",
      "build",
      "./src/index.ts",
      "--compile",
      // prism-media (pulled in by discord.js-selfbot-v13) requires ffmpeg-static at
      // import time, but ffmpeg-static is a native binary shim that must not be
      // bundled into the compiled output — mark it external so bun skips bundling it.
      "--external",
      "ffmpeg-static",
      "--outfile=/usr/local/bin/toolkit",
    ])
    .withExec(["chmod", "+x", "/usr/local/bin/toolkit"])
    .withExec(["toolkit", "--version"]);
}

/**
 * Give the vendored `discord-video-stream` fork its own `node_modules` at its mounted source
 * location. The fork is consumed as TypeScript source (bun runs `src/`), so when a consumer imports
 * it, the fork's files resolve their native runtime deps (`@lng2004/node-datachannel`, `node-av`, …)
 * from the fork's OWN directory — a sibling of the consumer, whose `node_modules` is unreachable.
 * Without this, the image builds fine but crashes at startup with `Cannot find module
 * '@lng2004/node-datachannel'`. Mirrors the per-dep install loop in `bunBaseContainer` (base.ts).
 */
function withForkRuntimeDeps(
  container: Container,
  depNames: string[],
): Container {
  if (!depNames.includes("discord-video-stream")) return container;
  return container
    .withWorkdir("/workspace/packages/discord-video-stream")
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Build a Bun service OCI image. Constructs a minimal workspace with
 * only the target package and its workspace deps — no file modification.
 *
 * `installEditorClis` opts a package into having `gh` and `claude` in PATH;
 * required for birmel and any future package whose agent shells out to them.
 */
export function buildImageHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
  usePrisma: boolean = false,
  installEditorClis: boolean = false,
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  // Build a minimal workspace: target + needed packages
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  if (installEditorClis) {
    container = withEditorClis(container);
  }

  if (pkg === "birmel") {
    container = withBirmelMusicRuntime(container);
  }

  if (pkg === "streambot") {
    container = withStreambotRuntime(container);
  }

  container = container
    .withWorkdir("/workspace")
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  container = withForkRuntimeDeps(container, depNames);

  // Install deps then set up the final image
  let image = container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "install", "--frozen-lockfile"]);

  if (pkg === "birmel") {
    // youtube-dl-exec resolves its binary at <pkg>/bin/yt-dlp (constants.YOUTUBE_DL_PATH),
    // but its own postinstall fetches that binary from api.github.com UNAUTHENTICATED and
    // flakes on shared CI runners (anonymous 60 req/hr REST limit). Provide it via the
    // rate-limit-proof, SHA-verified release-CDN download instead, then prove the final
    // image is voice-playback-ready.
    image = installYtDlp(
      image,
      "/workspace/packages/birmel/node_modules/youtube-dl-exec/bin/yt-dlp",
    ).withExec(["test", "-x", "node_modules/youtube-dl-exec/bin/yt-dlp"]);
  }

  return image
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(
      usePrisma
        ? ["/bin/sh", "-c", PRISMA_BUN_SERVICE_START_COMMAND]
        : ["bun", "run", "src/index.ts"],
    );
}

/**
 * Build the caddy-s3proxy image.
 * Multi-stage Go build: xcaddy builds a custom Caddy binary with the S3 proxy plugin,
 * then copies it into the runtime Caddy Alpine image.
 *
 * Uses shepherdjerred/caddy-s3-proxy as a drop-in replacement for the upstream
 * lindenlab module — keeps the import path so existing Caddyfiles work, but
 * adds native HEAD support, fixes the 304-on-index regression, and returns
 * 206 + Accept-Ranges on byte-range requests. See CADDY_S3_PROXY_MODULE.
 */
export function buildCaddyS3ProxyImageHelper(
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  // Stage 1: Build custom Caddy binary with S3 proxy plugin
  const caddyBinary = dag
    .container()
    .from(CADDY_BUILDER_IMAGE)
    .withExec(["xcaddy", "build", "--with", CADDY_S3_PROXY_MODULE])
    .file("/usr/bin/caddy");

  // Stage 2: Runtime image with the custom binary
  return dag
    .container()
    .from(CADDY_IMAGE)
    .withFile("/usr/bin/caddy", caddyBinary)
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha);
}

// ---------------------------------------------------------------------------
// Push helpers
// ---------------------------------------------------------------------------

/** Push any pre-built container to a registry under one or more tags. Returns the digest. */
export async function pushContainerHelper(
  container: Container,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
): Promise<string> {
  if (tags.length === 0) {
    throw new Error("pushContainerHelper requires at least one tag");
  }
  const image = container.withRegistryAuth(
    "ghcr.io",
    registryUsername,
    registryPassword,
  );

  const digest = await image.publish(tags[0]);
  for (const tag of tags.slice(1)) {
    await image.publish(tag);
  }
  return digest;
}

/** Push a caddy-s3proxy image to a registry. */
export async function pushCaddyS3ProxyImageHelper(
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildCaddyS3ProxyImageHelper(version, gitSha);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/**
 * Build the obsidian-headless image.
 * Node-based, installs obsidian-headless CLI globally for Obsidian vault sync.
 * Uses Node instead of Bun because obsidian-headless depends on better-sqlite3,
 * a native Node addon that Bun does not support.
 * Pinned to a specific obsidian-headless npm version so the Dagger cache key
 * changes when we bump the dependency; previous un-pinned code left a stale
 * Bun-based image cached on CI for weeks.
 */
export function buildObsidianHeadlessImageHelper(
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  return dag
    .container()
    .from(OBSIDIAN_HEADLESS_BASE_IMAGE)
    .withExec([
      "sh",
      "-c",
      "apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*",
    ])
    .withExec([
      "npm",
      "install",
      "-g",
      `obsidian-headless@${versions["obsidian-headless"]}`,
    ])
    .withExec(["node", "--version"])
    .withExec(["which", "ob"])
    .withExec(["mkdir", "-p", "/vault"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(["/bin/sh", "-c"]);
}

/** Push an obsidian-headless image to a registry. */
export async function pushObsidianHeadlessImageHelper(
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildObsidianHeadlessImageHelper(version, gitSha);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

// ---------------------------------------------------------------------------
// Temporal worker image builder
// ---------------------------------------------------------------------------

/**
 * Build the Temporal worker image.
 * Standalone Bun package — simple workspace mount + install + run.
 */
export function buildTemporalWorkerImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  // The docs-groom workflow shells out to `gh` + `claude` from inside the
  // worker pod, so the temporal-worker image must ship both binaries.
  // The bugsink-housekeeping workflow shells out to `kubectl` for the same
  // reason — see the rationale on `withKubectl`.
  // The pr-agent activity (PR review + summary) launches `claude -p` with
  // the GitHub MCP server as the only allowed tool source — see
  // `withGithubMcpServer`.
  // The homelab-audit-daily workflow runs `claude -p` against the audit
  // runbook, which invokes talosctl / tofu / argocd / velero — see
  // `withHomelabAuditClis`.
  container = withHomelabAuditClis(
    withGithubMcpServer(withKubectl(withEditorClis(container))),
  );

  container = container
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/temporal", pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  container = container
    .withWorkdir("/workspace/packages/temporal")
    .withExec(["bun", "install", "--frozen-lockfile"]);

  // Compile the in-tree toolkit CLI into a static binary if its source is
  // mounted. The temporal-worker WORKSPACE_DEPS list opts into this by
  // including `toolkit`; other consumers of buildTemporalWorkerImageHelper
  // (none today) won't pay the build cost.
  if (depNames.includes("toolkit")) {
    container = withToolkit(container);
  }

  // Reassign ownership of the bun install cache AFTER every bun-install step
  // (including toolkit's). New entries written by the toolkit install must
  // also be readable by UID 1000 at runtime — see the docstring on
  // `withWritableBunInstallCache`.
  container = withWritableBunInstallCache(container);

  return container
    .withWorkdir("/workspace/packages/temporal")
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(["bun", "run", "src/worker.ts"]);
}

/** Push a temporal-worker image to a registry. */
export async function pushTemporalWorkerImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildTemporalWorkerImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

// ---------------------------------------------------------------------------
// Workspace-monorepo image builders (scout, discord-plays-pokemon)
// ---------------------------------------------------------------------------

/**
 * Build the scout-for-lol backend image.
 * Scout is a Bun workspace monorepo — mount the full package, install deps at root,
 * run prisma generate, then set workdir to the backend sub-package.
 */
export function buildScoutImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/scout-for-lol", pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  return container
    .withWorkdir("/workspace/packages/scout-for-lol")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/scout-for-lol/packages/backend")
    .withExec(["bunx", "--trust", "prisma", "generate"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint([
      "/bin/sh",
      "-c",
      "bunx prisma migrate deploy && bun run src/index.ts",
    ]);
}

/**
 * Build the discord-plays-pokemon backend image.
 * Similar workspace structure — mount the full package, install deps at root,
 * then install deps in the backend sub-package.
 */
export function buildDiscordPlaysPokemonImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];
  const innerRoot = "/workspace/packages/discord-plays-pokemon";

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  // ffmpeg + libvips for discord-video-stream (fluent-ffmpeg encode path + sharp)
  // plus the Intel VAAPI stack so ffmpeg can hardware-encode on the iGPU. No
  // browser/desktop — this is a headless Bun service.
  container = withCodexCli(withDiscordPlaysRuntime(container))
    .withWorkdir("/workspace")
    .withDirectory(innerRoot, pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  container = withForkRuntimeDeps(container, depNames);

  return (
    container
      // Workspace install (covers backend + frontend) — runs the
      // trustedDependencies postinstalls (node-datachannel, node-av). The
      // discord-video-stream fork lazy-loads sharp in source (no bun patch). The
      // committed packages/backend/assets/pokeemerald.wasm is copied in (not excluded).
      .withWorkdir(innerRoot)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withWorkdir(`${innerRoot}/packages/backend`)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec([
        "install",
        "-D",
        "-m",
        "0755",
        `${innerRoot}/packages/backend/src/goal/pokemonctl.ts`,
        "/usr/local/bin/pokemonctl",
      ])
      .withExec(["pokemonctl", "--help"])
      // Build the web UI served by the backend web server (web.assets).
      .withWorkdir(`${innerRoot}/packages/frontend`)
      .withExec(["bun", "run", "build"])
      .withLabel(
        "org.opencontainers.image.source",
        "https://github.com/shepherdjerred/monorepo",
      )
      .withLabel("org.opencontainers.image.version", version)
      .withLabel("org.opencontainers.image.revision", gitSha)
      .withEnvVariable("VERSION", version)
      .withEnvVariable("GIT_SHA", gitSha)
      // Run from the inner-monorepo root so getConfig()/emulator resolve
      // config.toml, packages/backend/assets/pokeemerald.wasm, and saves/
      // relative to CWD.
      .withWorkdir(innerRoot)
      .withEntrypoint(["bun", "packages/backend/src/index.ts"])
  );
}

// ---------------------------------------------------------------------------
// Push helpers for workspace-monorepo images
// ---------------------------------------------------------------------------

/** Push a scout-for-lol image to a registry. */
export async function pushScoutImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildScoutImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/** Push a discord-plays-pokemon image to a registry. */
export async function pushDiscordPlaysPokemonImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildDiscordPlaysPokemonImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/**
 * Build the discord-plays-mario-kart backend image.
 *
 * Two stages:
 *  1. An emscripten stage compiles the vendored N64Wasm core (parallel-n64 +
 *     angrylion software RDP) from `wasm-src/` into `n64wasm.js` + `n64wasm.wasm`.
 *     The committed `wasm-src/code` tree is byte-pristine upstream; our changes
 *     (neilSetRom, neilGetVideoBuffer/Height, the per-player input export, and the
 *     Makefile exports) live in `wasm-src/patches/` and are applied here at build
 *     time. No binaries are committed — the build is reproducible from source.
 *     `make clean` guarantees the sources are recompiled rather than reusing any
 *     stale local object files.
 *  2. A Bun stage mirrors discord-plays-pokemon (ffmpeg + libvips for
 *     @dank074/discord-video-stream, workspace install, frontend build) and
 *     copies the compiled core + MEMFS-staged assets into the backend's
 *     assets dir. Headless: no GPU, browser, or desktop.
 */
export function buildDiscordPlaysMarioKartImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];
  const innerRoot = "/workspace/packages/discord-plays-mario-kart";
  const assetsDir = `${innerRoot}/packages/backend/assets/n64wasm`;

  // Stage 1: compile the N64Wasm core in the pinned emscripten toolchain.
  const wasmSrc = pkgDir.directory("wasm-src");
  const wasmBuild = dag
    .container()
    .from(EMSCRIPTEN_IMAGE)
    .withDirectory("/src", wasmSrc, { exclude: ["dist"] })
    // The committed wasm-src/code tree is BYTE-PRISTINE upstream; our changes live
    // in wasm-src/patches and are applied here at build time (never committed into
    // the tree). Uses patch(1) (present in the emscripten image; /src is not a git
    // work tree). See wasm-src/PATCHES.md.
    .withWorkdir("/src")
    .withExec([
      "sh",
      "-c",
      'set -e; for p in patches/*.patch; do echo "applying $p"; patch -p1 --no-backup-if-mismatch < "$p"; done',
    ])
    .withWorkdir("/src/code")
    // `make clean` drops any object files so the patched sources are rebuilt
    // from scratch; `make` emits n64wasm.js + n64wasm.wasm in this dir.
    .withExec(["make", "clean"])
    .withExec(["make"]);

  // Stage 2: the headless Bun service (mirrors discord-plays-pokemon).
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  // ffmpeg + libvips for discord-video-stream (fluent-ffmpeg encode path + sharp)
  // plus the Intel VAAPI stack so ffmpeg can hardware-encode on the iGPU. The
  // software-rendered N64 frames are read straight out of wasm memory.
  container = withDiscordPlaysRuntime(container)
    .withWorkdir("/workspace")
    // wasm-src is the build input for stage 1 only — keep the large vendored
    // C/C++ tree out of the runtime image.
    .withDirectory(innerRoot, pkgDir, {
      exclude: [...excludes, "wasm-src"],
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  container = withForkRuntimeDeps(container, depNames);

  return (
    container
      // Copy the compiled core + the files the host stages into MEMFS at
      // runtime (loadFile reads these; see the emulator host).
      .withFile(
        `${assetsDir}/n64wasm.js`,
        wasmBuild.file("/src/code/n64wasm.js"),
      )
      .withFile(
        `${assetsDir}/n64wasm.wasm`,
        wasmBuild.file("/src/code/n64wasm.wasm"),
      )
      .withFile(
        `${assetsDir}/shader_vert.hlsl`,
        wasmBuild.file("/src/code/shader_vert.hlsl"),
      )
      .withFile(
        `${assetsDir}/shader_frag.hlsl`,
        wasmBuild.file("/src/code/shader_frag.hlsl"),
      )
      .withFile(
        `${assetsDir}/overlay.png`,
        wasmBuild.file("/src/code/overlay.png"),
      )
      .withFile(
        `${assetsDir}/res/arial.ttf`,
        wasmBuild.file("/src/code/res/arial.ttf"),
      )
      // Workspace install (backend + frontend) — runs trustedDependencies
      // postinstalls. The discord-video-stream fork lazy-loads sharp in source
      // (no bun patch).
      .withWorkdir(innerRoot)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withWorkdir(`${innerRoot}/packages/backend`)
      .withExec(["bun", "install", "--frozen-lockfile"])
      // Build the web UI served by the backend web server (web.assets).
      .withWorkdir(`${innerRoot}/packages/frontend`)
      .withExec(["bun", "run", "build"])
      .withLabel(
        "org.opencontainers.image.source",
        "https://github.com/shepherdjerred/monorepo",
      )
      .withLabel("org.opencontainers.image.version", version)
      .withLabel("org.opencontainers.image.revision", gitSha)
      .withEnvVariable("VERSION", version)
      .withEnvVariable("GIT_SHA", gitSha)
      // Run from the inner-monorepo root so getConfig()/emulator resolve
      // config.toml, the n64wasm assets, and saves/ relative to CWD.
      .withWorkdir(innerRoot)
      .withEntrypoint(["bun", "packages/backend/src/index.ts"])
  );
}

/** Push a discord-plays-mario-kart image to a registry. Returns the digest. */
export async function pushDiscordPlaysMarioKartImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildDiscordPlaysMarioKartImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/**
 * Build a trmnl-dashboard image — plain Bun service, no Prisma, no codegen.
 * Runs as numeric UID 1000:1000 so the cdk8s-plus default `runAsNonRoot: true`
 * passes without any chart-side `ensureNonRoot: false` workaround.
 */
export function buildTrmnlDashboardImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/trmnl-dashboard", pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  return container
    .withWorkdir("/workspace/packages/trmnl-dashboard")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withUser("1000:1000")
    .withEntrypoint(["bun", "run", "src/index.ts"]);
}

/** Push a trmnl-dashboard image to a registry. */
export async function pushTrmnlDashboardImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildTrmnlDashboardImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

// ---------------------------------------------------------------------------
// CI base image (Dockerfile-based build)
// ---------------------------------------------------------------------------

/** Build the CI base image from .buildkite/ci-image/Dockerfile. */
export function buildCiBaseImageHelper(context: Directory): Container {
  // Explicitly target linux/amd64 — the cluster node (torvalds) is amd64.
  // Without this, dockerBuild() can produce a wrong-arch image (observed:
  // ci-base:405 came out arm64, causing `exec format error` on /bin/sh in
  // every CI Job pod). Platform is a branded string in the Dagger SDK with
  // no public constructor, so a typed cast is the pragmatic way to pin it.
  const platform: Platform = "linux/amd64" as unknown as Platform;
  return context.dockerBuild({ platform });
}

/** Build and push the CI base image. Returns the digest. */
export async function pushCiBaseImageHelper(
  context: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
): Promise<string> {
  const container = buildCiBaseImageHelper(context);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/** Push a built image to a registry under one or more tags. Returns the digest of the first tag published. */
export async function pushImageHelper(
  pkgDir: Directory,
  pkg: string,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
  usePrisma: boolean = false,
  installEditorClis: boolean = false,
): Promise<string> {
  if (tags.length === 0) {
    throw new Error("pushImageHelper requires at least one tag");
  }
  const image = buildImageHelper(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    version,
    gitSha,
    usePrisma,
    installEditorClis,
  ).withRegistryAuth("ghcr.io", registryUsername, registryPassword);

  const digest = await image.publish(tags[0]);
  for (const tag of tags.slice(1)) {
    await image.publish(tag);
  }
  return digest;
}
