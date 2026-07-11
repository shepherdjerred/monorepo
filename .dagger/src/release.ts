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
  SOURCE_EXCLUDES,
  RELEASE_PLEASE_VERSION,
  CLAUDE_CODE_VERSION,
  GH_CLI_VERSION,
} from "./constants";

import { homelabSynthHelper } from "./homelab";
import { runBundle } from "./bundle";
import { WORKSPACE_DEPS } from "./deps";

const GITHUB_APP_TOKEN_SCRIPT = "packages/temporal/src/lib/github-app-token.ts";
const GITHUB_APP_TOKEN_SCRIPT_PATH = "/usr/local/bin/github-app-token.ts";
const MONOREPO_REPO = "shepherdjerred/monorepo";
const MONOREPO_WRITE_URL = `https://github.com/${MONOREPO_REPO}.git`;

function withAptPackages(container: Container, packages: string[]): Container {
  const packageList = packages.join(" ");
  return container.withExec([
    "sh",
    "-c",
    `apt-get update -qq && apt-get install -y -qq --no-install-recommends ${packageList} && rm -rf /var/lib/apt/lists/*`,
  ]);
}

/**
 * Inject the github-app-token mint script + the secret env vars needed to
 * run it. The actual mint happens inline in each caller's withExec via
 * `mintGithubAppTokenAndSetupGitAuth()`. A separate mint `withExec` would
 * be cached across builds (its inputs — script file + secret digests — are
 * stable), and GitHub App installation tokens expire after ~1 hour, so the
 * next build would receive an expired token. Inlining the mint into the
 * caller's exec means the cache key picks up the caller's per-build inputs
 * (version string, digests, etc.) and forces a fresh mint each build.
 */
function withGithubAppCredentials(
  container: Container,
  source: Directory,
  githubAppId: Secret,
  githubAppInstallationId: Secret,
  githubAppPrivateKey: Secret,
): Container {
  return container
    .withFile(
      GITHUB_APP_TOKEN_SCRIPT_PATH,
      source.file(GITHUB_APP_TOKEN_SCRIPT),
    )
    .withSecretVariable("GITHUB_APP_ID", githubAppId)
    .withSecretVariable("GITHUB_APP_INSTALLATION_ID", githubAppInstallationId)
    .withSecretVariable("GITHUB_APP_PRIVATE_KEY", githubAppPrivateKey);
}

/**
 * Mint a fresh GitHub App installation token, write a git-askpass helper,
 * and export `GIT_ASKPASS` + `GH_TOKEN` for the current shell. Returns a
 * `&&`-chained command suitable for prepending to the caller's git ops.
 *
 * The minted token lives only in the `GH_TOKEN` environment variable; it is
 * never persisted to disk. The askpass helper script is plain shell text, and
 * at git's invocation time the askpass subprocess inherits `GH_TOKEN` from the
 * parent shell. It returns GitHub's expected token username for username
 * prompts and `GH_TOKEN` for password prompts. Git callers should use plain
 * HTTPS URLs so credentials never appear in URLs.
 *
 * Includes a one-line diagnostic so any future "No anonymous write access"
 * or "Bad credentials" failure is debuggable from the CI log without
 * leaking token contents — prints askpass perms/owner/size, GIT_ASKPASS
 * value, and the token's byte length (computed from `$GH_TOKEN`, not a
 * file).
 *
 * Set `withAskpass=false` for callers that pass the token explicitly
 * (e.g. release-please via `--token`) and don't need git's askpass dance.
 */
function mintGithubAppTokenAndSetupGitAuth(
  opts: { withAskpass?: boolean } = {},
): string {
  const withAskpass = opts.withAskpass ?? true;
  const steps = [
    `export GH_TOKEN="$(bun ${GITHUB_APP_TOKEN_SCRIPT_PATH})"`,
    `test -n "$GH_TOKEN" || { echo "ERROR: GH_TOKEN is empty after mint" >&2; exit 1; }`,
  ];
  if (withAskpass) {
    steps.push(
      `printf '%s\\n' '#!/bin/sh' 'case "$1" in' '  *Username*) printf "%s%s%s\\\\n" "x-access" "-" "token" ;;' '  *) printf "%s\\\\n" "$GH_TOKEN" ;;' 'esac' > /usr/local/bin/git-askpass`,
      `chmod +x /usr/local/bin/git-askpass`,
      `export GIT_ASKPASS=/usr/local/bin/git-askpass`,
      `echo "git-auth-setup: $(ls -l /usr/local/bin/git-askpass | awk '{print $1, $3, $5}'), GIT_ASKPASS=$GIT_ASKPASS, token-bytes=$(printf %s \"$GH_TOKEN\" | wc -c)"`,
    );
  } else {
    steps.push(
      `echo "git-auth-setup: token-bytes=$(printf %s \"$GH_TOKEN\" | wc -c) (no askpass)"`,
    );
  }
  return steps.join(" && ");
}

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

/**
 * Synth cdk8s manifests once and package + push every Helm chart in parallel.
 * Replaces the per-chart `helm-synth-and-package` BK step explosion (28 pods
 * each ~25 s, dominated by sidecar overhead) with one pod whose engine-side
 * graph forks per chart after the shared `homelabSynthHelper` call. The synth
 * Directory is content-addressed, so all charts share one synth run.
 */
export async function helmPushAllHelper(
  source: Directory,
  synthPkgDir: Directory,
  synthDepNames: string[],
  synthDepDirs: Directory[],
  tsconfig: File | null,
  chartNames: string[],
  version: string,
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
  dryrun: boolean,
): Promise<string> {
  const cdk8sDist = homelabSynthHelper(
    synthPkgDir,
    synthDepNames,
    synthDepDirs,
    tsconfig,
  );
  return runBundle(
    chartNames.map((chart) => ({
      name: chart,
      run: () =>
        helmPackageHelper(
          source,
          cdk8sDist,
          chart,
          version,
          chartMuseumUsername,
          chartMuseumPassword,
          dryrun,
        ).stdout(),
    })),
  );
}

// ---------------------------------------------------------------------------
// OpenTofu
// ---------------------------------------------------------------------------

/**
 * `tofu init -input=false` wrapped in a bounded retry loop. `tofu init`
 * itself only retries provider registry lookups twice before giving up; a
 * single slow GitHub release CDN response (which is where OpenTofu fetches
 * the provider SHA256SUMS from) is enough to fail the whole apply. Retry up
 * to 5 attempts with linear backoff before propagating the failure.
 *
 * Build #4330's tailscale-acl apply failed on exactly this:
 *   "Get https://github.com/tailscale/terraform-provider-tailscale/releases/download/v0.29.2/.../SHA256SUMS: context deadline exceeded"
 */
const TOFU_INIT_WITH_RETRY = [
  "i=1",
  "while [ $i -le 5 ]; do",
  "  if tofu init -input=false; then exit 0; fi",
  // Skip the sleep + "retrying" log on the final attempt — no retry follows.
  "  if [ $i -lt 5 ]; then",
  '    echo "tofu init failed (attempt $i/5), retrying in $((i*5))s..." >&2',
  "    sleep $((i*5))",
  "  fi",
  "  i=$((i+1))",
  "done",
  "exit 1",
  // Join with newlines, not "; " — busybox sh rejects `do ;` / `then ;` / `done ;`.
].join("\n");

/** Run tofu init + apply on a stack. */
export function tofuApplyHelper(
  source: Directory,
  stack: string,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  githubToken: Secret | null = null,
  cloudflareAccountId: Secret | null = null,
  cloudflareApiToken: Secret | null = null,
  tailscaleOauthClientId: Secret | null = null,
  tailscaleOauthClientSecret: Secret | null = null,
  buildkiteApiToken: Secret | null = null,
  radarrApiKey: Secret | null = null,
  sonarrApiKey: Secret | null = null,
  prowlarrApiKey: Secret | null = null,
  qbittorrentPassword: Secret | null = null,
  privatehdPassword: Secret | null = null,
  privatehdPid: Secret | null = null,
  pagerdutyToken: Secret | null = null,
  dryrun = false,
): Container {
  let container = dag.container().from(TOFU_IMAGE);

  // The seaweedfs stack uses `local-exec` provisioners that shell out to the
  // AWS CLI (S3 bucket lifecycle config + object seeding against SeaweedFS's S3
  // gateway — see packages/homelab/src/tofu/seaweedfs/buckets.tf). The base
  // OpenTofu image ships only `tofu`, so the CLI must be installed for apply to
  // succeed. Done before mounting the source so the layer caches independently.
  if (stack === "seaweedfs") {
    container = container
      .withExec(["apk", "add", "--no-cache", "aws-cli"])
      // SeaweedFS S3 requires s3v4 signing; pin the region to avoid mismatches
      // with newer AWS CLI versions that use CRT-based signing. The
      // WHEN_REQUIRED checksum settings suppress the checksum headers AWS CLI
      // v2 sends by default but SeaweedFS does not understand — without them the
      // local-exec `s3api`/`s3 cp` calls fail. Matches deploySiteHelper and
      // deployStaticSiteHelper below.
      .withEnvVariable("AWS_DEFAULT_REGION", "us-east-1")
      .withEnvVariable("AWS_REQUEST_CHECKSUM_CALCULATION", "WHEN_REQUIRED")
      .withEnvVariable("AWS_RESPONSE_CHECKSUM_VALIDATION", "WHEN_REQUIRED");
  }

  container = container
    .withWorkdir("/workspace")
    .withDirectory(
      "/workspace",
      source.directory(`packages/homelab/src/tofu/${stack}`),
    )
    .withSecretVariable("AWS_ACCESS_KEY_ID", awsAccessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey);

  if (githubToken != null) {
    container = container.withSecretVariable(
      "TF_VAR_github_token",
      githubToken,
    );
  }

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

  if (tailscaleOauthClientId != null) {
    container = container.withSecretVariable(
      "TAILSCALE_OAUTH_CLIENT_ID",
      tailscaleOauthClientId,
    );
  }

  if (tailscaleOauthClientSecret != null) {
    container = container.withSecretVariable(
      "TAILSCALE_OAUTH_CLIENT_SECRET",
      tailscaleOauthClientSecret,
    );
  }

  if (buildkiteApiToken != null) {
    container = container.withSecretVariable(
      "TF_VAR_buildkite_api_token",
      buildkiteApiToken,
    );
  }

  if (radarrApiKey != null) {
    container = container.withSecretVariable(
      "TF_VAR_radarr_api_key",
      radarrApiKey,
    );
  }
  if (sonarrApiKey != null) {
    container = container.withSecretVariable(
      "TF_VAR_sonarr_api_key",
      sonarrApiKey,
    );
  }
  if (prowlarrApiKey != null) {
    container = container.withSecretVariable(
      "TF_VAR_prowlarr_api_key",
      prowlarrApiKey,
    );
  }
  if (qbittorrentPassword != null) {
    container = container.withSecretVariable(
      "TF_VAR_qbittorrent_password",
      qbittorrentPassword,
    );
  }
  if (privatehdPassword != null) {
    container = container.withSecretVariable(
      "TF_VAR_privatehd_password",
      privatehdPassword,
    );
  }
  if (privatehdPid != null) {
    container = container.withSecretVariable(
      "TF_VAR_privatehd_pid",
      privatehdPid,
    );
  }

  if (pagerdutyToken != null) {
    container = container.withSecretVariable(
      "TF_VAR_pagerduty_token",
      pagerdutyToken,
    );
  }

  container = container.withExec(["sh", "-c", TOFU_INIT_WITH_RETRY]);

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
  githubToken: Secret | null = null,
  cloudflareAccountId: Secret | null = null,
  cloudflareApiToken: Secret | null = null,
  tailscaleOauthClientId: Secret | null = null,
  tailscaleOauthClientSecret: Secret | null = null,
  buildkiteApiToken: Secret | null = null,
  radarrApiKey: Secret | null = null,
  sonarrApiKey: Secret | null = null,
  prowlarrApiKey: Secret | null = null,
  qbittorrentPassword: Secret | null = null,
  privatehdPassword: Secret | null = null,
  privatehdPid: Secret | null = null,
  pagerdutyToken: Secret | null = null,
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
    .withSecretVariable("AWS_SECRET_ACCESS_KEY", awsSecretAccessKey);

  if (githubToken != null) {
    container = container.withSecretVariable(
      "TF_VAR_github_token",
      githubToken,
    );
  }

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

  if (tailscaleOauthClientId != null) {
    container = container.withSecretVariable(
      "TAILSCALE_OAUTH_CLIENT_ID",
      tailscaleOauthClientId,
    );
  }

  if (tailscaleOauthClientSecret != null) {
    container = container.withSecretVariable(
      "TAILSCALE_OAUTH_CLIENT_SECRET",
      tailscaleOauthClientSecret,
    );
  }

  if (buildkiteApiToken != null) {
    container = container.withSecretVariable(
      "TF_VAR_buildkite_api_token",
      buildkiteApiToken,
    );
  }

  if (radarrApiKey != null) {
    container = container.withSecretVariable(
      "TF_VAR_radarr_api_key",
      radarrApiKey,
    );
  }
  if (sonarrApiKey != null) {
    container = container.withSecretVariable(
      "TF_VAR_sonarr_api_key",
      sonarrApiKey,
    );
  }
  if (prowlarrApiKey != null) {
    container = container.withSecretVariable(
      "TF_VAR_prowlarr_api_key",
      prowlarrApiKey,
    );
  }
  if (qbittorrentPassword != null) {
    container = container.withSecretVariable(
      "TF_VAR_qbittorrent_password",
      qbittorrentPassword,
    );
  }
  if (privatehdPassword != null) {
    container = container.withSecretVariable(
      "TF_VAR_privatehd_password",
      privatehdPassword,
    );
  }
  if (privatehdPid != null) {
    container = container.withSecretVariable(
      "TF_VAR_privatehd_pid",
      privatehdPid,
    );
  }

  if (pagerdutyToken != null) {
    container = container.withSecretVariable(
      "TF_VAR_pagerduty_token",
      pagerdutyToken,
    );
  }

  container = container.withExec(["sh", "-c", TOFU_INIT_WITH_RETRY]);

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

/**
 * Apply every OpenTofu stack in parallel from one pod. Each stack writes to
 * its own backend (separate S3 prefix per stack), so parallel applies are
 * safe — the prior per-stack BK `concurrency: 1` only serialised against
 * other branches touching the SAME stack, which Tofu's S3 backend already
 * handles via state lock. Stack-irrelevant secrets (cloudflare-api-token
 * on the github stack etc.) are passed but ignored by the underlying
 * helper's conditional `withSecretVariable` checks.
 */
export async function tofuApplyAllHelper(
  source: Directory,
  stacks: string[],
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  githubToken: Secret | null,
  cloudflareAccountId: Secret | null,
  cloudflareApiToken: Secret | null,
  tailscaleOauthClientId: Secret | null,
  tailscaleOauthClientSecret: Secret | null,
  buildkiteApiToken: Secret | null,
  radarrApiKey: Secret | null,
  sonarrApiKey: Secret | null,
  prowlarrApiKey: Secret | null,
  qbittorrentPassword: Secret | null,
  privatehdPassword: Secret | null,
  privatehdPid: Secret | null,
  pagerdutyToken: Secret | null,
  dryrun: boolean,
): Promise<string> {
  return runBundle(
    stacks.map((stack) => ({
      name: stack,
      run: () =>
        tofuApplyHelper(
          source,
          stack,
          awsAccessKeyId,
          awsSecretAccessKey,
          githubToken,
          cloudflareAccountId,
          cloudflareApiToken,
          tailscaleOauthClientId,
          tailscaleOauthClientSecret,
          buildkiteApiToken,
          radarrApiKey,
          sonarrApiKey,
          prowlarrApiKey,
          qbittorrentPassword,
          privatehdPassword,
          privatehdPid,
          pagerdutyToken,
          dryrun,
        ).stdout(),
    })),
  );
}

/**
 * Plan every OpenTofu stack in parallel from one pod. Read-only; safe to run
 * concurrent against any other branch.
 */
export async function tofuPlanAllHelper(
  source: Directory,
  stacks: string[],
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  githubToken: Secret | null,
  cloudflareAccountId: Secret | null,
  cloudflareApiToken: Secret | null,
  tailscaleOauthClientId: Secret | null,
  tailscaleOauthClientSecret: Secret | null,
  buildkiteApiToken: Secret | null,
  radarrApiKey: Secret | null,
  sonarrApiKey: Secret | null,
  prowlarrApiKey: Secret | null,
  qbittorrentPassword: Secret | null,
  privatehdPassword: Secret | null,
  privatehdPid: Secret | null,
  pagerdutyToken: Secret | null,
  dryrun: boolean,
): Promise<string> {
  return runBundle(
    stacks.map((stack) => ({
      name: stack,
      run: () =>
        tofuPlanHelper(
          source,
          stack,
          awsAccessKeyId,
          awsSecretAccessKey,
          githubToken,
          cloudflareAccountId,
          cloudflareApiToken,
          tailscaleOauthClientId,
          tailscaleOauthClientSecret,
          buildkiteApiToken,
          radarrApiKey,
          sonarrApiKey,
          prowlarrApiKey,
          qbittorrentPassword,
          privatehdPassword,
          privatehdPid,
          pagerdutyToken,
          dryrun,
        ).stdout(),
    })),
  );
}

// ---------------------------------------------------------------------------
// NPM publish
// ---------------------------------------------------------------------------

/**
 * Publish every npm package in parallel from one pod. All packages in a
 * single call share the same `devSuffix` — pass the build number for dev
 * publishes, leave empty for the prod (release-please merge) tag. Per-package
 * deps come from `WORKSPACE_DEPS`.
 */
export async function npmPublishAllHelper(
  source: Directory,
  pkgs: string[],
  pkgPaths: string[],
  npmToken: Secret,
  tsconfig: File | null,
  devSuffix: string,
  dryrun: boolean,
): Promise<string> {
  if (pkgs.length !== pkgPaths.length) {
    throw new Error(
      "npmPublishAllHelper: pkgs/pkgPaths array length mismatch " +
        `(${pkgs.length.toString()} vs ${pkgPaths.length.toString()})`,
    );
  }
  return runBundle(
    pkgs.map((pkg, i) => {
      const pkgPath = pkgPaths[i] ?? pkg;
      return {
        name: pkg,
        run: () => {
          const deps = WORKSPACE_DEPS[pkgPath] ?? [];
          const depDirs = deps.map((d) => source.directory(`packages/${d}`));
          return publishNpmHelper(
            source.directory(`packages/${pkgPath}`),
            pkg,
            npmToken,
            deps,
            depDirs,
            dryrun,
            tsconfig,
            devSuffix,
            pkgPath,
          ).stdout();
        },
      };
    }),
  );
}

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
  pkgPath: string = "",
): Container {
  // pkgPath is the on-disk path under packages/ (e.g. "homelab/src/helm-types"
  // for @shepherdjerred/helm-types). Mounting at the real on-disk path is
  // required so that `file:` workspace deps in package.json resolve correctly
  // — file: refs are written relative to the source-tree layout, not the npm
  // package name. Default to `pkg` for top-level unscoped packages where the
  // name and directory coincide (e.g. webring, astro-opengraph-images).
  const mountPath = pkgPath !== "" ? pkgPath : pkg;

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir(`/workspace/packages/${mountPath}`)
    .withDirectory(`/workspace/packages/${mountPath}`, pkgDir, {
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

  container = container.withWorkdir(`/workspace/packages/${mountPath}`);

  // Replace file: refs with actual versions before publishing
  container = container.withExec([
    "sh",
    "-c",
    [
      `cd /workspace/packages/${mountPath}`,
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

  // Write a STATIC .npmrc whose `_authToken` value is a literal `${NPM_TOKEN}`
  // — bun substitutes the env var at .npmrc-parse time, so the secret bytes
  // never touch the filesystem (this avoids the ".dagger/src/** must not write
  // tokens to files" rule). bun publish has no --token flag, and npm-style
  // env vars like `NPM_CONFIG_//registry.npmjs.org/:_authToken` contain `/`s
  // and aren't valid POSIX env var names, so this is the cleanest path.
  //
  // Precheck: if NPM_TOKEN doesn't bypass 2FA, bun publish silently falls into
  // npm's interactive web-auth flow and hangs ~5 minutes per package per build.
  // Detect this up-front via /-/npm/v1/tokens (paginated; some accounts have
  // dozens of tokens) and fail fast with an actionable message before bun gets
  // a chance to wait.
  return container
    .withSecretVariable("NPM_TOKEN", npmToken)
    .withExec([
      "sh",
      "-c",
      [
        `printf '%s\\n' '//registry.npmjs.org/:_authToken=\${NPM_TOKEN}' > .npmrc`,
        `bun -e 'const token=process.env.NPM_TOKEN; if(!token){console.error("NPM_TOKEN is empty"); process.exit(1);} let url="https://registry.npmjs.org/-/npm/v1/tokens"; let me=null; let pages=0; while(url&&!me){pages++; const r=await fetch(url,{headers:{Authorization:\`Bearer \${token}\`}}); if(!r.ok){console.error(\`npm token introspection failed (page \${pages}): HTTP \${r.status} \${r.statusText}\`); process.exit(1);} const data=await r.json(); me=data.objects?.find(o=>{const parts=(o.token||"").split("..."); if(parts.length!==2) return false; const [pre,suf]=parts; return token.startsWith(pre)&&token.endsWith(suf);}); url=data.urls?.next?(data.urls.next.startsWith("http")?data.urls.next:\`https://registry.npmjs.org\${data.urls.next}\`):null;} if(!me){console.error(\`Current NPM_TOKEN not found across \${pages} page(s) of /-/npm/v1/tokens — token may be revoked, or the registry truncated/changed its response shape\`); process.exit(1);} if(!me.bypass_2fa){console.error("ERROR: NPM_TOKEN does not bypass 2FA. bun publish will hang on npm interactive web-auth fallback in CI. Rotate to a granular token with bypass-2FA enabled: sign in to npmjs.com with a WebAuthn passkey in the same session (TOTP alone leaves the bypass-2FA checkbox disabled per npm policy since 2026-05), then mint at https://www.npmjs.com/settings/<user>/tokens/new. Classic Automation tokens were retired by npm in 2025."); process.exit(1);} console.log(\`OK: NPM_TOKEN bypasses 2FA (token name: \${me.name}, found on page \${pages})\`);'`,
        `bun publish --access public --tag ${tag} --tolerate-republish`,
      ].join(" && "),
    ]);
}

// ---------------------------------------------------------------------------
// Site deploy (S3 / R2)
// ---------------------------------------------------------------------------

/** Build and deploy a static site to S3 (SeaweedFS) or R2 (Cloudflare). */
/**
 * Append the static-site upload to `container` as a two-pass `aws s3 sync`,
 * setting `Cache-Control` as S3 object metadata (caddy-s3-proxy passes it
 * through to the browser/CDN unchanged).
 *
 * Pass 1 uploads content-hashed/fingerprinted assets — the `immutablePrefixes`
 * (e.g. `_astro/`, `app/assets/`) — with a 1-year `immutable` Cache-Control and
 * WITHOUT `--delete`, so prior builds' hashed files survive for already-loaded
 * tabs (a deploy mid-session must not 404 a still-referenced chunk). Old hashes
 * are pruned later by the SeaweedFS bucket-lifecycle rule, not on every deploy.
 *
 * Pass 2 uploads everything else with `Cache-Control: no-cache` (mutable shells,
 * favicons, … — always revalidated so deploys take effect immediately) and
 * `--delete`. The hashed prefixes are `--exclude`d; `aws s3 sync --delete` never
 * deletes excluded keys, so the retained old hashed assets are left in place.
 *
 * When `immutablePrefixes` is empty (a site with no fingerprinted assets) a
 * single `no-cache` + `--delete` pass is used.
 */
function s3SyncStaticSite(
  container: Container,
  source: string,
  bucket: string,
  endpoint: string,
  immutablePrefixes: string[],
  dryrun: boolean,
): Container {
  const dest = `s3://${bucket}/`;

  if (dryrun) {
    const plan =
      immutablePrefixes.length > 0
        ? `pass 1 [${immutablePrefixes.join(", ")}] immutable (no --delete); pass 2 everything else no-cache (--delete)`
        : `single pass no-cache (--delete)`;
    return container.withExec([
      "echo",
      `DRYRUN: would sync ${source} to ${dest} via ${endpoint} — ${plan}`,
    ]);
  }

  let result = container;
  if (immutablePrefixes.length > 0) {
    const includeFlags = immutablePrefixes.flatMap((prefix) => [
      "--include",
      `${prefix}*`,
    ]);
    result = result.withExec([
      "aws",
      "s3",
      "sync",
      source,
      dest,
      "--endpoint-url",
      endpoint,
      "--exclude",
      "*",
      ...includeFlags,
      "--cache-control",
      "public, max-age=31536000, immutable",
    ]);
  }

  const excludeFlags = immutablePrefixes.flatMap((prefix) => [
    "--exclude",
    `${prefix}*`,
  ]);
  return result.withExec([
    "aws",
    "s3",
    "sync",
    source,
    dest,
    "--endpoint-url",
    endpoint,
    ...excludeFlags,
    "--cache-control",
    "no-cache",
    "--delete",
  ]);
}

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
  buildEnvNames: string[] = [],
  buildEnvValues: Secret[] = [],
  dryrun = false,
  tsconfig: File | null = null,
  needsPlaywright = false,
  immutablePrefixes: string[] = [],
): Container {
  if (buildEnvNames.length !== buildEnvValues.length) {
    throw new Error(
      `Expected ${buildEnvNames.length} build env secret values, received ${buildEnvValues.length}`,
    );
  }

  let container = withAptPackages(dag.container().from(BUN_IMAGE), ["awscli"])
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

  // Build workspace deps that need compilation (e.g. astro-opengraph-images,
  // llm-models) BEFORE installing the site itself. Nested-workspace sites
  // (e.g. scout-for-lol) COPY their file: deps into node_modules at install
  // time instead of symlinking, so a dep's dist/ must already exist on disk
  // when the site is installed — otherwise the copied dep is dist-less and the
  // site's bundler fails with "Failed to resolve entry for package ...".
  // Symlinked sites see the dist/ regardless of order, so building first is
  // safe for every site. Skip source-only library deps that consumers resolve
  // via package exports directly — they don't ship a dist/.
  const SKIP_BUILD_DEPS: ReadonlySet<string> = new Set([
    "eslint-config",
    "llm-observability",
  ]);
  const buildDeps = depNames.filter((d) => !SKIP_BUILD_DEPS.has(d));
  for (const dep of buildDeps) {
    container = container
      .withWorkdir(`/workspace/packages/${dep}`)
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withExec(["bun", "run", "build"]);
  }

  // Install the site last, with workdir reset to the deployed package (the
  // build-deps loop left us in the last dep's directory). The install now
  // copies/links the already-built deps, so their dist/ is present for the
  // site's bundler.
  container = container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "install", "--frozen-lockfile"]);

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

  for (let i = 0; i < buildEnvNames.length; i++) {
    const name = buildEnvNames[i];
    const value = buildEnvValues[i];
    if (name === "" || value == null) {
      throw new Error(`Invalid build env secret at index ${i}`);
    }
    container = container.withSecretVariable(name, value);
  }

  if (buildCmd) {
    container = container.withExec(["sh", "-c", buildCmd]);
  }

  const endpoint =
    target === "r2"
      ? `https://${cloudflareAccountId}.r2.cloudflarestorage.com`
      : "https://seaweedfs-s3.tailnet-1a49.ts.net";

  return s3SyncStaticSite(
    container,
    distSubdir,
    bucket,
    endpoint,
    immutablePrefixes,
    dryrun,
  );
}

/** Deploy a pre-built static site directory to S3. No bun install or build step. */
export function deployStaticSiteHelper(
  siteDir: Directory,
  bucket: string,
  target: string,
  awsAccessKeyId: Secret,
  awsSecretAccessKey: Secret,
  dryrun = false,
  immutablePrefixes: string[] = [],
): Container {
  const endpoint =
    target === "r2"
      ? "https://r2.cloudflarestorage.com"
      : "https://seaweedfs-s3.tailnet-1a49.ts.net";

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

  return s3SyncStaticSite(
    container,
    ".",
    bucket,
    endpoint,
    immutablePrefixes,
    dryrun,
  );
}

// ---------------------------------------------------------------------------
// ArgoCD
// ---------------------------------------------------------------------------

/**
 * Poll ArgoCD's application resource tree until no resource matching the
 * given group/version/kind/namespace remains (i.e. the finalizer has run and
 * the K8s object is gone). Use this after a sync that prunes a resource with
 * a finalizer to confirm the finalizer has completed before downstream steps
 * that depend on the resource being gone.
 *
 * Filters by group/version/kind/namespace rather than an exact resource name:
 * cdk8s ApiObjects without an explicit `metadata.name` get a hash-suffixed
 * name from `Names.toDnsLabel` (id + `-<addr-hash>`) once nested under a
 * Chart, so a name guessed from the construct id would not match the live
 * object and this gate would 404 (treat it as already deleted) while the
 * resource — and its finalizer — is still there.
 */
export function waitForArgoCdResourceDeletionHelper(
  appName: string,
  group: string,
  version: string,
  kind: string,
  namespace: string,
  argoCdToken: Secret,
  timeoutSeconds: number = 120,
  serverUrl: string = "https://argocd.sjer.red",
  dryrun = false,
): Container {
  const label = `${kind} (group=${group}, ns=${namespace})`;
  if (dryrun) {
    return dag
      .container()
      .from(ALPINE_IMAGE)
      .withExec([
        "echo",
        `DRYRUN: would wait for all ${label} to be deleted from ArgoCD app ${appName}`,
      ]);
  }
  // NOTE: The URL is constructed in TypeScript and embedded as a literal in the
  // shell script to avoid shell quoting issues with query string parameters.
  const appUrl = `${serverUrl}/api/v1/applications/${appName}`;
  return dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec(["apk", "add", "--no-cache", "curl", "jq"])
    .withSecretVariable("ARGOCD_TOKEN", argoCdToken)
    .withExec([
      "sh",
      "-c",
      `set -eu
elapsed=0
while [ "$elapsed" -lt ${timeoutSeconds} ]; do
  http=$(curl -sS -L --max-redirs 3 -o /tmp/argocd-resp -w '%{http_code}' \\
    -H "Authorization: Bearer $ARGOCD_TOKEN" \\
    "${appUrl}")
  if [ "$http" != "200" ]; then
    echo "ERROR: ${appUrl} returned HTTP $http"
    if [ -s /tmp/argocd-resp ]; then
      echo "Response body (first 1KB):"
      head -c 1024 /tmp/argocd-resp
      echo
    fi
    exit 1
  fi
  remaining=$(jq -r \\
    '[.status.resources[]? | select(.group == "${group}" and .version == "${version}" and .kind == "${kind}" and .namespace == "${namespace}")] | length' \\
    /tmp/argocd-resp)
  echo "${label}: $remaining remaining ($elapsed/${timeoutSeconds}s)"
  if [ "$remaining" = "0" ]; then
    echo "${label} is fully deleted."
    exit 0
  fi
  sleep 10
  elapsed=$((elapsed + 10))
done
echo "Timeout: ${label} was not fully deleted within ${timeoutSeconds}s"
exit 1`,
    ]);
}

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
  // Use -sS (not -sf) so non-2xx responses surface as a status code + body
  // rather than silently producing empty output for jq to choke on. -L
  // follows redirects (one-hop trust; the previous bare `curl -sf` swallowed
  // a 307 redirect-loop into an "Invalid numeric literal" jq error and timed
  // out for 5 minutes). Fail fast on any non-200 since auth/ingress errors
  // are not transient and looping wastes CI time.
  return dag
    .container()
    .from(ALPINE_IMAGE)
    .withExec(["apk", "add", "--no-cache", "curl", "jq"])
    .withSecretVariable("ARGOCD_TOKEN", argoCdToken)
    .withExec([
      "sh",
      "-c",
      `set -eu
elapsed=0
while [ "$elapsed" -lt ${timeoutSeconds} ]; do
  http=$(curl -sS -L --max-redirs 3 -o /tmp/argocd-resp -w '%{http_code}' \
    -H "Authorization: Bearer $ARGOCD_TOKEN" \
    "${serverUrl}/api/v1/applications/${appName}")
  if [ "$http" != "200" ]; then
    echo "ERROR: ${serverUrl}/api/v1/applications/${appName} returned HTTP $http"
    if [ -s /tmp/argocd-resp ]; then
      echo "Response body (first 1KB):"
      head -c 1024 /tmp/argocd-resp
      echo
    fi
    exit 1
  fi
  status=$(jq -r '.status.health.status' /tmp/argocd-resp)
  echo "Health: $status ($elapsed/${timeoutSeconds}s)"
  [ "$status" = "Healthy" ] && exit 0
  sleep 10
  elapsed=$((elapsed + 10))
done
echo "Timeout: ${appName} did not become Healthy within ${timeoutSeconds}s"
exit 1`,
    ]);
}

/**
 * Sync ArgoCD and then poll for healthy state in one pod. Sync failure
 * throws (BK step turns red); health-wait failure is caught and reported
 * inline — matches the wave-1 split where `argocd-health` was BK
 * `soft_fail: true`. The bundle step keeps sync's concurrency_group at the
 * BK layer because applies can race across branches.
 */
export async function argoCdSyncAndWaitHelper(
  appName: string,
  argoCdToken: Secret,
  timeoutSeconds: number,
  serverUrl: string,
  dryrun: boolean,
): Promise<string> {
  const syncOut = await argoCdSyncHelper(
    appName,
    argoCdToken,
    serverUrl,
    dryrun,
  ).stdout();
  let healthOut: string;
  try {
    healthOut = await argoCdHealthWaitHelper(
      appName,
      argoCdToken,
      timeoutSeconds,
      serverUrl,
      dryrun,
    ).stdout();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    healthOut = `+++ :warning: health-wait failed (soft-fail): ${msg}`;
  }
  return [
    `--- :argocd: sync (${appName})`,
    syncOut,
    `--- :heart: health-wait (${appName})`,
    healthOut,
  ].join("\n");
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

const GITHUB_REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function validateGitHubRepoSlug(repo: string, label: string): string {
  if (!GITHUB_REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(`${label} must be a GitHub owner/repo slug`);
  }
  return repo;
}

/**
 * Publish cooklang plugin artifacts to the external plugin repository.
 *
 * Determines the next semver patch from the latest release tag (or the
 * built manifest's version if no releases exist), rewrites
 * artifacts/manifest.json with the new version, commits the three plugin
 * files to the plugin repo's main branch, updates versions.json only when
 * the release changes the Obsidian compatibility boundary, and cuts a GitHub
 * release tagged with the bare version (Obsidian directory convention).
 *
 * Emits the new version as the final line on stdout so callers can chain
 * a commit-back step.
 */
export function cooklangPublishHelper(
  artifacts: Directory,
  tokenSource: Directory,
  pluginRepo: string,
  githubAppId: Secret,
  githubAppInstallationId: Secret,
  githubAppPrivateKey: Secret,
  dryrun = false,
): Container {
  const cooklangPluginRepo = validateGitHubRepoSlug(pluginRepo, "pluginRepo");
  const container = withAptPackages(dag.container().from(BUN_IMAGE), [
    "curl",
    "git",
    "jq",
    "ca-certificates",
  ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ])
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts", artifacts);

  if (dryrun) {
    return withGithubAppCredentials(
      container,
      tokenSource,
      githubAppId,
      githubAppInstallationId,
      githubAppPrivateKey,
    ).withExec([
      "sh",
      "-c",
      [
        `set -eu`,
        mintGithubAppTokenAndSetupGitAuth({ withAskpass: false }),
        `latest=$(gh release list --repo ${cooklangPluginRepo} --limit 50 --json tagName --jq '.[].tagName' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1)`,
        `base="\${latest:-$(jq -r .version /artifacts/manifest.json)}"`,
        `major=$(echo "$base" | cut -d. -f1)`,
        `minor=$(echo "$base" | cut -d. -f2)`,
        `patch=$(echo "$base" | cut -d. -f3)`,
        `new="$major.$minor.$((patch + 1))"`,
        `echo "DRYRUN: cooklang plugin $base -> $new (would commit + release on ${cooklangPluginRepo})"`,
        `echo "$new"`,
      ].join(" && "),
    ]);
  }

  const authedContainer = withGithubAppCredentials(
    container,
    tokenSource,
    githubAppId,
    githubAppInstallationId,
    githubAppPrivateKey,
  );

  return authedContainer.withExec([
    "sh",
    "-c",
    [
      `set -eu`,
      `export GIT_TERMINAL_PROMPT=0`,
      mintGithubAppTokenAndSetupGitAuth(),
      // Clone plugin repo
      `git clone https://github.com/${cooklangPluginRepo}.git /repo`,
      `cd /repo`,
      `git config user.email "ci@sjer.red"`,
      `git config user.name "CI Bot"`,
      // Compute next version: latest semver release tag + 1 patch, fallback to artifacts manifest
      `latest=$(gh release list --repo ${cooklangPluginRepo} --limit 50 --json tagName --jq '.[].tagName' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1)`,
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
      // Copy artifacts to repo + update versions.json only for compatibility boundary changes
      `cp /artifacts/main.js /artifacts/manifest.json /artifacts/styles.css /repo/`,
      `if [ ! -s /repo/versions.json ]; then echo '{}' > /repo/versions.json; fi`,
      `latest_min=$(jq -r 'to_entries | map(select(.key | test("^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$"))) | sort_by(.key | split(".") | map(tonumber)) | (last // {"value": ""}) | .value' /repo/versions.json)`,
      `if [ -z "$latest_min" ] || [ "$latest_min" != "$min" ]; then jq --arg v "$new" --arg m "$min" '.[$v] = $m' /repo/versions.json > /repo/versions.json.tmp && mv /repo/versions.json.tmp /repo/versions.json && git -C /repo add versions.json; else echo "versions.json compatibility boundary unchanged ($min)"; fi`,
      // Commit + push to plugin repo main
      `git -C /repo add main.js manifest.json styles.css`,
      `if git -C /repo diff --cached --quiet; then echo "No artifact changes to commit"; else git -C /repo commit -m "release: v$new" -m "Auto-Generated: ci-bot"; git -C /repo push origin HEAD:main; fi`,
      // Create the GitHub release on the plugin repo (idempotent: skip if tag already exists)
      `if gh release view "$new" --repo ${cooklangPluginRepo} >/dev/null; then echo "Release $new already exists on ${cooklangPluginRepo}, skipping"; else gh release create "$new" /artifacts/main.js /artifacts/manifest.json /artifacts/styles.css --repo ${cooklangPluginRepo} --title "v$new" --generate-notes; fi`,
      // Last line of stdout = new version, for callers
      `printf '%s\\n' "$new"`,
    ].join(" && "),
  ]);
}

// Version commit-back
// ---------------------------------------------------------------------------

const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const CI_BASE_VERSION_BUMP_BRANCH = "chore/ci-base-version-bump-pending";
const COOKLANG_VERSION_BUMP_BRANCH = "chore/cooklang-version-bump-pending";

/** Update versions.ts with new image digests and create or refresh an auto-merge PR. */
export function versionCommitBackHelper(
  source: Directory,
  digests: string,
  version: string,
  githubAppId: Secret,
  githubAppInstallationId: Secret,
  githubAppPrivateKey: Secret,
  dryrun = false,
): Container {
  const container = withAptPackages(dag.container().from(BUN_IMAGE), [
    "git",
    "curl",
    "ca-certificates",
  ]).withExec([
    "sh",
    "-c",
    `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
  ]);

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

  const authedContainer = withGithubAppCredentials(
    container,
    source,
    githubAppId,
    githubAppInstallationId,
    githubAppPrivateKey,
  );

  return authedContainer.withExec([
    "sh",
    "-c",
    [
      `set -eu`,
      `export GIT_TERMINAL_PROMPT=0`,
      mintGithubAppTokenAndSetupGitAuth(),
      `git clone ${MONOREPO_WRITE_URL} /repo`,
      `cd /repo`,
      `git config user.email "ci@sjer.red"`,
      `git config user.name "CI Bot"`,
      `if git ls-remote --exit-code --heads origin "${VERSION_BUMP_BRANCH}" >/dev/null; then git fetch origin main:refs/remotes/origin/main "${VERSION_BUMP_BRANCH}:${VERSION_BUMP_BRANCH}" && git checkout "${VERSION_BUMP_BRANCH}" && git rebase origin/main; else git fetch origin main:refs/remotes/origin/main && git checkout -b "${VERSION_BUMP_BRANCH}" origin/main; fi`,
      `bun run .buildkite/scripts/update-versions.ts packages/homelab/src/cdk8s/src/versions.ts "${version}" ${digestArgs}`,
      `git add packages/homelab/src/cdk8s/src/versions.ts`,
      `if git diff --cached --quiet; then HAS_VERSION_CHANGES=0; echo "No version changes to commit"; else HAS_VERSION_CHANGES=1; git commit -m "chore: bump image versions to ${version}" -m "Auto-Generated: ci-bot"; fi`,
      `if [ "$HAS_VERSION_CHANGES" = "0" ] && git diff --quiet origin/main...HEAD; then echo "No version changes and pending branch has no diff"; exit 0; fi`,
      `git push --force-with-lease -u origin "${VERSION_BUMP_BRANCH}"`,
      `PR_NUMBER=$(gh pr list --repo ${MONOREPO_REPO} --head "${VERSION_BUMP_BRANCH}" --state open --json number -q '.[0].number // empty')`,
      `if [ -z "$PR_NUMBER" ]; then gh pr create --repo ${MONOREPO_REPO} --base main --head "${VERSION_BUMP_BRANCH}" --title "chore: bump pending image versions" --body "Auto-generated version bump"; PR_NUMBER=$(gh pr view --repo ${MONOREPO_REPO} "${VERSION_BUMP_BRANCH}" --json number -q .number); fi`,
      `test -n "$PR_NUMBER" || { echo "ERROR: version commit-back PR number is empty" >&2; exit 1; }`,
      `gh pr merge --repo ${MONOREPO_REPO} "$PR_NUMBER" --auto --squash`,
    ].join(" && "),
  ]);
}

/** Update the CI base image version pointer and create or refresh an auto-merge PR. */
export function ciBaseVersionCommitBackHelper(
  source: Directory,
  version: string,
  githubAppId: Secret,
  githubAppInstallationId: Secret,
  githubAppPrivateKey: Secret,
  dryrun = false,
): Container {
  const container = withAptPackages(dag.container().from(BUN_IMAGE), [
    "git",
    "curl",
    "ca-certificates",
  ]).withExec([
    "sh",
    "-c",
    `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
  ]);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would update ${CI_BASE_VERSION_BUMP_BRANCH} with ci-base version ${version}`,
    ]);
  }

  const authedContainer = withGithubAppCredentials(
    container,
    source,
    githubAppId,
    githubAppInstallationId,
    githubAppPrivateKey,
  );

  return authedContainer.withExec([
    "sh",
    "-c",
    [
      `set -eu`,
      `export GIT_TERMINAL_PROMPT=0`,
      mintGithubAppTokenAndSetupGitAuth(),
      `git clone ${MONOREPO_WRITE_URL} /repo`,
      `cd /repo`,
      `git config user.email "ci@sjer.red"`,
      `git config user.name "CI Bot"`,
      `if git ls-remote --exit-code --heads origin "${CI_BASE_VERSION_BUMP_BRANCH}" >/dev/null; then git fetch origin main:refs/remotes/origin/main "${CI_BASE_VERSION_BUMP_BRANCH}:${CI_BASE_VERSION_BUMP_BRANCH}" && git checkout "${CI_BASE_VERSION_BUMP_BRANCH}" && git rebase origin/main; else git fetch origin main:refs/remotes/origin/main && git checkout -b "${CI_BASE_VERSION_BUMP_BRANCH}" origin/main; fi`,
      `printf '%s\\n' "${version}" > .buildkite/ci-image/VERSION`,
      `git add -- .buildkite/ci-image/VERSION`,
      `if git diff --cached --quiet; then HAS_VERSION_CHANGES=0; echo "No ci-base version changes to commit"; else HAS_VERSION_CHANGES=1; git commit -m "chore: bump ci-base image to ${version}" -m "Auto-Generated: ci-bot"; fi`,
      `if [ "$HAS_VERSION_CHANGES" = "0" ] && git diff --quiet origin/main...HEAD; then echo "No ci-base version changes and pending branch has no diff"; exit 0; fi`,
      `git push --force-with-lease -u origin "${CI_BASE_VERSION_BUMP_BRANCH}"`,
      `PR_NUMBER=$(gh pr list --repo ${MONOREPO_REPO} --head "${CI_BASE_VERSION_BUMP_BRANCH}" --state open --json number -q '.[0].number // empty')`,
      `if [ -z "$PR_NUMBER" ]; then gh pr create --repo ${MONOREPO_REPO} --base main --head "${CI_BASE_VERSION_BUMP_BRANCH}" --title "chore: bump ci-base image to ${version}" --body "Auto-generated ci-base version bump"; PR_NUMBER=$(gh pr view --repo ${MONOREPO_REPO} "${CI_BASE_VERSION_BUMP_BRANCH}" --json number -q .number); fi`,
      `test -n "$PR_NUMBER" || { echo "ERROR: ci-base version commit-back PR number is empty" >&2; exit 1; }`,
      `gh pr merge --repo ${MONOREPO_REPO} "$PR_NUMBER" --auto --squash`,
    ].join(" && "),
  ]);
}

/**
 * Bump packages/cooklang-for-obsidian/manifest.json in the monorepo to track
 * a release that was just published to the plugin repo. Update versions.json
 * only when the release changes the Obsidian compatibility boundary, then
 * open or refresh an auto-merge PR. Mirrors versionCommitBackHelper.
 */
export function cooklangVersionCommitBackHelper(
  source: Directory,
  version: string,
  minAppVersion: string,
  githubAppId: Secret,
  githubAppInstallationId: Secret,
  githubAppPrivateKey: Secret,
  dryrun = false,
): Container {
  const container = withAptPackages(dag.container().from(BUN_IMAGE), [
    "git",
    "curl",
    "ca-certificates",
    "jq",
  ]).withExec([
    "sh",
    "-c",
    `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
  ]);

  if (dryrun) {
    return container.withExec([
      "echo",
      `DRYRUN: would update ${COOKLANG_VERSION_BUMP_BRANCH} with cooklang plugin version ${version} (minAppVersion ${minAppVersion})`,
    ]);
  }

  const authedContainer = withGithubAppCredentials(
    container,
    source,
    githubAppId,
    githubAppInstallationId,
    githubAppPrivateKey,
  );

  return authedContainer.withExec([
    "sh",
    "-c",
    [
      `set -eu`,
      `export GIT_TERMINAL_PROMPT=0`,
      mintGithubAppTokenAndSetupGitAuth(),
      `git clone ${MONOREPO_WRITE_URL} /repo`,
      `cd /repo`,
      `git config user.email "ci@sjer.red"`,
      `git config user.name "CI Bot"`,
      `if git ls-remote --exit-code --heads origin "${COOKLANG_VERSION_BUMP_BRANCH}" >/dev/null; then git fetch origin main:refs/remotes/origin/main "${COOKLANG_VERSION_BUMP_BRANCH}:${COOKLANG_VERSION_BUMP_BRANCH}" && git checkout "${COOKLANG_VERSION_BUMP_BRANCH}" && git rebase origin/main; else git fetch origin main:refs/remotes/origin/main && git checkout -b "${COOKLANG_VERSION_BUMP_BRANCH}" origin/main; fi`,
      `jq --arg v "${version}" '.version = $v' packages/cooklang-for-obsidian/manifest.json > packages/cooklang-for-obsidian/manifest.json.tmp`,
      `mv packages/cooklang-for-obsidian/manifest.json.tmp packages/cooklang-for-obsidian/manifest.json`,
      `if [ ! -s packages/cooklang-for-obsidian/versions.json ]; then echo '{}' > packages/cooklang-for-obsidian/versions.json; fi`,
      `latest_min=$(jq -r 'to_entries | map(select(.key | test("^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$"))) | sort_by(.key | split(".") | map(tonumber)) | (last // {"value": ""}) | .value' packages/cooklang-for-obsidian/versions.json)`,
      `if [ -z "$latest_min" ] || [ "$latest_min" != "${minAppVersion}" ]; then jq --arg v "${version}" --arg m "${minAppVersion}" '.[$v] = $m' packages/cooklang-for-obsidian/versions.json > packages/cooklang-for-obsidian/versions.json.tmp && mv packages/cooklang-for-obsidian/versions.json.tmp packages/cooklang-for-obsidian/versions.json && git add packages/cooklang-for-obsidian/versions.json; else echo "versions.json compatibility boundary unchanged (${minAppVersion})"; fi`,
      `git add packages/cooklang-for-obsidian/manifest.json`,
      `if git diff --cached --quiet; then HAS_CHANGES=0; echo "No cooklang version changes to commit"; else HAS_CHANGES=1; git commit -m "chore(cooklang): bump to v${version}" -m "Auto-Generated: ci-bot"; fi`,
      `if [ "$HAS_CHANGES" = "0" ] && git diff --quiet origin/main...HEAD; then echo "No cooklang changes and pending branch has no diff"; exit 0; fi`,
      `git push --force-with-lease -u origin "${COOKLANG_VERSION_BUMP_BRANCH}"`,
      `PR_NUMBER=$(gh pr list --repo ${MONOREPO_REPO} --head "${COOKLANG_VERSION_BUMP_BRANCH}" --state open --json number -q '.[0].number // empty')`,
      `if [ -z "$PR_NUMBER" ]; then gh pr create --repo ${MONOREPO_REPO} --base main --head "${COOKLANG_VERSION_BUMP_BRANCH}" --title "chore(cooklang): bump plugin manifest version" --body "Auto-generated cooklang manifest version bump"; PR_NUMBER=$(gh pr view --repo ${MONOREPO_REPO} "${COOKLANG_VERSION_BUMP_BRANCH}" --json number -q .number); fi`,
      `test -n "$PR_NUMBER" || { echo "ERROR: cooklang version commit-back PR number is empty" >&2; exit 1; }`,
      `gh pr merge --repo ${MONOREPO_REPO} "$PR_NUMBER" --auto --squash`,
    ].join(" && "),
  ]);
}

// ---------------------------------------------------------------------------
// Release-please
// ---------------------------------------------------------------------------

/**
 * Run release-please to create release PRs and GitHub releases, then run a
 * Claude agent to refine the auto-generated CHANGELOGs to a library-consumer
 * view.
 *
 * Pipeline order is intentional: release-pr → refine → github-release.
 * The refine step targets the just-created PR; github-release is a no-op
 * while a release PR is open (it only fires on merge), so its position
 * relative to refine doesn't matter functionally.
 */
export function releasePleaseHelper(
  source: Directory,
  githubAppId: Secret,
  githubAppInstallationId: Secret,
  githubAppPrivateKey: Secret,
  claudeOauthToken: Secret,
  dryrun = false,
): Container {
  // BUN_INSTALL=/usr/local forces `bun add -g` to drop binaries (claude,
  // release-please) into /usr/local/bin where everything in PATH can find them
  // even when the container runs as a non-root user.
  const container = withAptPackages(dag.container().from(BUN_IMAGE), [
    "git",
    "ca-certificates",
    "curl",
  ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ])
    .withEnvVariable("BUN_INSTALL", "/usr/local")
    .withExec(["bun", "add", "-g", `release-please@${RELEASE_PLEASE_VERSION}`])
    .withExec([
      "bun",
      "add",
      "-g",
      `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`,
    ])
    .withExec(["claude", "--version"])
    // This container runs as root (the gh download, apt packages, the
    // `> /usr/local/bin/git-askpass` write in mintGithubAppTokenAndSetupGitAuth,
    // and the root-owned /workspace mount all depend on it), but recent Claude
    // Code releases refuse `--dangerously-skip-permissions` under uid 0 with
    // "cannot be used with root/sudo privileges for security reasons". IS_SANDBOX=1
    // is Claude Code's documented escape hatch for trusted, ephemeral automation
    // containers: this one runs a fixed, code-reviewed prompt
    // (.dagger/prompts/refine-release-please.md) scoped only by the GitHub App
    // token, which is exactly the sandbox case the flag is meant for.
    .withEnvVariable("IS_SANDBOX", "1")
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES });

  if (dryrun) {
    return container.withExec([
      "echo",
      "DRYRUN: would run release-please (release-pr + refine + github-release)",
    ]);
  }
  const authedContainer = withGithubAppCredentials(
    container,
    source,
    githubAppId,
    githubAppInstallationId,
    githubAppPrivateKey,
  ).withSecretVariable("CLAUDE_CODE_OAUTH_TOKEN", claudeOauthToken);

  return authedContainer.withExec([
    "sh",
    "-c",
    [
      // Mint a fresh GH App installation token. withAskpass=true is required
      // here (was false for the old release-please-only pipeline) because the
      // refine agent runs `git clone` + `git push` over HTTPS and needs git's
      // askpass dance to inject credentials.
      mintGithubAppTokenAndSetupGitAuth({ withAskpass: true }),
      `release-please release-pr --token="$GH_TOKEN" --repo-url=${MONOREPO_REPO} --target-branch=main`,
      // Refine the just-generated CHANGELOGs. The prompt at
      // .dagger/prompts/refine-release-please.md is the source of truth for
      // the agent's behavior. It exits 0 with a status envelope when there
      // is no open release PR, no bumped packages, or nothing to refine.
      `REFINE_PROMPT="$(cat /workspace/.dagger/prompts/refine-release-please.md)"`,
      // The agent must run arbitrary `git`/`gh` Bash commands non-interactively,
      // so it runs with --dangerously-skip-permissions. That flag fully overrides
      // --permission-mode, so we don't pass acceptEdits (it would be dead config
      // that misleads readers into thinking the agent is scoped to file edits).
      // The agent's write access is therefore bounded only by the fixed,
      // code-reviewed prompt at .dagger/prompts/refine-release-please.md and the
      // GitHub App token's repo scope — re-evaluate if the prompt becomes dynamic.
      `claude -p "$REFINE_PROMPT" --output-format json --allowed-tools Bash,Read,Edit,Write,Grep,Glob --dangerously-skip-permissions --max-turns 80 --model claude-opus-4-8`,
      `release-please github-release --token="$GH_TOKEN" --repo-url=${MONOREPO_REPO} --target-branch=main`,
    ].join(" && "),
  ]);
}
