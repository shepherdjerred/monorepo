# CI Security Audit: Buildkite + Dagger

## Status

Planned. Fork PR builds remain disabled; complete this before enabling external contributor CI.

## Context

You want to allow external contributors to your monorepo without risking secret exfiltration, infrastructure compromise, or supply chain attacks. Fork PR builds are already disabled in Buildkite settings, so the critical external attacker vector is closed. This plan addresses remaining defense-in-depth issues and enables safe fork PR builds.

---

## Findings

### Critical (mitigated): Fork PR builds disabled

Fork PR builds are off in Buildkite settings. However, if re-enabled without code changes, a fork PR would run attacker-controlled TypeScript in the pipeline generator with all secrets mounted. The trusted generator approach (P0 item 1) is needed before re-enabling.

### High: All secrets mounted to all steps

Every CI step gets `buildkite-ci-secrets` via `envFrom` in `k8s-plugin.ts` (line 12-14). This monolithic secret contains GH_TOKEN, NPM_TOKEN, AWS creds, CLOUDFLARE_API_TOKEN, ARGOCD_AUTH_TOKEN, CHARTMUSEUM_PASSWORD, CLAUDE_CODE_OAUTH_TOKEN, and HASS_TOKEN. A supply chain attack (malicious postinstall script in a dependency) would exfiltrate everything, even from a lint step.

### High: Pipeline generator runs from PR branch

`generate-pipeline.sh` runs `scripts/ci/src/main.ts` from the checked-out branch. For internal PRs from collaborators, this is still a Poisoned Pipeline Execution risk (OWASP CICD-SEC-4). The bootstrap step also mounts all secrets.

### High: No CODEOWNERS on CI code

Anyone with write access can modify `scripts/ci/`, `.dagger/`, `.buildkite/` without required review.

### Medium: Long-lived static credentials

AWS, Cloudflare, GitHub tokens are long-lived secrets. Buildkite supports OIDC federation for short-lived credentials.

### Medium: No pipeline signing

Pipeline steps are not signed. A compromised Buildkite account or MITM could inject steps.

### Medium: Privileged pod security

Buildkite namespace: `pod-security.kubernetes.io/enforce: privileged`. Combined with `automountServiceAccountToken: true` and the controller service account.

### Medium: Shared Dagger engine

All CI jobs share one Dagger engine at `dagger-engine.dagger.svc.cluster.local:8080`. No network policies. Cache could be poisoned.

### What's already done well

- Fork PR builds disabled in Buildkite settings
- Dagger `Secret` type prevents secret logging
- `--frozen-lockfile` enforced everywhere
- Hygiene checker bans dangerous patterns
- Deploy steps gated on `build.branch == pipeline.default_branch`
- Gitleaks scanning for committed secrets
- Ephemeral K8s pods per build (agent-stack-k8s)

---

## Remediation Plan

### P0: High impact, low effort (do first)

#### 1. Remove secrets from bootstrap step + add `noSecrets` mode

**Files:**

- `.buildkite/pipeline.yml` (lines 21-25) — remove `envFrom` with `buildkite-ci-secrets`. If `BUILDKITE_API_TOKEN` is in that secret, create a separate minimal `buildkite-ci-api-token` K8s secret.
- `scripts/ci/src/lib/k8s-plugin.ts` — add `noSecrets: boolean` option:

  ```typescript
  export function k8sPlugin(opts = {}) {
    const secretRefs = opts.noSecrets
      ? []
      : [{ secretRef: { name: "buildkite-ci-secrets" } }];
    // ...rest unchanged
  }
  ```

- `scripts/ci/src/lib/buildkite.ts` — add `noSecrets` param to `plainStep()` and `daggerStep()`, forwarding to `k8sPlugin()`. Default `plainStep` to `noSecrets: true`.
- Step files — explicitly pass `noSecrets: true` for lint/test/build/quality steps; leave deploy/release steps as-is.

**Steps that need secrets:** image push, npm publish, helm push, tofu apply, argocd sync, release-please, version commit-back, code review, site deploy.

**Steps that should NOT have secrets (~20 steps):** all `plainStep()` quality checks, per-package lint/typecheck/test, image build + smoke test, cdk8s synth.

#### 2. CODEOWNERS for CI pipeline code

**File:** `.github/CODEOWNERS` (create if not exists)

```
scripts/ci/ @shepherdjerred
.dagger/ @shepherdjerred
.buildkite/ @shepherdjerred
bun.lock @shepherdjerred
```

Requires your approval for any changes to CI pipeline code or the lockfile.

#### 3. `--ignore-scripts` for pipeline generator install

**File:** `.buildkite/scripts/generate-pipeline.sh`

Add `--ignore-scripts` to the implicit install. The generator doesn't need postinstall scripts.

---

### P1: Enable safe fork PR builds

#### 4. Trusted generator for fork PRs

**File:** `.buildkite/scripts/generate-pipeline.sh`

Detect fork PRs via `BUILDKITE_PULL_REQUEST_REPO`. When set, extract the pipeline generator from `origin/main` and run that instead:

```bash
if [[ -n "${BUILDKITE_PULL_REQUEST_REPO:-}" ]]; then
  echo "Fork PR detected — using trusted pipeline generator from origin/main"
  TRUSTED_DIR="$(mktemp -d)"
  git archive origin/main scripts/ci | tar -x -C "$TRUSTED_DIR"
  cd "$TRUSTED_DIR/scripts/ci"
  bun install --frozen-lockfile --ignore-scripts
  bun run src/main.ts | buildkite-agent pipeline upload
  rm -rf "$TRUSTED_DIR"
else
  cd scripts/ci && bun run src/main.ts | buildkite-agent pipeline upload
fi
```

#### 5. `FORK_MODE` in pipeline generation

**File:** `scripts/ci/src/lib/k8s-plugin.ts`

```typescript
export const FORK_MODE = !!process.env["BUILDKITE_PULL_REQUEST_REPO"];
```

Use in `k8sPlugin` to force `noSecrets` for all steps when in fork mode.

**File:** `scripts/ci/src/pipeline-builder.ts`

Add `const isForkPr = !!process.env["BUILDKITE_PULL_REQUEST_REPO"]` and:

- Keep: per-package lint/typecheck/test, quality gates, async quality, image build + smoke test
- Skip: code review, image push, npm publish, helm push, tofu, argocd, release-please, version commit-back, site deploy

#### 6. Re-enable fork builds in Buildkite settings

- Enable "Build when pull request is from third-party forked repository"
- Verify "Pass secrets to builds from third-party forked repositories" is OFF (defense-in-depth)

---

### P2: Defense in depth (1-2 weeks)

#### 7. Split `buildkite-ci-secrets` into per-purpose secrets

Replace the monolithic 1Password item with separate K8s secrets:

- `buildkite-ci-github-token` (GH_TOKEN)
- `buildkite-ci-npm-token` (NPM_TOKEN)
- `buildkite-ci-aws-creds` (SEAWEEDFS keys)
- `buildkite-ci-cloudflare` (CLOUDFLARE_API_TOKEN, ACCOUNT_ID)
- `buildkite-ci-chartmuseum` (CHARTMUSEUM_PASSWORD)
- `buildkite-ci-hass` (HASS_TOKEN)
- `buildkite-ci-claude` (CLAUDE_CODE_OAUTH_TOKEN)

Each step requests only specific secrets via `k8sPlugin({ secrets: [...] })`.

**File:** `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts` — replace single `OnePasswordItem` with multiple.

#### 8. Approval gate for tofu apply

**File:** `scripts/ci/src/pipeline-builder.ts`

Add a Buildkite `block` step before the tofu apply group:

```typescript
steps.push({
  block: ":terraform: Approve Tofu Apply",
  key: "tofu-approve",
  if: MAIN_ONLY,
  depends_on: ["quality-gate"],
});
```

#### 9. Buildkite OIDC for cloud credentials

Replace long-lived AWS and Cloudflare tokens with Buildkite OIDC federation. Buildkite issues short-lived OIDC tokens that can be exchanged for temporary cloud credentials. This eliminates the risk of leaked long-lived credentials.

See: https://buildkite.com/docs/pipelines/security/oidc

---

### P3: Hardening (1 month)

#### 10. Pipeline signing

Enable Buildkite pipeline signing (EdDSA) so agents verify steps haven't been tampered with.

#### 11. Pod security hardening

- Change PSS from `privileged` to `baseline` (test in warn mode first)
- Create minimal `buildkite-job-runner` service account
- Set `automountServiceAccountToken: false` for job pods

#### 12. CI image supply chain

- Pin `ci-base` image by digest in `k8s-plugin.ts`
- Sign with cosign, verify in admission controller

#### 13. Dagger engine isolation

- Network policies restricting engine access
- Separate engines for trusted vs untrusted workloads

#### 14. `--reject-secrets` flag

Add `--reject-secrets` to `buildkite-agent pipeline upload` in `generate-pipeline.sh` to prevent accidental secret interpolation during upload.

---

## Files to modify

| File                                      | Change                                                                    | Priority |
| ----------------------------------------- | ------------------------------------------------------------------------- | -------- |
| `.buildkite/pipeline.yml`                 | Remove secrets from bootstrap `envFrom`                                   | P0       |
| `scripts/ci/src/lib/k8s-plugin.ts`        | Add `noSecrets` option + `FORK_MODE`                                      | P0       |
| `scripts/ci/src/lib/buildkite.ts`         | Forward `noSecrets` in `plainStep()` / `daggerStep()`                     | P0       |
| `scripts/ci/src/steps/*.ts`               | Tag each step as secrets/no-secrets                                       | P0       |
| `.github/CODEOWNERS`                      | Protect CI code + lockfile                                                | P0       |
| `.buildkite/scripts/generate-pipeline.sh` | `--ignore-scripts`, fork detection, trusted generator, `--reject-secrets` | P0/P1    |
| `scripts/ci/src/pipeline-builder.ts`      | Skip steps for forks; tofu block step                                     | P1/P2    |
| `packages/homelab/.../buildkite.ts`       | Split secrets, harden PSS                                                 | P2       |

## Verification

1. **Secret scoping:** Run a PR build, inspect k8s pod spec for lint/test steps — confirm no `secretRef` for `buildkite-ci-secrets`
2. **Fork simulation:** Set `BUILDKITE_PULL_REQUEST_REPO=https://github.com/test/fork`, run `main.ts` — confirm no deploy steps, no secret refs
3. **Bootstrap:** Trigger a build, verify generator pod env has no CI secrets
4. **Main branch:** Merge to main — confirm full pipeline with secrets for deploy steps
5. **CODEOWNERS:** Open a PR modifying `scripts/ci/` — confirm review required
6. **Tofu block:** Trigger main build — confirm pause before tofu apply
