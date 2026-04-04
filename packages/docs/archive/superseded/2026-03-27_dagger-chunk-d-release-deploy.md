# Chunk D: Release/Deploy Dagger Functions

**Wave:** 2 (parallel with E, F)
**Agent type:** Code agent, git worktree
**Touches:** `.dagger/src/release.ts` (NEW), `.dagger/src/index.ts` (add `@func()` wrappers)
**Depends on:** Chunks A + B merged
**Blocks:** Chunk G (pipeline generator needs these functions)

## Goal

Implement all release and deploy Dagger functions: helm, tofu, npm, site deploy, ArgoCD, cooklang, clauderon, version commit-back, cargo-deny.

## Context

- Load the `dagger-helper` skill before starting
- Read `packages/docs/plans/2026-03-27_dagger-best-practices-audit.md` for patterns
- All functions use `@func({ cache: "never" })` — deploy/push operations must always execute
- Use `.stdout()` not `.sync()` for terminal calls
- Pin all container image tags with Renovate comments
- Services at `*.sjer.red` are accessible via Cloudflare tunnel (public), not tailnet-only

## Steps

### 1. Create `.dagger/src/release.ts`

Export helper functions (NOT decorated — `@func()` wrappers go in `index.ts`):

1. **`helmPackageHelper(source, chartName, version, chartMuseumUsername, chartMuseumPassword)`**
   - Alpine container with `helm` + `curl` installed
   - Mount chart from `packages/homelab/src/cdk8s/helm/{chartName}`
   - If CDK8s manifest exists at `packages/homelab/src/cdk8s/dist/{chartName}.k8s.yaml`, copy into `templates/`
   - Run `helm package` with `--version` and `--app-version`
   - `curl POST` the `.tgz` to ChartMuseum at `https://chartmuseum.sjer.red/api/charts` with basic auth

2. **`tofuApplyHelper(source, stack, seaweedfsAccessKeyId, seaweedfsSecretAccessKey, tofuGithubToken, cloudflareAccountId?)`**
   - Container with `tofu` installed
   - Mount `packages/homelab/src/tofu/{stack}`
   - Map secrets to env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (for S3 backend), `GH_TOKEN`, `TF_VAR_cloudflare_account_id`
   - Run `tofu init -input=false && tofu apply -auto-approve -input=false`
   - 3 stacks: `cloudflare`, `github`, `seaweedfs`

3. **`publishNpmHelper(source, pkg, npmToken)`**
   - Use `bunBase(source, pkg)` to get container with deps
   - Write `.npmrc` with token via `withSecretVariable("NPM_TOKEN", npmToken)`
   - Run `bun publish --access public --tag latest`
   - 4 packages: `bun-decompile`, `astro-opengraph-images`, `webring`, `homelab/src/helm-types`

4. **`deploySiteHelper(source, pkg, bucket, buildCmd, distSubdir, target, workspaceDeps, needsPlaywright, ...creds)`**
   - Container with bun + awscli
   - Build workspace deps if specified
   - Optionally install Playwright
   - Run build command
   - `aws s3 sync --delete` to S3 (SeaweedFS at `seaweedfs.sjer.red`) or R2 (Cloudflare)
   - 7 sites: sjer.red, clauderon docs, resume, webring, cooklang-rich-preview, status-page, cook

5. **`argoCdSyncHelper(appName, argoCdToken, serverUrl?)`**
   - Alpine + curl container
   - POST to `https://argocd.sjer.red/api/v1/applications/{appName}/sync` with bearer token
   - Handle 409 (already syncing) as success

6. **`argoCdHealthWaitHelper(appName, argoCdToken, timeoutSeconds, serverUrl?)`**
   - Poll GET `https://argocd.sjer.red/api/v1/applications/{appName}` every 10s
   - Check `status.health.status === "Healthy"`
   - Timeout after `timeoutSeconds` (default 300)

7. **`cooklangBuildHelper(source, version)`** → Directory
   - bunBase, update version in manifest.json, `bun run build`
   - Return directory with `main.js`, `manifest.json`, `styles.css`

8. **`cooklangPushHelper(artifacts, version, ghToken)`**
   - Container with `gh` CLI
   - Commit each artifact to `shepherdjerred/cooklang-for-obsidian` repo via GitHub API

9. **`clauderonUploadHelper(binaries, version, ghToken)`**
   - Container with `gh` CLI
   - `gh release upload clauderon-v{version} /artifacts/* --repo shepherdjerred/monorepo --clobber`

10. **`versionCommitBackHelper(digests, version, ghToken)`**
    - Container with `git` + `gh`
    - Clone repo, update `packages/homelab/src/cdk8s/src/versions.ts` with new digests
    - Create branch, commit, push, create auto-merge PR

11. **`cargoDenyHelper(source)`**
    - Use `rustBase(source)` container
    - Install `cargo-deny`: `cargo install cargo-deny`
    - Run `cargo deny check`

### 2. Add `@func()` wrappers to `index.ts`

Import helpers from `release.ts`. Add thin methods with `@func({ cache: "never" })`:

```typescript
import { helmPackageHelper, tofuApplyHelper, ... } from "./release"

// In the Monorepo class:
@func({ cache: "never" })
async helmPackage(source: Directory, chartName: string, version: string,
  chartMuseumUsername: string, chartMuseumPassword: Secret): Promise<string> {
  return helmPackageHelper(source, chartName, version, chartMuseumUsername, chartMuseumPassword)
}
// ... etc for each function
```

### 3. Verify

```bash
dagger functions  # all new functions listed

# Each should fail at external auth, not at code/syntax errors:
dagger call helm-package --source=. --chart-name=birmel --version=test \
  --chart-museum-username=test --chart-museum-password=env:FAKE
dagger call publish-npm --source=. --pkg=webring --npm-token=env:FAKE
dagger call cargo-deny --source=.  # this one should actually work if cargo-deny is installed
```

## Definition of Done

- [ ] `release.ts` exists with all 11 helper functions
- [ ] `index.ts` has `@func({ cache: "never" })` wrappers for each
- [ ] `dagger functions` lists all new functions without error
- [ ] Each function callable — fails at expected point (external service auth), not code errors
- [ ] No `.sync()` used — all terminal calls use `.stdout()` or `.publish()`
- [ ] All container image tags pinned with Renovate comments
- [ ] Secret parameters use Dagger `Secret` type, not plain strings

## Success Criteria

All 11 functions appear in `dagger functions` output. Functions that need external credentials fail at the auth step, not at compilation or SDK errors. `cargoDeny` runs successfully on the clauderon package.
