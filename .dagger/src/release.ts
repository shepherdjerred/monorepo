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
  cdk8sDist: Directory,
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
    .withDirectory("/cdk8s-dist", cdk8sDist)
    .withExec([
      "sh",
      "-c",
      `mkdir -p templates && cp /cdk8s-dist/${chartName}.k8s.yaml templates/`,
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
    // GitHub provider reads GITHUB_TOKEN; GH CLI reads GH_TOKEN — set both
    .withSecretVariable("GITHUB_TOKEN", ghToken)
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
    // GitHub provider reads GITHUB_TOKEN; GH CLI reads GH_TOKEN — set both
    .withSecretVariable("GITHUB_TOKEN", ghToken)
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
/**
 * Build and publish an npm package.
 *
 * Two modes:
 * - Dev release (devSuffix set): reads version from package.json, appends -dev.<suffix>,
 *   publishes with --tag dev (e.g. 1.15.0-dev.695)
 * - Prod release (devSuffix empty): publishes with version from package.json, --tag latest
 *
 * Always builds from source via Dagger caching (no Buildkite artifact transfer).
 * See decisions/2026-04-04_unified-versioning-strategy.md
 */
export function publishNpmHelper(
  pkgDir: Directory,
  pkg: string,
  npmToken: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  dryrun = false,
  tsconfig: File | null = null,
  devSuffix: string = "",
): Container {
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: SOURCE_EXCLUDES,
    });

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
    [
      `cd /workspace/packages/${pkg}`,
      `bun -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf8")); for(const [,deps] of [["dependencies",p.dependencies||{}],["devDependencies",p.devDependencies||{}]]) { for(const [name,ver] of Object.entries(deps)) { if(typeof ver==="string"&&ver.startsWith("file:")) { try { const d=JSON.parse(fs.readFileSync(ver.replace("file:","")+"/package.json","utf8")); deps[name]="^"+d.version } catch {} } } } fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\\n")'`,
    ].join(" && "),
  ]);

  // For dev releases, read version from package.json and append -dev.<suffix> (ephemeral, never committed)
  if (devSuffix !== "") {
    container = container.withExec([
      "sh",
      "-c",
      `bun -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf8")); p.version=p.version+"-dev.${devSuffix}"; fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\\n")'`,
    ]);
  }

  // Build from source (Dagger caches this across runs)
  container = container.withExec(["bun", "run", "build"]);

  const tag = devSuffix !== "" ? "dev" : "latest";

  if (dryrun) {
    return container.withExec([
      "sh",
      "-c",
      `echo "DRYRUN: would publish ${pkg} to npm with --tag ${tag}"`,
    ]);
  }

  // Write .npmrc in project dir and publish in same sh -c so the token is available.
  // bun publish has no --token flag; env var names with // are invalid.
  // Ephemeral Dagger container — .npmrc never committed.
  return container
    .withSecretVariable("NPM_TOKEN", npmToken)
    .withExec([
      "sh",
      "-c",
      `echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc && bun publish --access public --tag ${tag} --tolerate-republish`,
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

const COOKLANG_PLUGIN_REPO = "shepherdjerred/cooklang-for-obsidian";

/**
 * Publish cooklang plugin artifacts to the external plugin repository.
 *
 * Determines the next semver patch from the latest release tag (or the
 * built manifest's version if no releases exist), rewrites
 * artifacts/manifest.json with the new version, commits the three plugin
 * files + an updated versions.json to the plugin repo's main branch, and
 * cuts a GitHub release tagged with the bare version (Obsidian directory
 * convention).
 *
 * Emits the new version as the final line on stdout so callers can chain
 * a commit-back step.
 */
export function cooklangPublishHelper(
  source: Directory,
  ghToken: Secret,
  dryrun = false,
): Container {
  const container = dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec([
      "sh",
      "-c",
      `apk add --no-cache curl git jq && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ])
    .withSecretVariable("GH_TOKEN", ghToken)
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts", source);

  if (dryrun) {
    return container.withExec([
      "sh",
      "-c",
      [
        `set -eu`,
        `latest=$(gh release list --repo ${COOKLANG_PLUGIN_REPO} --limit 50 --json tagName --jq '.[].tagName' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1)`,
        `base="\${latest:-$(jq -r .version /artifacts/manifest.json)}"`,
        `major=$(echo "$base" | cut -d. -f1)`,
        `minor=$(echo "$base" | cut -d. -f2)`,
        `patch=$(echo "$base" | cut -d. -f3)`,
        `new="$major.$minor.$((patch + 1))"`,
        `echo "DRYRUN: cooklang plugin $base -> $new (would commit + release on ${COOKLANG_PLUGIN_REPO})"`,
        `echo "$new"`,
      ].join(" && "),
    ]);
  }

  return container
    .withExec([
      "sh",
      "-c",
      `printf '#!/bin/sh\\necho "$GH_TOKEN"\\n' > /usr/local/bin/git-askpass && chmod +x /usr/local/bin/git-askpass`,
    ])
    .withEnvVariable("GIT_ASKPASS", "/usr/local/bin/git-askpass")
    .withExec([
      "sh",
      "-c",
      [
        `set -eu`,
        // Clone plugin repo
        `git clone https://github.com/${COOKLANG_PLUGIN_REPO}.git /repo`,
        `cd /repo`,
        `git config user.email "ci@sjer.red"`,
        `git config user.name "CI Bot"`,
        // Compute next version: latest semver release tag + 1 patch, fallback to artifacts manifest
        `latest=$(gh release list --repo ${COOKLANG_PLUGIN_REPO} --limit 50 --json tagName --jq '.[].tagName' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1)`,
        `base="\${latest:-$(jq -r .version /artifacts/manifest.json)}"`,
        `major=$(echo "$base" | cut -d. -f1)`,
        `minor=$(echo "$base" | cut -d. -f2)`,
        `patch=$(echo "$base" | cut -d. -f3)`,
        `new="$major.$minor.$((patch + 1))"`,
        `echo "cooklang plugin: $base -> $new"`,
        // Rewrite artifacts manifest with new version
        `jq --arg v "$new" '.version = $v' /artifacts/manifest.json > /artifacts/manifest.json.tmp`,
        `mv /artifacts/manifest.json.tmp /artifacts/manifest.json`,
        `min=$(jq -r .minAppVersion /artifacts/manifest.json)`,
        // Copy artifacts to repo + update versions.json
        `cp /artifacts/main.js /artifacts/manifest.json /artifacts/styles.css /repo/`,
        `if [ ! -f /repo/versions.json ]; then echo '{}' > /repo/versions.json; fi`,
        `jq --arg v "$new" --arg m "$min" '. + {($v): $m}' /repo/versions.json > /repo/versions.json.tmp`,
        `mv /repo/versions.json.tmp /repo/versions.json`,
        // Commit + push to plugin repo main
        `git -C /repo add main.js manifest.json styles.css versions.json`,
        `if git -C /repo diff --cached --quiet; then echo "No artifact changes to commit"; else git -C /repo commit -m "release: v$new" -m "Auto-Generated: ci-bot"; git -C /repo push origin HEAD:main; fi`,
        // Create the GitHub release on the plugin repo (idempotent: skip if tag already exists)
        `if gh release view "$new" --repo ${COOKLANG_PLUGIN_REPO} >/dev/null 2>&1; then echo "Release $new already exists on ${COOKLANG_PLUGIN_REPO}, skipping"; else gh release create "$new" /artifacts/main.js /artifacts/manifest.json /artifacts/styles.css --repo ${COOKLANG_PLUGIN_REPO} --title "v$new" --generate-notes; fi`,
        // Last line of stdout = new version, for callers
        `printf '%s\\n' "$new"`,
      ].join(" && "),
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
  // Dev releases (0.0.0-dev.*): create a prerelease. Prod releases: upload to existing release.
  const isDev = version.includes("dev");
  if (isDev) {
    return container.withExec([
      "sh",
      "-c",
      `gh release create "clauderon-v${version}" /artifacts/* --repo shepherdjerred/monorepo --title "clauderon v${version}" --prerelease --notes "Dev build"`,
    ]);
  }
  return container.withExec([
    "sh",
    "-c",
    `if ! gh release view "clauderon-v${version}" --repo shepherdjerred/monorepo; then echo "Release clauderon-v${version} does not exist — skipping upload"; exit 0; fi; gh release upload "clauderon-v${version}" /artifacts/* --repo shepherdjerred/monorepo --clobber`,
  ]);
}

// ---------------------------------------------------------------------------
// Version commit-back
// ---------------------------------------------------------------------------

const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const CI_BASE_VERSION_BUMP_BRANCH = "chore/ci-base-version-bump-pending";
const COOKLANG_VERSION_BUMP_BRANCH = "chore/cooklang-version-bump-pending";

/** Update versions.ts with new image digests and create or refresh an auto-merge PR. */
export function versionCommitBackHelper(
  digests: string,
  version: string,
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
      "curl",
      "ca-certificates",
    ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ])
    .withSecretVariable("GH_TOKEN", ghToken);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would update ${VERSION_BUMP_BRANCH} with version bump ${version} and digests: ${digests}`,
    ]);
  }

  // Parse digests JSON into "key=digest" args for the update script
  const digestArgs = digests.trim()
    ? (() => {
        try {
          const parsed = JSON.parse(digests);
          return Object.entries(parsed)
            .filter(([, v]) => typeof v === "string" && v !== "")
            .map(([k, v]) => `"${k}=${v}"`)
            .join(" ");
        } catch {
          return "";
        }
      })()
    : "";

  return container
    .withExec([
      "sh",
      "-c",
      `printf '#!/bin/sh\\necho "$GH_TOKEN"\\n' > /usr/local/bin/git-askpass && chmod +x /usr/local/bin/git-askpass`,
    ])
    .withEnvVariable("GIT_ASKPASS", "/usr/local/bin/git-askpass")
    .withExec([
      "sh",
      "-c",
      [
        `git clone https://github.com/shepherdjerred/monorepo.git /repo`,
        `cd /repo`,
        `git config user.email "ci@sjer.red"`,
        `git config user.name "CI Bot"`,
        `if git ls-remote --exit-code --heads origin "${VERSION_BUMP_BRANCH}" >/dev/null 2>&1; then git fetch origin main:refs/remotes/origin/main "${VERSION_BUMP_BRANCH}:${VERSION_BUMP_BRANCH}" && git checkout "${VERSION_BUMP_BRANCH}" && git rebase origin/main; else git fetch origin main:refs/remotes/origin/main && git checkout -b "${VERSION_BUMP_BRANCH}" origin/main; fi`,
        `bun run .buildkite/scripts/update-versions.ts packages/homelab/src/cdk8s/src/versions.ts "${version}" ${digestArgs}`,
        `git add packages/homelab/src/cdk8s/src/versions.ts`,
        `if git diff --cached --quiet; then HAS_VERSION_CHANGES=0; echo "No version changes to commit"; else HAS_VERSION_CHANGES=1; git commit -m "chore: bump image versions to ${version}" -m "Auto-Generated: ci-bot"; fi`,
        `if [ "$HAS_VERSION_CHANGES" = "0" ] && git diff --quiet origin/main...HEAD; then echo "No version changes and pending branch has no diff"; exit 0; fi`,
        `git push --force-with-lease -u origin "${VERSION_BUMP_BRANCH}"`,
        `PR_NUMBER=$(gh pr list --head "${VERSION_BUMP_BRANCH}" --state open --json number -q '.[0].number // empty'); if [ -z "$PR_NUMBER" ]; then gh pr create --base main --head "${VERSION_BUMP_BRANCH}" --title "chore: bump pending image versions" --body "Auto-generated version bump"; PR_NUMBER=$(gh pr view "${VERSION_BUMP_BRANCH}" --json number -q .number); fi; gh pr merge "$PR_NUMBER" --auto --merge`,
      ].join(" && "),
    ]);
}

/** Update the CI base image version pointer and create or refresh an auto-merge PR. */
export function ciBaseVersionCommitBackHelper(
  version: string,
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
      "curl",
      "ca-certificates",
    ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ])
    .withSecretVariable("GH_TOKEN", ghToken);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would update ${CI_BASE_VERSION_BUMP_BRANCH} with ci-base version ${version}`,
    ]);
  }

  return container
    .withExec([
      "sh",
      "-c",
      `printf '#!/bin/sh\\necho "$GH_TOKEN"\\n' > /usr/local/bin/git-askpass && chmod +x /usr/local/bin/git-askpass`,
    ])
    .withEnvVariable("GIT_ASKPASS", "/usr/local/bin/git-askpass")
    .withExec([
      "sh",
      "-c",
      [
        `git clone https://github.com/shepherdjerred/monorepo.git /repo`,
        `cd /repo`,
        `git config user.email "ci@sjer.red"`,
        `git config user.name "CI Bot"`,
        `if git ls-remote --exit-code --heads origin "${CI_BASE_VERSION_BUMP_BRANCH}" >/dev/null 2>&1; then git fetch origin main:refs/remotes/origin/main "${CI_BASE_VERSION_BUMP_BRANCH}:${CI_BASE_VERSION_BUMP_BRANCH}" && git checkout "${CI_BASE_VERSION_BUMP_BRANCH}" && git rebase origin/main; else git fetch origin main:refs/remotes/origin/main && git checkout -b "${CI_BASE_VERSION_BUMP_BRANCH}" origin/main; fi`,
        `printf '%s\\n' "${version}" > .buildkite/ci-image/VERSION`,
        `git add -- .buildkite/ci-image/VERSION`,
        `if git diff --cached --quiet; then HAS_VERSION_CHANGES=0; echo "No ci-base version changes to commit"; else HAS_VERSION_CHANGES=1; git commit -m "chore: bump ci-base image to ${version}" -m "Auto-Generated: ci-bot"; fi`,
        `if [ "$HAS_VERSION_CHANGES" = "0" ] && git diff --quiet origin/main...HEAD; then echo "No ci-base version changes and pending branch has no diff"; exit 0; fi`,
        `git push --force-with-lease -u origin "${CI_BASE_VERSION_BUMP_BRANCH}"`,
        `PR_NUMBER=$(gh pr list --head "${CI_BASE_VERSION_BUMP_BRANCH}" --state open --json number -q '.[0].number // empty'); if [ -z "$PR_NUMBER" ]; then gh pr create --base main --head "${CI_BASE_VERSION_BUMP_BRANCH}" --title "chore: bump ci-base image to ${version}" --body "Auto-generated ci-base version bump"; PR_NUMBER=$(gh pr view "${CI_BASE_VERSION_BUMP_BRANCH}" --json number -q .number); fi; gh pr merge "$PR_NUMBER" --auto --merge`,
      ].join(" && "),
    ]);
}

/**
 * Bump packages/cooklang-for-obsidian/manifest.json + versions.json in the
 * monorepo to track a release that was just published to the plugin repo,
 * then open or refresh an auto-merge PR. Mirrors versionCommitBackHelper.
 */
export function cooklangVersionCommitBackHelper(
  version: string,
  minAppVersion: string,
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
      "curl",
      "ca-certificates",
      "jq",
    ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ])
    .withSecretVariable("GH_TOKEN", ghToken);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would update ${COOKLANG_VERSION_BUMP_BRANCH} with cooklang plugin version ${version} (minAppVersion ${minAppVersion})`,
    ]);
  }

  return container
    .withExec([
      "sh",
      "-c",
      `printf '#!/bin/sh\\necho "$GH_TOKEN"\\n' > /usr/local/bin/git-askpass && chmod +x /usr/local/bin/git-askpass`,
    ])
    .withEnvVariable("GIT_ASKPASS", "/usr/local/bin/git-askpass")
    .withExec([
      "sh",
      "-c",
      [
        `git clone https://github.com/shepherdjerred/monorepo.git /repo`,
        `cd /repo`,
        `git config user.email "ci@sjer.red"`,
        `git config user.name "CI Bot"`,
        `if git ls-remote --exit-code --heads origin "${COOKLANG_VERSION_BUMP_BRANCH}" >/dev/null 2>&1; then git fetch origin main:refs/remotes/origin/main "${COOKLANG_VERSION_BUMP_BRANCH}:${COOKLANG_VERSION_BUMP_BRANCH}" && git checkout "${COOKLANG_VERSION_BUMP_BRANCH}" && git rebase origin/main; else git fetch origin main:refs/remotes/origin/main && git checkout -b "${COOKLANG_VERSION_BUMP_BRANCH}" origin/main; fi`,
        `jq --arg v "${version}" '.version = $v' packages/cooklang-for-obsidian/manifest.json > packages/cooklang-for-obsidian/manifest.json.tmp`,
        `mv packages/cooklang-for-obsidian/manifest.json.tmp packages/cooklang-for-obsidian/manifest.json`,
        `if [ ! -f packages/cooklang-for-obsidian/versions.json ]; then echo '{}' > packages/cooklang-for-obsidian/versions.json; fi`,
        `jq --arg v "${version}" --arg m "${minAppVersion}" '. + {($v): $m}' packages/cooklang-for-obsidian/versions.json > packages/cooklang-for-obsidian/versions.json.tmp`,
        `mv packages/cooklang-for-obsidian/versions.json.tmp packages/cooklang-for-obsidian/versions.json`,
        `git add packages/cooklang-for-obsidian/manifest.json packages/cooklang-for-obsidian/versions.json`,
        `if git diff --cached --quiet; then HAS_CHANGES=0; echo "No cooklang version changes to commit"; else HAS_CHANGES=1; git commit -m "chore(cooklang): bump to v${version}" -m "Auto-Generated: ci-bot"; fi`,
        `if [ "$HAS_CHANGES" = "0" ] && git diff --quiet origin/main...HEAD; then echo "No cooklang changes and pending branch has no diff"; exit 0; fi`,
        `git push --force-with-lease -u origin "${COOKLANG_VERSION_BUMP_BRANCH}"`,
        `PR_NUMBER=$(gh pr list --head "${COOKLANG_VERSION_BUMP_BRANCH}" --state open --json number -q '.[0].number // empty'); if [ -z "$PR_NUMBER" ]; then gh pr create --base main --head "${COOKLANG_VERSION_BUMP_BRANCH}" --title "chore(cooklang): bump plugin manifest version" --body "Auto-generated cooklang manifest version bump"; PR_NUMBER=$(gh pr view "${COOKLANG_VERSION_BUMP_BRANCH}" --json number -q .number); fi; gh pr merge "$PR_NUMBER" --auto --merge`,
      ].join(" && "),
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
