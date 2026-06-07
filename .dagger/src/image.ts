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
  CADDY_IMAGE,
  CLAUDE_CODE_VERSION,
  MCP_PROXY_BASE_IMAGE,
  EDSTEM_MCP_COMMIT,
  CODEX_CLI_VERSION,
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

/**
 * Install runtime binaries required by Birmel's Discord music stack.
 *
 * discord-player-youtubei shells out through youtube-dl-exec. That path needs
 * a real Node binary for the package postinstall/runtime wrapper and Python for
 * yt-dlp itself. ffmpeg-static and @snazzah/davey are package dependencies, but
 * this helper installs the system interpreters before dependency install so the
 * later image smoke checks can prove the final image is voice-playback-ready.
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
      "nodejs",
      "python3",
    ])
    .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"])
    .withExec(["node", "--version"])
    .withExec(["python3", "--version"]);
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
      "--outfile=/usr/local/bin/toolkit",
    ])
    .withExec(["chmod", "+x", "/usr/local/bin/toolkit"])
    .withExec(["toolkit", "--version"]);
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

  // Install deps then set up the final image
  let image = container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "install", "--frozen-lockfile"]);

  if (pkg === "birmel") {
    image = image
      .withExec(["node", "node_modules/youtube-dl-exec/scripts/postinstall.js"])
      .withExec(["test", "-x", "node_modules/youtube-dl-exec/bin/yt-dlp"]);
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
 * adds native HEAD support and fixes the 304-on-index regression. See
 * upstream PR (TBD) tracking the contribution back to lindenlab.
 */
export function buildCaddyS3ProxyImageHelper(
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  // Stage 1: Build custom Caddy binary with S3 proxy plugin
  const caddyBinary = dag
    .container()
    .from(CADDY_BUILDER_IMAGE)
    .withExec([
      "xcaddy",
      "build",
      "--with",
      "github.com/lindenlab/caddy-s3-proxy=github.com/shepherdjerred/caddy-s3-proxy@v0.5.7-head1",
    ])
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
  version: string = "dev",
  gitSha: string = "unknown",
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
  version: string = "dev",
  gitSha: string = "unknown",
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
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    // ffmpeg + libvips for @dank074/discord-video-stream (fluent-ffmpeg encode
    // path + sharp). No browser/GPU/desktop — this is a headless Bun service.
    .withExec([
      "sh",
      "-c",
      "apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg libvips42 ca-certificates && rm -rf /var/lib/apt/lists/*",
    ])
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

  return (
    container
      // Workspace install (covers backend + frontend) — runs the
      // trustedDependencies postinstalls (node-datachannel, node-av) and
      // applies the lazy-sharp bun patch. The committed
      // packages/backend/assets/pokeemerald.wasm is copied in (not excluded).
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
