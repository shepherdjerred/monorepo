/**
 * Release and deploy helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 * All deploy/publish operations should use @func({ cache: "never" }) in the wrapper.
 */
import { dag, Container, Directory, File, Secret } from "@dagger.io/dagger";

import {
  ALPINE_IMAGE,
  TOFU_IMAGE,
  BUN_IMAGE,
  BUN_CACHE,
  RUST_IMAGE,
  SOURCE_EXCLUDES,
  RELEASE_PLEASE_VERSION,
  CLAUDE_CODE_VERSION,
  GH_CLI_VERSION,
} from "./constants";

import { rustBaseContainer } from "./base";

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
      "sh",
      "-c",
      `sed -i 's/\\$version/${version}/g; s/\\$appVersion/${version}/g' Chart.yaml && helm package . --version ${version} --app-version ${version}`,
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
  cloudflareApiToken: Secret | null = null,
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

  if (cloudflareApiToken != null) {
    container = container.withSecretVariable(
      "CLOUDFLARE_API_TOKEN",
      cloudflareApiToken,
    );
  }

  container = container.withExec(["tofu", "init", "-input=false"]);

  if (dryrun) {
    return container.withExec(["tofu", "plan", "-input=false"]);
  }
  return container.withExec(["tofu", "apply", "-auto-approve", "-input=false"]);
}

/** Run tofu init + plan on a stack (read-only — exit code 2 means changes detected). */
export function tofuPlanHelper(
  source: Directory,
  stack: string,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  ghToken: Secret,
  cloudflareAccountId: Secret | null = null,
  cloudflareApiToken: Secret | null = null,
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

  if (cloudflareApiToken != null) {
    container = container.withSecretVariable(
      "CLOUDFLARE_API_TOKEN",
      cloudflareApiToken,
    );
  }

  container = container.withExec(["tofu", "init", "-input=false"]);

  if (dryrun) {
    return container.withExec(["echo", "DRYRUN: would run tofu plan"]);
  }
  // -detailed-exitcode: exit 0 = no changes, exit 2 = changes detected (not an error)
  return container.withExec([
    "sh",
    "-c",
    `tofu plan -input=false -detailed-exitcode; rc=$?; if [ $rc -eq 2 ]; then echo "Changes detected"; exit 0; elif [ $rc -ne 0 ]; then exit $rc; fi`,
  ]);
}

// ---------------------------------------------------------------------------
// NPM publish
// ---------------------------------------------------------------------------

/**
 * Publish an npm package via bun publish.
 * Accepts a pre-built dist directory (from per-package build step artifact)
 * to avoid rebuilding.
 */
export function publishNpmHelper(
  pkgDir: Directory,
  pkg: string,
  npmToken: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  dryrun = false,
  tsconfig: File | null = null,
  preBuiltDist: Directory | null = null,
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

  if (tsconfig != null) {
    container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
  }

  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  // Build workspace deps that need compilation
  const buildDeps = depNames.filter((d) => d !== "eslint-config");
  for (const dep of buildDeps) {
    container = container
      .withWorkdir(`/workspace/packages/${dep}`)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "build"]);
  }

  container = container.withWorkdir(`/workspace/packages/${pkg}`);

  // Replace file: refs with actual versions before publishing
  container = container.withExec([
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
  ]);

  // Mount pre-built dist from upstream build step, or build from source
  if (preBuiltDist != null) {
    container = container.withDirectory(
      `/workspace/packages/${pkg}/dist`,
      preBuiltDist,
    );
  } else {
    container = container.withExec(["bun", "run", "build"]);
  }

  // Read name/version before the publish step so we can check npm
  container = container.withExec([
    "sh",
    "-c",
    'cat package.json | bun -e \'const p=JSON.parse(await Bun.stdin.text()); Bun.write("/tmp/pkg-name", p.name); Bun.write("/tmp/pkg-ver", p.version)\'',
  ]);

  if (dryrun) {
    return container.withExec([
      "sh",
      "-c",
      `echo "DRYRUN: would publish ${pkg} to npm"`,
    ]);
  }

  return container
    .withSecretVariable("NPM_TOKEN", npmToken)
    .withExec([
      "sh",
      "-c",
      [
        `PKG_NAME=$(cat /tmp/pkg-name)`,
        `PKG_VER=$(cat /tmp/pkg-ver)`,
        `if npm view "$PKG_NAME@$PKG_VER" version; then`,
        `echo "Version $PKG_VER of $PKG_NAME already published — skipping"`,
        `else bun publish --access public --tag latest --token "$NPM_TOKEN"; fi`,
      ].join("\n"),
    ]);
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
  tsconfig: File | null = null,
  needsPlaywright = false,
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

  if (tsconfig != null) {
    container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
  }

  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  // Build workspace deps that need compilation (e.g. astro-opengraph-images).
  // Skip eslint-config (lint-only dep, no dist/ needed for site build).
  const buildDeps = depNames.filter((d) => d !== "eslint-config");
  for (const dep of buildDeps) {
    container = container
      .withWorkdir(`/workspace/packages/${dep}`)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "build"]);
  }

  // Install Playwright only when the site needs it (e.g. sjer.red for OG image generation)
  if (needsPlaywright) {
    container = container
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withMountedCache(
        "/root/.cache/ms-playwright",
        dag.cacheVolume("playwright-cache"),
      )
      .withExec(["bunx", "playwright", "install", "chromium", "--with-deps"]);
  }

  container = container
    .withSecretVariable("AWS_ACCESS_KEY_ID", awsAccessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey)
    // SeaweedFS S3 requires s3v4 signing; pin the region to avoid mismatches
    // with newer AWS CLI versions that use CRT-based signing.
    .withEnvVariable("AWS_DEFAULT_REGION", "us-east-1")
    .withEnvVariable("AWS_REQUEST_CHECKSUM_CALCULATION", "WHEN_REQUIRED")
    .withEnvVariable("AWS_RESPONSE_CHECKSUM_VALIDATION", "WHEN_REQUIRED");

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

/** Deploy a pre-built static site directory to S3. No bun install or build step. */
export function deployStaticSiteHelper(
  siteDir: Directory,
  bucket: string,
  target: string,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  dryrun = false,
): Container {
  const endpoint =
    target === "r2"
      ? "https://r2.cloudflarestorage.com"
      : "https://seaweedfs.sjer.red";

  let container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec(["apk", "add", "--no-cache", "aws-cli"])
    .withDirectory("/site", siteDir)
    .withWorkdir("/site")
    .withSecretVariable("AWS_ACCESS_KEY_ID", awsAccessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey)
    .withEnvVariable("AWS_DEFAULT_REGION", "us-east-1")
    .withEnvVariable("AWS_REQUEST_CHECKSUM_CALCULATION", "WHEN_REQUIRED")
    .withEnvVariable("AWS_RESPONSE_CHECKSUM_VALIDATION", "WHEN_REQUIRED");

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would sync /site to s3://${bucket}/ via ${endpoint}`,
    ]);
  }
  return container.withExec([
    "aws",
    "s3",
    "sync",
    ".",
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
    `curl -sf -X POST "${serverUrl}/api/v1/applications/${appName}/sync" -H "Authorization: Bearer $ARGOCD_TOKEN" -H "Content-Type: application/json"`,
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

/** Build cooklang-for-obsidian plugin artifacts. */
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
    .withWorkdir("/workspace/packages/cooklang-for-obsidian")
    .withDirectory("/workspace/packages/cooklang-for-obsidian", pkgDir, {
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
    .withExec(["bun", "install", "--frozen-lockfile"])
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
          # Get existing SHA — 404 means file is new (no SHA needed), other errors are real failures
          existing_sha=""
          http_code="$(gh api repos/shepherdjerred/cooklang-obsidian-releases/contents/$f --jq .sha 2>&1)" && existing_sha="$http_code" || {
            case "$http_code" in
              *"404"*|*"Not Found"*) existing_sha="" ;;
              *) echo "Failed to check $f: $http_code" >&2; exit 1 ;;
            esac
          }
          gh api repos/shepherdjerred/cooklang-obsidian-releases/contents/$f \
            --method PUT \
            -f message="chore: update $f v${version}" \
            -f content="$(base64 < $f)" \
            -f sha="$existing_sha"
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
      `apk add --no-cache curl && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
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
  return container
    .withExec([
      "sh",
      "-c",
      `printf '#!/bin/sh\\necho "$$GH_TOKEN"\\n' > /usr/local/bin/git-askpass && chmod +x /usr/local/bin/git-askpass`,
    ])
    .withEnvVariable("GIT_ASKPASS", "/usr/local/bin/git-askpass")
    .withExec([
      "sh",
      "-c",
      `git clone https://github.com/shepherdjerred/monorepo.git /repo && cd /repo && \
       echo '${digests}' | jq -r 'to_entries[] | "s|\\(.key).*|\\(.key): \\"\\(.value)\\",|"' | while read -r pattern; do \
         sed -i "$pattern" packages/homelab/src/cdk8s/src/versions.ts; \
       done && \
       git checkout -b "chore/version-bump-${version}" && \
       git add packages/homelab/src/cdk8s/src/versions.ts && git commit -m "chore: bump image versions to ${version}" && \
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
  let output = dag.directory();

  for (const { target, filename } of targets) {
    let container = rustBaseContainer(pkgDir).withExec([
      "rustup",
      "target",
      "add",
      target,
    ]);

    // Cross-compilation setup for aarch64
    if (target === "aarch64-unknown-linux-gnu") {
      container = container
        .withEnvVariable(
          "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER",
          "aarch64-linux-gnu-gcc",
        )
        .withEnvVariable(
          "PKG_CONFIG_PATH",
          "/usr/lib/aarch64-linux-gnu/pkgconfig",
        )
        .withEnvVariable("PKG_CONFIG_SYSROOT_DIR", "/usr/aarch64-linux-gnu")
        .withExec([
          "sh",
          "-c",
          `sed -i '/\\[target.aarch64-unknown-linux-gnu\\]/,/^\\[/{s/linker = .*/linker = "aarch64-linux-gnu-gcc"/; s/rustflags = .*/rustflags = []/}' .cargo/config.toml`,
        ]);
    }

    const binary = container
      .withExec(["cargo", "build", "--release", "--target", target])
      // Copy binary out of cache mount so .file() can access it
      .withExec([
        "cp",
        `/workspace/target/${target}/release/clauderon`,
        "/tmp/clauderon",
      ])
      .file("/tmp/clauderon");

    output = output.withFile(filename, binary);
  }

  return output;
}

// ---------------------------------------------------------------------------
// Release-please
// ---------------------------------------------------------------------------

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
      `release-please release-pr --token=$GH_TOKEN --repo-url=shepherdjerred/monorepo --target-branch=main`,
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
      `apk add --no-cache curl && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
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
    `if gh release view "cooklang-rich-preview-v${version}" --repo shepherdjerred/monorepo >/dev/null 2>&1; then
  echo "Release cooklang-rich-preview-v${version} already exists, skipping"
else
  gh release create "cooklang-rich-preview-v${version}" /artifacts/* --repo shepherdjerred/monorepo --title "cooklang-rich-preview v${version}" --generate-notes
fi`,
  ]);
}

// ---------------------------------------------------------------------------
// Code review
// ---------------------------------------------------------------------------

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
