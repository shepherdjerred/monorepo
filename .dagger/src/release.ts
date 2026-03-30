/**
 * Release and deploy helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 * All deploy/publish operations should use @func({ cache: "never" }) in the wrapper.
 */
import { dag, Container, Directory, File, Secret } from "@dagger.io/dagger";

// renovate: datasource=docker depName=alpine
const ALPINE_IMAGE = "alpine:3.21";
// renovate: datasource=docker depName=hashicorp/terraform
const TOFU_IMAGE = "ghcr.io/opentofu/opentofu:1.9.0";

const SOURCE_EXCLUDES = [
  "**/node_modules",
  "**/.eslintcache",
  "**/dist",
  "**/target",
  ".git",
  "**/.vscode",
  "**/.idea",
  "**/coverage",
  "**/build",
  "**/.next",
  "**/.tsbuildinfo",
  "**/__pycache__",
  "**/.DS_Store",
  "**/archive",
];

// renovate: datasource=docker depName=oven/bun
const BUN_IMAGE = "oven/bun:1.2.17-debian";
const BUN_CACHE = "bun-install-cache";

// ---------------------------------------------------------------------------
// Helm
// ---------------------------------------------------------------------------

/** Package a single Helm chart and push it to ChartMuseum. */
export function helmPackageHelper(
  source: Directory,
  chartName: string,
  version: string,
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
  dryrun = false,
): Container {
  let container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec(["apk", "add", "--no-cache", "helm", "curl"])
    .withWorkdir("/chart")
    .withDirectory(
      "/chart",
      source.directory(`packages/homelab/src/cdk8s/helm/${chartName}`),
    )
    // Copy CDK8s manifest into templates/ if it exists
    .withExec([
      "sh",
      "-c",
      `if [ -f /cdk8s-dist/${chartName}.k8s.yaml ]; then mkdir -p templates && cp /cdk8s-dist/${chartName}.k8s.yaml templates/; fi`,
    ])
    .withExec([
      "helm",
      "package",
      ".",
      "--version",
      version,
      "--app-version",
      version,
    ])
    .withSecretVariable("CHARTMUSEUM_PASSWORD", chartMuseumPassword);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would push ${chartName}-${version}.tgz to ChartMuseum`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `curl -sf -u "${chartMuseumUsername}:$CHARTMUSEUM_PASSWORD" --data-binary @$(ls *.tgz) https://chartmuseum.sjer.red/api/charts`,
  ]);
}

// ---------------------------------------------------------------------------
// OpenTofu
// ---------------------------------------------------------------------------

/** Run tofu init + apply on a stack. */
export function tofuApplyHelper(
  source: Directory,
  stack: string,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  ghToken: Secret,
  cloudflareAccountId: Secret | null = null,
  dryrun = false,
): Container {
  let container = dag
    .container()
    .from(TOFU_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory(
      "/workspace",
      source.directory(`packages/homelab/src/tofu/${stack}`),
    )
    .withSecretVariable("AWS_ACCESS_KEY_ID", awsAccessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey)
    .withSecretVariable("GH_TOKEN", ghToken);

  if (cloudflareAccountId != null) {
    container = container.withSecretVariable(
      "TF_VAR_cloudflare_account_id",
      cloudflareAccountId,
    );
  }

  container = container.withExec(["tofu", "init", "-input=false"]);

  if (dryrun) {
    return container.withExec(["tofu", "plan", "-input=false"]);
  }
  return container.withExec(["tofu", "apply", "-auto-approve", "-input=false"]);
}

// ---------------------------------------------------------------------------
// NPM publish
// ---------------------------------------------------------------------------

/** Publish an npm package via bun publish. */
export function publishNpmHelper(
  pkgDir: Directory,
  pkg: string,
  npmToken: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  dryrun = false,
): Container {
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: SOURCE_EXCLUDES,
    });

  // Mount deps at correct relative paths for file: protocol resolution
  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: SOURCE_EXCLUDES },
    );
  }

  return (
    container
      .withExec([
        "bash",
        "-c",
        "bun install --frozen-lockfile 2>/dev/null || bun install",
      ])
      // Replace file: refs with actual versions before publishing
      .withExec([
        "sh",
        "-c",
        `cd /workspace/packages/${pkg} && node -e '
        const fs = require("fs");
        const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
        for (const [depType, deps] of [["dependencies", pkg.dependencies || {}], ["devDependencies", pkg.devDependencies || {}]]) {
          for (const [name, ver] of Object.entries(deps)) {
            if (typeof ver === "string" && ver.startsWith("file:")) {
              const depPath = ver.replace("file:", "");
              try {
                const depPkg = JSON.parse(fs.readFileSync(depPath + "/package.json", "utf8"));
                deps[name] = "^" + depPkg.version;
              } catch(e) { /* skip if dep not found */ }
            }
          }
        }
        fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\\n");
      '`,
      ])
      .withSecretVariable("NPM_TOKEN", npmToken)
      .withExec([
        "sh",
        "-c",
        dryrun
          ? `echo "DRYRUN: would publish ${pkg} to npm"`
          : `echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > ~/.npmrc && bun publish --access public --tag latest`,
      ])
  );
}

// ---------------------------------------------------------------------------
// Site deploy (S3 / R2)
// ---------------------------------------------------------------------------

/** Build and deploy a static site to S3 (SeaweedFS) or R2 (Cloudflare). */
export function deploySiteHelper(
  pkgDir: Directory,
  pkg: string,
  bucket: string,
  buildCmd: string,
  distSubdir: string,
  target: string,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  cloudflareAccountId: string = "",
  depNames: string[] = [],
  depDirs: Directory[] = [],
  dryrun = false,
): Container {
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "awscli",
    ])
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: SOURCE_EXCLUDES,
    });

  // Mount deps at correct relative paths for file: protocol resolution
  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: SOURCE_EXCLUDES },
    );
  }

  container = container
    .withExec([
      "bash",
      "-c",
      "bun install --frozen-lockfile 2>/dev/null || bun install",
    ])
    .withSecretVariable("AWS_ACCESS_KEY_ID", awsAccessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey);

  if (buildCmd) {
    container = container.withExec(["sh", "-c", buildCmd]);
  }

  const endpoint =
    target === "r2"
      ? `https://${cloudflareAccountId}.r2.cloudflarestorage.com`
      : "https://seaweedfs.sjer.red";

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would sync ${distSubdir} to s3://${bucket}/ via ${endpoint}`,
    ]);
  }
  return container.withExec([
    "aws",
    "s3",
    "sync",
    distSubdir,
    `s3://${bucket}/`,
    "--endpoint-url",
    endpoint,
    "--delete",
  ]);
}

// ---------------------------------------------------------------------------
// ArgoCD
// ---------------------------------------------------------------------------

/** Trigger an ArgoCD sync for an application. */
export function argoCdSyncHelper(
  appName: string,
  argoCdToken: Secret,
  serverUrl: string = "https://argocd.sjer.red",
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec(["apk", "add", "--no-cache", "curl"])
    .withSecretVariable("ARGOCD_TOKEN", argoCdToken);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would sync ArgoCD app ${appName}`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `curl -sf -X POST "${serverUrl}/api/v1/applications/${appName}/sync" -H "Authorization: Bearer $ARGOCD_TOKEN" -H "Content-Type: application/json" || true`,
  ]);
}

/** Poll ArgoCD until an application is healthy or timeout. */
export function argoCdHealthWaitHelper(
  appName: string,
  argoCdToken: Secret,
  timeoutSeconds: number = 300,
  serverUrl: string = "https://argocd.sjer.red",
  dryrun = false,
): Container {
  if (dryrun) {
    return dag
      .container()
      .from(ALPINE_IMAGE)
      .withExec([
        "echo",
        `DRYRUN: would wait for ArgoCD app ${appName} to become healthy`,
      ]);
  }
  return dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec(["apk", "add", "--no-cache", "curl", "jq"])
    .withSecretVariable("ARGOCD_TOKEN", argoCdToken)
    .withExec([
      "sh",
      "-c",
      `elapsed=0; while [ $elapsed -lt ${timeoutSeconds} ]; do status=$(curl -sf -H "Authorization: Bearer $ARGOCD_TOKEN" "${serverUrl}/api/v1/applications/${appName}" | jq -r '.status.health.status'); echo "Health: $status ($elapsed/${timeoutSeconds}s)"; if [ "$status" = "Healthy" ]; then exit 0; fi; sleep 10; elapsed=$((elapsed + 10)); done; echo "Timeout waiting for ${appName} to become healthy"; exit 1`,
    ]);
}

// ---------------------------------------------------------------------------
// Cooklang
// ---------------------------------------------------------------------------

/** Build cooklang-rich-preview artifacts. */
export function cooklangBuildHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Container {
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace/packages/cooklang-rich-preview")
    .withDirectory("/workspace/packages/cooklang-rich-preview", pkgDir, {
      exclude: SOURCE_EXCLUDES,
    });

  if (tsconfig != null) {
    container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
  }

  // Mount deps at correct relative paths for file: protocol resolution
  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: SOURCE_EXCLUDES },
    );
  }

  return container
    .withExec([
      "bash",
      "-c",
      "bun install --frozen-lockfile 2>/dev/null || bun install",
    ])
    .withExec(["bun", "run", "build"]);
}

/** Push cooklang artifacts to a GitHub repository. */
export function cooklangPushHelper(
  source: Directory,
  version: string,
  ghToken: Secret,
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec([
      "sh",
      "-c",
      "apk add --no-cache curl git && curl -fsSL https://github.com/cli/cli/releases/download/v2.74.0/gh_2.74.0_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_2.74.0_linux_amd64/bin/gh",
    ])
    .withSecretVariable("GH_TOKEN", ghToken)
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts", source);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would push cooklang artifacts v${version}`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `for f in main.js manifest.json styles.css; do
        if [ -f "$f" ]; then
          gh api repos/shepherdjerred/cooklang-obsidian-releases/contents/$f \
            --method PUT \
            -f message="chore: update $f v${version}" \
            -f content="$(base64 < $f)" \
            -f sha="$(gh api repos/shepherdjerred/cooklang-obsidian-releases/contents/$f --jq .sha 2>/dev/null || echo '')" \
            2>/dev/null || true
        fi
      done`,
  ]);
}

// ---------------------------------------------------------------------------
// Clauderon
// ---------------------------------------------------------------------------

/** Upload clauderon binaries to a GitHub release. */
export function clauderonUploadHelper(
  binaries: Directory,
  version: string,
  ghToken: Secret,
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec([
      "sh",
      "-c",
      "apk add --no-cache curl && curl -fsSL https://github.com/cli/cli/releases/download/v2.74.0/gh_2.74.0_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_2.74.0_linux_amd64/bin/gh",
    ])
    .withSecretVariable("GH_TOKEN", ghToken)
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts", binaries);

  if (dryrun) {
    return container.withExec([
      "sh",
      "-c",
      `echo "DRYRUN: would upload clauderon-v${version}" && ls -la /artifacts/`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `gh release upload "clauderon-v${version}" /artifacts/* --repo shepherdjerred/monorepo --clobber`,
  ]);
}

// ---------------------------------------------------------------------------
// Version commit-back
// ---------------------------------------------------------------------------

/** Update versions.ts with new image digests and create an auto-merge PR. */
export function versionCommitBackHelper(
  digests: string,
  version: string,
  ghToken: Secret,
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec([
      "sh",
      "-c",
      "apk add --no-cache git jq sed curl && curl -fsSL https://github.com/cli/cli/releases/download/v2.74.0/gh_2.74.0_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_2.74.0_linux_amd64/bin/gh",
    ])
    .withSecretVariable("GH_TOKEN", ghToken);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would commit version bump ${version}`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `git clone "https://x-access-token:$GH_TOKEN@github.com/shepherdjerred/monorepo.git" /repo && cd /repo && \
       echo '${digests}' | jq -r 'to_entries[] | "s|\\(.key).*|\\(.key): \\"\\(.value)\\",|"' | while read -r pattern; do \
         sed -i "$pattern" packages/homelab/src/cdk8s/src/versions.ts; \
       done && \
       git checkout -b "chore/version-bump-${version}" && \
       git add -A && git commit -m "chore: bump image versions to ${version}" && \
       git push origin "chore/version-bump-${version}" && \
       gh pr create --title "chore: bump image versions to ${version}" --body "Auto-generated version bump" --auto`,
  ]);
}

// ---------------------------------------------------------------------------
// Clauderon multi-arch binary collection
// ---------------------------------------------------------------------------

interface ClauderonTarget {
  target: string;
  filename: string;
}

/** Build clauderon for multiple targets and collect binaries into one Directory. */
export function clauderonCollectBinariesHelper(
  pkgDir: Directory,
  targets: ClauderonTarget[],
): Directory {
  // renovate: datasource=docker depName=rust
  const RUST_IMAGE = "rust:1.89.0-bookworm";

  let output = dag.directory();

  for (const { target, filename } of targets) {
    const binary = dag
      .container()
      .from(RUST_IMAGE)
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "clang",
        "libssl-dev",
        "pkg-config",
        "gcc-aarch64-linux-gnu",
      ])
      .withMountedCache(
        "/usr/local/cargo/registry",
        dag.cacheVolume("cargo-registry"),
      )
      .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
      .withMountedCache("/workspace/target", dag.cacheVolume("cargo-target"))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", pkgDir, {
        exclude: ["target", "node_modules", ".git"],
      })
      .withExec(["rustup", "target", "add", target])
      .withExec(["cargo", "build", "--release", "--target", target])
      .file(`/workspace/target/${target}/release/clauderon`);

    output = output.withFile(filename, binary);
  }

  return output;
}

// ---------------------------------------------------------------------------
// Release-please
// ---------------------------------------------------------------------------

// renovate: datasource=npm depName=release-please
const RELEASE_PLEASE_VERSION = "17.3.0";

/** Run release-please to create release PRs and GitHub releases. */
export function releasePleaseHelper(
  source: Directory,
  ghToken: Secret,
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "git",
    ])
    .withExec(["bun", "add", "-g", `release-please@${RELEASE_PLEASE_VERSION}`])
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
    .withSecretVariable("GH_TOKEN", ghToken);

  if (dryrun) {
    return container.withExec([
      "echo",
      "DRYRUN: would run release-please (release-pr + github-release)",
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    [
      `release-please release-pr --token=$GH_TOKEN --repo-url=shepherdjerred/monorepo --target-branch=main || true`,
      `release-please github-release --token=$GH_TOKEN --repo-url=shepherdjerred/monorepo --target-branch=main`,
    ].join(" && "),
  ]);
}

// ---------------------------------------------------------------------------
// Cooklang GitHub release
// ---------------------------------------------------------------------------

/** Create a GitHub release for cooklang-rich-preview with built artifacts. */
export function cooklangCreateReleaseHelper(
  artifacts: Directory,
  version: string,
  ghToken: Secret,
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec([
      "sh",
      "-c",
      "apk add --no-cache curl && curl -fsSL https://github.com/cli/cli/releases/download/v2.74.0/gh_2.74.0_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_2.74.0_linux_amd64/bin/gh",
    ])
    .withSecretVariable("GH_TOKEN", ghToken)
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts", artifacts);

  if (dryrun) {
    return container.withExec([
      "sh",
      "-c",
      `echo "DRYRUN: would create cooklang release v${version}" && ls -la /artifacts/`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `gh release create "cooklang-rich-preview-v${version}" /artifacts/* --repo shepherdjerred/monorepo --title "cooklang-rich-preview v${version}" --generate-notes || echo "Release already exists or no version"`,
  ]);
}

// ---------------------------------------------------------------------------
// Code review
// ---------------------------------------------------------------------------

// renovate: datasource=npm depName=@anthropic-ai/claude-code
const CLAUDE_CODE_VERSION = "2.1.71";

/** Run AI code review on a PR. */
export function codeReviewHelper(
  source: Directory,
  prNumber: string,
  baseBranch: string,
  commitSha: string,
  ghToken: Secret,
  claudeToken: Secret,
): Container {
  const prompt = `Review PR #${prNumber} on branch ${baseBranch} (head SHA: ${commitSha}).

Read the CLAUDE.md file first for project context.

Use gh CLI to inspect the PR diff and details:
  gh pr view ${prNumber} --repo shepherdjerred/monorepo
  gh pr diff ${prNumber} --repo shepherdjerred/monorepo

Review this PR focusing on things linters and typecheckers can't catch:
- Functionality: Does the code actually do what the PR claims?
- Architectural fit: Does this change fit the codebase patterns?
- Logic errors: Are there bugs, race conditions, or edge cases?
- Security: Any vulnerabilities that static analysis would miss?
- Design: Is this the right approach? Are there simpler alternatives?

After reviewing, post your review using gh CLI:
  gh pr review ${prNumber} --repo shepherdjerred/monorepo --approve --body 'your review'
  OR
  gh pr review ${prNumber} --repo shepherdjerred/monorepo --request-changes --body 'your review'

Be direct and concise. If the PR is trivial (pure merge/rebase with minimal changes), approve with a brief note.`;

  return dag
    .container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "git",
    ])
    .withExec([
      "bun",
      "add",
      "-g",
      `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`,
    ])
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
    .withSecretVariable("GH_TOKEN", ghToken)
    .withSecretVariable("CLAUDE_CODE_OAUTH_TOKEN", claudeToken)
    .withExec([
      "claude",
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      "claude-opus-4-6",
      "--max-turns",
      "35",
      prompt,
    ]);
}

// ---------------------------------------------------------------------------
// Cargo deny
// ---------------------------------------------------------------------------

/** Run cargo deny check on the Rust project. */
export function cargoDenyHelper(pkgDir: Directory): Container {
  // renovate: datasource=docker depName=rust
  const RUST_IMAGE = "rust:1.89.0-bookworm";
  return dag
    .container()
    .from(RUST_IMAGE)
    .withExec(["cargo", "install", "cargo-deny"])
    .withWorkdir("/workspace")
    .withDirectory("/workspace", pkgDir, {
      exclude: ["target", "node_modules", ".git"],
    })
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume("cargo-registry"),
    )
    .withExec(["cargo", "deny", "check"]);
}
