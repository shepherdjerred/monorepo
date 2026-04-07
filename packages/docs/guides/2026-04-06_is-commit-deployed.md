# How to Determine if a Commit is Deployed

Guide for tracing a commit through the deployment pipeline to verify it's running on the `torvalds` cluster.

## Pipeline Overview

```
commit to main → Buildkite CI → build images → push to GHCR → push Helm charts to ChartMuseum
    → version-commit-back PR (auto) → merge to main → ArgoCD auto-sync → deployed
```

## Step-by-Step Verification

### 1. Find the commit

```bash
git log --oneline -10                    # Recent commits
git log --oneline -- path/to/file        # Commits touching a specific file
```

### 2. Find which version bump includes it

Version bumps have the format `chore: bump image versions to 2.0.0-{BUILD}`.

```bash
# Show version bumps after your commit
git log --oneline --all --grep="bump image versions" | head -5

# Verify your commit is between the previous bump and the target bump
git log --oneline {previous-bump}..{target-bump}
```

Example: if your fix is `be49fdd3` and you want to confirm it's in `2.0.0-899`:

```bash
git log --oneline 7e58b3c8..5905518e
# 5905518e chore: bump image versions to 2.0.0-899
# ab6a4378 fix(root): prettier
# be49fdd3 fix(root): conditional prisma entrypoint   ← your commit
```

If your commit appears between the two bumps, it's included in the newer version's images.

### 3. Check if the version bump PR was merged

The version-commit-back step creates a PR on branch `chore/version-bump-2.0.0-{BUILD}`. It auto-merges in the normal case, but can get stuck.

```bash
# Check for open (unmerged) version bump PRs
gh pr list --search "bump image versions" --state open

# Check a specific version
gh pr list --head chore/version-bump-2.0.0-899 --json number,state,url

# Check if versions.ts on main has the version
git show main:packages/homelab/src/cdk8s/src/versions.ts | grep "2.0.0-899"
```

**If the PR is still open, the version is NOT deployed.** Merge it to proceed.

### 4. Check what version ArgoCD is running

```bash
# What version is the apps chart synced to?
argocd app get apps | grep -i revision

# What image is a specific deployment running?
kubectl get deployment -n <namespace> <name> -o jsonpath='{.spec.template.spec.containers[0].image}'

# Check multiple services at once
kubectl get deployments -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: {.spec.template.spec.containers[*].image}{"\n"}{end}' | grep shepherdjerred
```

### 5. Cross-reference image digests

Each image in `versions.ts` has a pinned digest (`2.0.0-899@sha256:abc...`). You can verify the running pod matches:

```bash
# What digest is in versions.ts?
grep "tasknotes-server" packages/homelab/src/cdk8s/src/versions.ts

# What digest is the pod actually running?
kubectl get pod -n tasknotes -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
```

If the digests match, the exact image from that build is deployed.

## Key Files

| File                                         | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| `packages/homelab/src/cdk8s/src/versions.ts` | Source of truth for deployed image versions + digests     |
| `scripts/ci/src/steps/version.ts`            | Generates the version-commit-back CI step                 |
| `.buildkite/scripts/update-versions.ts`      | Updates versions.ts with new digests from CI metadata     |
| `.buildkite/scripts/collect-digests.sh`      | Collects image digests from Buildkite metadata after push |
| `scripts/ci/src/steps/images.ts`             | Image build/push steps that store digests in CI metadata  |
| `scripts/ci/src/steps/helm.ts`               | Helm chart packaging and push to ChartMuseum              |
| `scripts/ci/src/steps/argocd.ts`             | ArgoCD sync + health wait after release                   |

## Common Failure Modes

| Symptom                                         | Cause                                | Fix                                             |
| ----------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| Version bump PR open but not merged             | CI checks blocked or not reporting   | Investigate CI, merge manually if checks passed |
| `versions.ts` updated but pods show old version | ArgoCD sync failed                   | Check `argocd app get apps` for SyncError       |
| ArgoCD shows Synced but pods still old          | Helm chart not pushed to ChartMuseum | Check Buildkite helm push step logs             |
| No version bump PR at all                       | Image push step failed in CI         | Check Buildkite build for the commit            |

## Quick One-Liner

To check if a specific build number is deployed:

```bash
BUILD=899; grep -q "2.0.0-$BUILD" packages/homelab/src/cdk8s/src/versions.ts && echo "In versions.ts (may be deployed)" || echo "NOT in versions.ts on current branch"
```
