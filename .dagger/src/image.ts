/**
 * OCI image build and push helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import type {
  Container,
  Directory,
  File,
  Platform,
  Secret,
} from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { z } from "zod";

import {
  ARGOCD_CLI_VERSION,
  BUN_IMAGE,
  BUN_CACHE,
  BUILDKITE_CLI_VERSION,
  CADDY_BUILDER_IMAGE,
  CADDY_S3_PROXY_MODULE,
  CADDY_IMAGE,
  CLAUDE_CODE_VERSION,
  MCP_PROXY_BASE_IMAGE,
  EDSTEM_MCP_COMMIT,
  CODEX_CLI_VERSION,
  COGAPP_VERSION,
  EMSCRIPTEN_IMAGE,
  GH_CLI_VERSION,
  GITHUB_MCP_SERVER_VERSION,
  KUBECTL_VERSION,
  OBSIDIAN_HEADLESS_BASE_IMAGE,
  POKEEMERALD_SOURCE_REF,
  POKEEMERALD_WASM_TOOLCHAIN_IMAGE,
  REDLIB_SOURCE_REF,
  TALOSCTL_VERSION,
  TEMPORAL_CLI_VERSION,
  TOFU_VERSION,
  VELERO_CLI_VERSION,
} from "./constants";
import { BUN_INSTALL_WITH_RETRY, withCleanReinstallIfNeeded } from "./base";
import versions from "./versions";

/**
 * `Platform` is a branded string (`string & {__Platform: never}`) with no
 * public SDK constructor, and `dag.defaultPlatform()` only yields the host's
 * platform. To pin an explicit target we validate a known-good literal through
 * a Zod `custom` schema, which narrows to the branded type without a type
 * assertion or type-guard predicate. The cluster node (torvalds) is amd64;
 * without pinning, `dockerBuild()` can emit a wrong-arch image (observed:
 * ci-base came out arm64, causing `exec format error` on /bin/sh in CI pods).
 */
const PlatformSchema = z.custom<Platform>(
  (value) => typeof value === "string" && value.length > 0,
  "Platform must be a non-empty string",
);

function amd64Platform(): Platform {
  return PlatformSchema.parse("linux/amd64");
}

export const PRISMA_BUN_SERVICE_START_COMMAND =
  "bunx --trust prisma generate && bunx prisma db push && bun run src/index.ts";

// Inner-monorepo root the discord-plays-mario-kart app runs from (config.toml,
// n64wasm assets, saves/ resolve relative to this CWD).
export const MARIO_KART_INNER_ROOT =
  "/workspace/packages/discord-plays-mario-kart";

// The real container entrypoint command for discord-plays-mario-kart. Applies the
// leaderboard schema to the (persistent-volume) SQLite DB before start, then execs
// the app from the inner root. NOTE: Prisma 7's `db push` no longer accepts
// `--skip-generate` (generate is decoupled) — passing it crashes the container on
// boot. Shared with the smoke test so the two cannot drift.
export const MARIO_KART_ENTRYPOINT_COMMAND = `cd packages/backend && bunx prisma db push && cd ${MARIO_KART_INNER_ROOT} && exec bun packages/backend/src/index.ts`;

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
 * temporal-worker workflows that shell out to `claude` fail with
 * `Executable not found in $PATH: claude`.
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
 * Install the `cog` (cogapp) CLI into a Bun-based container.
 *
 * The temporal-worker's `readme-refresh-weekly` workflow shells out to
 * `cog -r README.md practice/README.md archive/README.md` to regenerate the
 * project-listing tables embedded in those READMEs. cog is a Python tool, so we
 * add a Python interpreter and install cogapp system-wide. `pip3 install` with
 * `--break-system-packages` drops the `cog` entrypoint into `/usr/local/bin`
 * (world-readable), reachable by the container's non-root user (UID 1000) — the
 * same reason `withEditorClis` forces `BUN_INSTALL=/usr/local` for `claude`.
 */
function withCogapp(container: Container): Container {
  return (
    container
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "ca-certificates",
        "python3",
        "python3-pip",
      ])
      .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"])
      .withExec([
        "pip3",
        "install",
        "--no-cache-dir",
        "--break-system-packages",
        `cogapp==${COGAPP_VERSION}`,
      ])
      // cogapp's `cog` CLI uses `-v` for "print the version and exit"; it has no
      // `--version` flag (that errors with exit 2 "option --version not
      // recognized"). `cog -v` prints e.g. "Cog version 3.6.0" and exits 0,
      // confirming the binary is installed and runnable on PATH.
      .withExec(["cog", "-v"])
  );
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
      // fontconfig: sharp/libvips text rendering (the leaderboard name overlay)
      // needs it initialised even though the glyphs come from a bundled TTF
      // passed via `fontfile` — without it sharp logs a fontconfig error.
      "fontconfig",
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
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY])
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
 * Give source-consumed `file:` deps their own `node_modules` at their mounted source
 * location. These packages are consumed as TypeScript source (bun runs `src/`), and bun's
 * runtime resolves a `file:` dependency's imports from the dep's OWN directory — a sibling
 * of the consumer, whose `node_modules` is unreachable from there. Without a per-dep
 * install the image builds fine but crashes at startup:
 *   - discord-video-stream: `Cannot find module '@lng2004/node-datachannel'` (native deps)
 *   - discord-stream-lifecycle: `ENOENT while resolving package 'discord.js'` (its
 *     peerDependencies — bun installs peers on a root install, so this provides them)
 *   - discord-plays-core: `Cannot find module '@shepherdjerred/discord-stream-lifecycle/…'`
 *     unless dsl's `dist/` already exists when THIS install runs (see the ordering note on
 *     `withBuiltDiscordStreamLifecycle` below — it must run before this function).
 * Mirrors the per-dep install loop in `bunBaseContainer` (base.ts).
 */
const SOURCE_RUNTIME_DEPS = [
  "discord-video-stream",
  "discord-stream-lifecycle",
  "discord-plays-core",
];

function withForkRuntimeDeps(
  container: Container,
  depNames: string[],
): Container {
  for (const dep of SOURCE_RUNTIME_DEPS) {
    if (!depNames.includes(dep)) continue;
    container = container
      .withWorkdir(`/workspace/packages/${dep}`)
      .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY]);
  }
  return container;
}

/**
 * Build `@shepherdjerred/discord-stream-lifecycle` when it's a mounted dep, so its `dist/`
 * exists before a consumer's frozen install copies it through the `file:` ref (see
 * `withBuiltLlmModels` below — same mechanism, same reason).
 *
 * This one is load-bearing, not just a `Cannot find module '@shepherdjerred/…'` nicety:
 * discord-stream-lifecycle is consumed from deep inside a nested bun workspace
 * (discord-plays-pokemon/mario-kart's `packages/backend`, itself two levels below the
 * outer package). When consumed as raw TypeScript source, bun's on-the-fly transpile
 * resolution for a wholesale-copied `file:` dep does NOT fall back to the consumer's
 * ancestor `node_modules` — so `game-bot.ts`'s `discord.js` import fails at startup with
 * `Cannot find module 'discord.js'` even though discord.js is correctly hoisted one level
 * up. Compiling to `dist/*.js` and consuming it as compiled JS resolves the same way
 * llm-models' `zod` dependency already does from the identical nesting depth (proven
 * working) — plain Node-style ancestor `node_modules` resolution, no special-casing needed.
 *
 * MUST run before `withForkRuntimeDeps`: bun's hoisted-linker install snapshots a `file:`
 * dep's top-level entries as individual symlinks at install time. `discord-plays-core` (a
 * `SOURCE_RUNTIME_DEPS` member) has its own `file:` dep on discord-stream-lifecycle — if
 * `withForkRuntimeDeps` installs discord-plays-core's node_modules BEFORE this function
 * builds dsl's `dist/`, the symlink snapshot is taken pre-build and has no `dist` entry.
 * Building dsl afterward populates the real directory but never refreshes that already-taken
 * snapshot, so discord-plays-core's copy is permanently missing `dist/` even though dsl's own
 * directory has it — `Cannot find module '@shepherdjerred/discord-stream-lifecycle/…'` at
 * runtime despite tsc resolving cleanly (tsc reads the real directory, bun's runtime reads
 * the stale symlink snapshot). Reproduced locally: installing discord-plays-core's deps
 * before vs. after building dsl's dist is the only difference between working and broken.
 */
function withBuiltDiscordStreamLifecycle(
  container: Container,
  depNames: string[],
): Container {
  if (!depNames.includes("discord-stream-lifecycle")) return container;
  return container
    .withWorkdir("/workspace/packages/discord-stream-lifecycle")
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY])
    .withExec(["bun", "run", "build"]);
}

/**
 * Build `@shepherdjerred/llm-models` when it's a mounted dep, so its `dist/`
 * exists before a consumer's frozen install copies it through the `file:` ref.
 * The catalog's package.json `main`/`exports` resolve to gitignored `dist/`, so
 * consumers (scout, discord-plays-pokemon, temporal-worker) that import it crash
 * at startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
 * catalog is compiled first. Image/smoke builders install the consumer directly,
 * skipping the per-dep build loop in `bunBaseContainer` (base.ts) — this restores
 * that step just for the catalog. Uses the install-retry wrapper because the
 * eslint-config `file:` link races under bun's worker pool (#4336).
 */
function withBuiltLlmModels(
  container: Container,
  depNames: string[],
): Container {
  if (!depNames.includes("llm-models")) return container;
  return container
    .withWorkdir("/workspace/packages/llm-models")
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY])
    .withExec(["bun", "run", "build"]);
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
  version = "dev",
  gitSha = "unknown",
  usePrisma = false,
  installEditorClis = false,
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

  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  // Order matters: build dsl's dist BEFORE installing discord-plays-core's own
  // node_modules (see withBuiltDiscordStreamLifecycle's doc comment).
  container = withBuiltDiscordStreamLifecycle(container, depNames);
  container = withForkRuntimeDeps(container, depNames);

  // Install deps then set up the final image
  // Clean-reinstall (not plain retry) when discord-stream-lifecycle is present:
  // see `withCleanReinstallIfNeeded`'s doc comment in base.ts.
  let image = withCleanReinstallIfNeeded(
    container.withWorkdir(`/workspace/packages/${pkg}`),
    depNames,
  );

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
  version = "dev",
  gitSha = "unknown",
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
  version = "dev",
  gitSha = "unknown",
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
  version = "dev",
  gitSha = "unknown",
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
  version = "dev",
  gitSha = "unknown",
): Promise<string> {
  const container = buildObsidianHeadlessImageHelper(version, gitSha);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/**
 * Build the custom mcp-gateway image.
 * Multi-stage: a Node builder clones + builds edstem-mcp (rob-9/edstem-mcp) at a
 * pinned commit (it is git-only, has no committed dist, and no build-on-install,
 * so npx-from-git fails), then the prebuilt server is copied into the
 * tbxark/mcp-proxy runtime image. The gateway config runs it via
 * `node /opt/edstem-mcp/dist/index.js`. The base already ships node + python/uv,
 * so the other servers keep running via npx/uvx at runtime.
 */
export function buildMcpGatewayImageHelper(
  version = "dev",
  gitSha = "unknown",
): Container {
  // Stage 1 — clone + build edstem-mcp into /opt/edstem-mcp.
  const edstemDist = dag
    .container()
    .from(OBSIDIAN_HEADLESS_BASE_IMAGE)
    .withExec([
      "sh",
      "-c",
      "apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*",
    ])
    .withExec([
      "sh",
      "-c",
      [
        "set -e",
        "git clone https://github.com/rob-9/edstem-mcp /opt/edstem-mcp",
        "cd /opt/edstem-mcp",
        `git checkout ${EDSTEM_MCP_COMMIT}`,
        "npm ci",
        "npm run build",
        "npm prune --omit=dev",
      ].join(" && "),
    ])
    .directory("/opt/edstem-mcp");

  // Stage 2 — bake the prebuilt server into the mcp-proxy runtime image.
  return dag
    .container()
    .from(MCP_PROXY_BASE_IMAGE)
    .withDirectory("/opt/edstem-mcp", edstemDist)
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha);
}

/** Push a custom mcp-gateway image to a registry. */
export async function pushMcpGatewayImageHelper(
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  version = "dev",
  gitSha = "unknown",
): Promise<string> {
  const container = buildMcpGatewayImageHelper(version, gitSha);
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
  version = "dev",
  gitSha = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  // The pr-agent activity (PR review + summary) and several PR-opening
  // workflows shell out to `gh` + `claude` from inside the worker pod, so the
  // temporal-worker image must ship both binaries — see `withEditorClis`.
  // The bugsink-housekeeping workflow shells out to `kubectl` for the same
  // reason — see the rationale on `withKubectl`.
  // The pr-agent activity (PR review + summary) launches `claude -p` with
  // the GitHub MCP server as the only allowed tool source — see
  // `withGithubMcpServer`.
  // The homelab-audit-daily workflow runs `claude -p` against the audit
  // runbook, which invokes talosctl / tofu / argocd / velero — see
  // `withHomelabAuditClis`.
  // The readme-refresh-weekly workflow shells out to `cog` (cogapp) to
  // regenerate the README project listings — see `withCogapp`.
  container = withCogapp(
    withHomelabAuditClis(
      withGithubMcpServer(withKubectl(withEditorClis(container))),
    ),
  );

  container = container
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/temporal", pkgDir, {
      exclude: excludes,
    });

  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  container = withBuiltLlmModels(container, depNames);

  container = container
    .withWorkdir("/workspace/packages/temporal")
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY]);

  // Compile the in-tree toolkit CLI into a static binary if its source is
  // mounted. The temporal-worker WORKSPACE_DEPS list opts into this by
  // including `toolkit`; other consumers of buildTemporalWorkerImageHelper
  // (none today) won't pay the build cost.
  if (depNames.includes("toolkit")) {
    container = withToolkit(container);
  }

  return (
    container
      // Point Bun's runtime install cache at a UID-1000-writable path. The
      // oven/bun base sets BUN_INSTALL=/usr/local, so the build-time cache at
      // /usr/local/install/cache is root-owned; bun's runtime needs a writable
      // cache during `bun run` startup once the dependency graph crosses some
      // threshold — the failure manifests as the misleading
      // `bun is unable to write files to tempdir: AccessDenied` (traced via
      // /proc/<pid>/fd to a denied open of /usr/local/install/cache).
      // The previous fix — `chown -R 1000:1000` over the in-layer cache — was
      // O(every file): an overlayfs copy-up of ~100k files that ran ~30 min
      // on cold builds (2026-07-04, builds 5033/5035/5037) and pushed the job
      // past its step timeout. Redirecting the cache is O(1); bun creates the
      // directory on demand under the writable prefix.
      .withEnvVariable("BUN_INSTALL_CACHE_DIR", "/tmp/bun-install-cache")
      .withWorkdir("/workspace/packages/temporal")
      .withLabel(
        "org.opencontainers.image.source",
        "https://github.com/shepherdjerred/monorepo",
      )
      .withLabel("org.opencontainers.image.version", version)
      .withLabel("org.opencontainers.image.revision", gitSha)
      .withEnvVariable("VERSION", version)
      .withEnvVariable("GIT_SHA", gitSha)
      .withEntrypoint(["bun", "run", "src/worker.ts"])
  );
}

/**
 * Rehearse the scheduled PR-creating workflows against a repo tree, inside
 * the temporal-worker image — "will the weekly Temporal jobs still run after
 * this change merges?". Builds the worker image (the engine de-dups this
 * against the standalone build step, like the other smoke tests), copies the
 * repo tree to a writable path, and runs
 * `packages/temporal/scripts/rehearse-bot-clone.ts`, which drives the SAME
 * `bot-clone.ts` helpers the activities execute in production. Catches the
 * failure classes that broke data-dragon / season-refresh / readme-refresh
 * weekly through June–July 2026: unbuilt `file:` producers, lefthook hooks
 * armed in bot clones, moved cog target paths, and missing image binaries.
 */
export function temporalScheduleRehearsalHelper(
  pkgDir: Directory,
  repoDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
): Container {
  return buildTemporalWorkerImageHelper(pkgDir, depNames, depDirs)
    .withDirectory("/rehearsal/monorepo", repoDir, {
      // `.git` excluded so the rehearsal always exercises the CI shape (the
      // script git-inits a scratch repo). A host mount from a git worktree
      // otherwise carries a `.git` FILE pointing at the main checkout, which
      // breaks `git init` inside the container.
      exclude: ["node_modules", "dist", ".eslintcache", ".git"],
    })
    .withWorkdir("/workspace/packages/temporal")
    .withExec([
      "bun",
      "run",
      "scripts/rehearse-bot-clone.ts",
      "--repo=/rehearsal/monorepo",
    ]);
}

/** Push a temporal-worker image to a registry. */
export async function pushTemporalWorkerImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version = "dev",
  gitSha = "unknown",
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
  version = "dev",
  gitSha = "unknown",
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

  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  container = withBuiltLlmModels(container, depNames);

  return container
    .withWorkdir("/workspace/packages/scout-for-lol")
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY])
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

const OTTOHG_POKEEMERALD_REPO =
  "https://github.com/ottohg/pokeemerald-wasm.git";

/**
 * Build `pokeemerald.wasm` from source — ottohg/pokeemerald-wasm pinned at
 * POKEEMERALD_SOURCE_REF plus our checked-in export patch — mirroring
 * `scripts/build-wasm.sh`. ottohg's fork adds the full C m4a audio engine
 * (`src/m4a_wasm.c`) and the host-PCM exports tripplyons's upstream stubs out;
 * `wasm-src/patches/0001-extra-exports.patch` adds the four game-state exports
 * `symbols.ts` reads. NO binary is committed — the build is reproducible from
 * source (the source-from-download path that fetched the audio-stubbed upstream
 * is gone).
 *
 * The build uses clang `wasm32-unknown-unknown` + `wasm-ld` (LLVM), NOT
 * emscripten — bookworm's clang-14 links a wasm Bun/JSC rejects, so the
 * toolchain image is pinned to trixie (clang-19), see
 * POKEEMERALD_WASM_TOOLCHAIN_IMAGE. `dag.git().commit().tree()` is
 * content-addressed and the toolchain layers sit ahead of the source copy, so a
 * pin/patch bump reuses the toolchain and only recompiles; Renovate's git-refs
 * manager advances the pin as ottohg `master` moves (see constants.ts).
 */
function buildPokeemeraldWasm(patchesDir: Directory): File {
  const source = dag
    .git(OTTOHG_POKEEMERALD_REPO)
    .commit(POKEEMERALD_SOURCE_REF)
    .tree();
  return (
    dag
      .container()
      .from(POKEEMERALD_WASM_TOOLCHAIN_IMAGE)
      .withMountedCache(
        "/var/cache/apt",
        dag.cacheVolume("apt-cache-pokeemerald-wasm"),
      )
      // Toolchain (rarely changes → cached across pin bumps): modern LLVM for the
      // wasm32 clang + wasm-ld, build-essential for the decomp host tools,
      // libpng/zlib + pkg-config for gbagfx, python3 + uv for the sound tooling.
      // Drop docker-clean so the mounted apt cache actually persists debs.
      .withExec([
        "sh",
        "-c",
        "rm -f /etc/apt/apt.conf.d/docker-clean && apt-get update && " +
          "apt-get install -y --no-install-recommends " +
          "clang lld llvm build-essential libpng-dev zlib1g-dev pkg-config " +
          "git make ca-certificates python3 python3-pip",
      ])
      .withExec(["pip3", "install", "--break-system-packages", "uv"])
      // Source + patch come AFTER the toolchain so a pin/patch bump reuses the
      // toolchain layers and only re-runs the compile.
      .withDirectory("/src", source)
      .withDirectory("/patches", patchesDir)
      .withWorkdir("/src")
      .withExec([
        "sh",
        "-c",
        'for p in /patches/*.patch; do echo "applying $p"; patch -p1 --no-backup-if-mismatch < "$p"; done',
      ])
      .withExec(["make", "tools"])
      // The Makefile only builds map headers as a side effect of the GBA `maps.o`
      // recipe (which the wasm target never runs), so drive mapjson ourselves —
      // mirrors scripts/build-wasm.sh.
      .withExec([
        "sh",
        "-c",
        [
          "tools/mapjson/mapjson groups emerald data/maps/map_groups.json data/maps include",
          "tools/mapjson/mapjson layouts emerald data/layouts/layouts.json data/layouts include",
          'for d in data/maps/*/; do n=$(basename "$d"); ' +
            '[ "$n" = _unused ] && continue; [ -f "$d/map.json" ] || continue; ' +
            'tools/mapjson/mapjson map emerald "$d/map.json" data/layouts/layouts.json "$d"; done',
        ].join("\n"),
      ])
      .withEnvVariable("WASM_CC", "clang")
      .withEnvVariable("WASM_LD", "wasm-ld")
      .withExec(["make", "wasm"])
      // Fail fast if the link/codegen produced an implausibly small binary
      // (the real artifact is ~14 MB).
      .withExec([
        "sh",
        "-c",
        'test "$(wc -c < build/wasm/pokeemerald.wasm)" -gt 10000000',
      ])
      .file("/src/build/wasm/pokeemerald.wasm")
  );
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
  version = "dev",
  gitSha = "unknown",
  tsconfig: File | null = null,
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
    // wasm-src is a build input for buildPokeemeraldWasm only (patches applied to
    // the cloned upstream); keep it out of the runtime image.
    .withDirectory(innerRoot, pkgDir, {
      exclude: [...excludes, "wasm-src"],
    });

  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  // Package tsconfigs extend the repo root tsconfig.base.json
  // (extends "../../../../tsconfig.base.json" -> /workspace/tsconfig.base.json).
  // vite 8 (rolldown) hard-fails the frontend build when the extends target is
  // missing, so mount it like the pkg-check containers do (base.ts).
  if (tsconfig != null) {
    container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
  }
  container = withBuiltLlmModels(container, depNames);
  // Order matters: build dsl's dist BEFORE installing discord-plays-core's own
  // node_modules (see withBuiltDiscordStreamLifecycle's doc comment).
  container = withBuiltDiscordStreamLifecycle(container, depNames);
  container = withForkRuntimeDeps(container, depNames);

  container = container
    // Build pokeemerald.wasm from source (ottohg pin + our export patch) and
    // stage it where the emulator expects it. Staged AFTER the package mount so
    // it wins over any locally-built copy a dev may have on disk; the committed
    // blob and the Temporal download path are both gone.
    .withFile(
      `${innerRoot}/packages/backend/assets/pokeemerald.wasm`,
      buildPokeemeraldWasm(pkgDir.directory("wasm-src/patches")),
    )
    .withWorkdir(innerRoot);
  // Workspace install (covers backend + frontend + common) — runs the
  // trustedDependencies postinstalls (node-datachannel, node-av). The
  // discord-video-stream fork lazy-loads sharp in source (no bun patch).
  // No separate backend install: bun workspaces installs all member deps at
  // the root level. A second `bun install` in packages/backend causes bun to
  // try to re-link file: deps already linked by the root install → EEXIST.
  // Wrapped in retry because bun's worker pool also races on `file:` symlinks
  // *within* a single install when the same dep (eslint-config) is referenced
  // by 4+ nested package.jsons (#4336).
  //
  // Clean-reinstall (not plain retry) when discord-stream-lifecycle is present:
  // see `withCleanReinstallIfNeeded`'s doc comment in base.ts — the FIRST install
  // against that dep's own pre-built node_modules silently corrupts its copied
  // package.json (exit 0, no retry triggered), a second clean install fixes it.
  container = withCleanReinstallIfNeeded(container, depNames);

  return (
    container
      .withWorkdir(`${innerRoot}/packages/backend`)
      // Verify the from-source wasm is behaviorally equivalent to what shipped
      // before: the symbol reader resolves all game-state globals, and the audio
      // matches the committed fingerprint baseline. This gates the actual
      // artifact that ships, so a regressive upstream pin bump (Renovate) fails
      // the image build. Both tests are pure-TS (no ffmpeg) and need the staged
      // wasm + installed node_modules, both present by here.
      .withExec([
        "bun",
        "test",
        "src/emulator/emulator-symbols.integration.test.ts",
        "src/emulator/audio/audio-fingerprint.test.ts",
      ])
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
      // Expose the release to Vite BEFORE the build so the SPA's Sentry.init
      // tags events with `release` (import.meta.env.VITE_SENTRY_RELEASE).
      .withEnvVariable("VITE_SENTRY_RELEASE", version)
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
  version = "dev",
  gitSha = "unknown",
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
  version = "dev",
  gitSha = "unknown",
  tsconfig: File | null = null,
): Promise<string> {
  const container = buildDiscordPlaysPokemonImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
    tsconfig,
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
  version = "dev",
  gitSha = "unknown",
  tsconfig: File | null = null,
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];
  const innerRoot = MARIO_KART_INNER_ROOT;
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

  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  // Order matters: build dsl's dist BEFORE installing discord-plays-core's own
  // node_modules (see withBuiltDiscordStreamLifecycle's doc comment).
  container = withBuiltDiscordStreamLifecycle(container, depNames);
  container = withForkRuntimeDeps(container, depNames);

  container = container
    // Copy the compiled core + the files the host stages into MEMFS at
    // runtime (loadFile reads these; see the emulator host).
    .withFile(`${assetsDir}/n64wasm.js`, wasmBuild.file("/src/code/n64wasm.js"))
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
    .withWorkdir(innerRoot);
  // Workspace install (backend + frontend) — runs trustedDependencies
  // postinstalls. The discord-video-stream fork lazy-loads sharp in source
  // (no bun patch).
  // No separate backend install: bun workspaces installs all member deps
  // at the root level. A second `bun install` in packages/backend re-links
  // file: deps already linked by the root install → EEXIST under the
  // hoisted linker, and the retry's node_modules cleanup then leaves the
  // backend member without its file: dep copies (build 5029 smoke caught
  // `Cannot find module '@shepherdjerred/discord-stream-lifecycle/...'`).
  // Mirrors the discord-plays-pokemon image build above.
  //
  // Clean-reinstall (not plain retry) when discord-stream-lifecycle is present:
  // see `withCleanReinstallIfNeeded`'s doc comment in base.ts — the FIRST install
  // against that dep's own pre-built node_modules silently corrupts its copied
  // package.json (exit 0, no retry triggered), a second clean install fixes it.
  container = withCleanReinstallIfNeeded(container, depNames);
  // Package tsconfigs extend the repo root tsconfig.base.json
  // (extends "../../../../tsconfig.base.json" -> /workspace/tsconfig.base.json).
  // vite 8 (rolldown) hard-fails the frontend build when the extends target is
  // missing, so mount it like the pkg-check containers do (base.ts).
  if (tsconfig != null) {
    container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
  }

  return (
    container
      .withWorkdir(`${innerRoot}/packages/backend`)
      // Generate the Prisma client for the leaderboard DB (output is gitignored,
      // so it must be produced in the image). Mirrors the birmel/scout flow.
      .withExec(["bunx", "--trust", "prisma", "generate"])
      // Build the web UI served by the backend web server (web.assets).
      // Expose the release to Vite BEFORE the build so the SPA's Sentry.init
      // tags events with `release` (import.meta.env.VITE_SENTRY_RELEASE).
      .withEnvVariable("VITE_SENTRY_RELEASE", version)
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
      // config.toml, the n64wasm assets, and saves/ relative to CWD. Apply the
      // leaderboard schema to the (persistent-volume) SQLite DB before start —
      // idempotent, birmel-style; harmless when leaderboards are disabled.
      .withWorkdir(innerRoot)
      .withEntrypoint(["sh", "-c", MARIO_KART_ENTRYPOINT_COMMAND])
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
  version = "dev",
  gitSha = "unknown",
  tsconfig: File | null = null,
): Promise<string> {
  const container = buildDiscordPlaysMarioKartImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
    tsconfig,
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
  version = "dev",
  gitSha = "unknown",
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

  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  return container
    .withWorkdir("/workspace/packages/trmnl-dashboard")
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY])
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
  version = "dev",
  gitSha = "unknown",
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
// redlib image (built from upstream's glibc Dockerfile.ubuntu)
// ---------------------------------------------------------------------------

/**
 * Build the redlib image from upstream's glibc `Dockerfile.ubuntu` at a pinned
 * commit (REDLIB_SOURCE_REF). We build it ourselves rather than pulling the
 * published image because that one is musl/Alpine, and Reddit now blocks its
 * TLS fingerprint during OAuth ("Failed to create OAuth client: 401
 * Unauthorized", redlib-org/redlib#551). The glibc build is unaffected.
 */
export function buildRedlibImageHelper(
  version = "dev",
  gitSha = "unknown",
): Container {
  // The cluster node (torvalds) is amd64; without pinning, dockerBuild can emit
  // a wrong-arch image. See amd64Platform() for why an assertion function is
  // used instead of a cast.
  const platform = amd64Platform();
  const redlibSource = dag
    .git("https://github.com/redlib-org/redlib.git")
    .commit(REDLIB_SOURCE_REF)
    .tree();
  return redlibSource
    .dockerBuild({ dockerfile: "Dockerfile.ubuntu", platform })
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/redlib-org/redlib",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withLabel("org.opencontainers.image.revision.redlib", REDLIB_SOURCE_REF);
}

/** Build and push a redlib image to a registry. Returns the digest. */
export async function pushRedlibImageHelper(
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  version = "dev",
  gitSha = "unknown",
): Promise<string> {
  const container = buildRedlibImageHelper(version, gitSha);
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
  // every CI Job pod). See amd64Platform() for the branded-type narrowing.
  const platform = amd64Platform();
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
  version = "dev",
  gitSha = "unknown",
  usePrisma = false,
  installEditorClis = false,
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
