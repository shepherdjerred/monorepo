---
name: buildkite-helper
description: |
  BuildKite CI/CD pipeline configuration, YAML syntax, dynamic pipelines, and agent management
  When user works with BuildKite, mentions CI pipelines, .buildkite/ directory, buildkite-agent commands,
  pipeline YAML, build steps, BuildKite API, or asks about CI configuration, pipeline generation,
  step dependencies, retry configuration, agent queues, or Kubernetes CI agents
---

# BuildKite Helper

> **⚠️ Partially stale.** The monorepo runs a **static** Buildkite pipeline (`.buildkite/pipeline.yml`, replatformed 2026-07 — the Dagger module and dynamic generator are gone) on the homelab agent-stack (`buildkite` namespace). CI runs on the dedicated `liskov` node; **Kueue was removed 2026-07** (`BUILDKITE_MAX_IN_FLIGHT` is the sole concurrency cap). Dagger/dynamic-pipeline notes below are historical; the general Buildkite reference material remains valid.

## Overview

BuildKite is a CI/CD platform where builds run on your own infrastructure via agents. Pipelines are defined in YAML (static or dynamically generated). This monorepo formerly used BuildKite as its sole CI platform with dynamic TypeScript pipeline generation and Dagger for all build steps (removed 2026-07).

## Monorepo Fixed-Corpus CI I/O Builds

`CI_IO_FIXED_CORPUS=true` is an operator-only mode for producing a comparable
CI I/O acceptance candidate on the current `main` commit. It forces the
playwright, resume, Docker E2E, images, and OpenTofu selectors. The image lane
builds and pushes every known image target, and the OpenTofu lanes perform real
applies; unrelated selectors keep their normal change-based decisions.

After confirming the SHA is still current `main`, create the build with:

```bash
bk build create \
  --pipeline sjerred/monorepo \
  --branch main \
  --commit <current-main-sha> \
  --env CI_IO_FIXED_CORPUS=true \
  --yes
```

The value must be exactly `true`, and `BUILDKITE_BRANCH` must be `main`.
Invalid values, an unset branch, and non-main branches fail before the pipeline
runs. Treat this as a production-mutating build, not a read-only benchmark.

## Pipeline YAML Quick Reference

### Command Step

```yaml
steps:
  - label: ":test_tube: Tests"
    command: "npm test"
    key: "tests"
    agents: { queue: "default" }
    artifact_paths: "coverage/**/*"
    timeout_in_minutes: 10
    retry:
      automatic:
        - exit_status: -1
          limit: 2
        - exit_status: 255
          limit: 2
    soft_fail:
      - exit_status: 1
    env:
      NODE_ENV: test
```

### Wait Step

```yaml
- wait: ~ # Waits for all previous steps
- wait: ~
  continue_on_failure: true # Proceed even if prior steps failed
```

### Block Step (creates implicit dependencies)

```yaml
- block: ":rocket: Deploy?"
  prompt: "Ready to deploy?"
  blocked_state: passed # passed | failed | running
  fields:
    - select: "Region"
      key: "region"
      options:
        - { label: "US", value: "us" }
        - { label: "EU", value: "eu" }
```

### Input Step (no implicit dependencies)

```yaml
- input: "Release info"
  fields:
    - text: "Version"
      key: "version"
      format: "[0-9]+\\.[0-9]+\\.[0-9]+"
```

### Trigger Step

```yaml
- trigger: "deploy-pipeline"
  label: ":rocket: Deploy"
  async: true # Don't wait for triggered build
  build:
    branch: "${BUILDKITE_BRANCH}"
    commit: "${BUILDKITE_COMMIT}"
    env:
      DEPLOY_ENV: production
```

### Group Step

```yaml
- group: ":lock: Security"
  key: "security"
  steps:
    - command: "audit.sh"
    - command: "scan.sh"
# Consecutive groups run in parallel. No nested groups allowed.
```

## Dynamic Pipeline Generation

```bash
# Generate and upload pipeline (steps inserted after upload step)
./generate.sh | buildkite-agent pipeline upload

# Upload from file
buildkite-agent pipeline upload .buildkite/deploy.yml

# Upload JSON
echo '{"steps": [{"command": "test.sh"}]}' | buildkite-agent pipeline upload
```

**This monorepo (historical)**: TypeScript generator at `scripts/ci/src/main.ts` (since removed) → change detection → JSON → `buildkite-agent pipeline upload`.

## Step Configuration

### Dependencies

```yaml
- command: "build.sh"
  key: "build"
- command: "test.sh"
  depends_on: "build" # Single dependency
- command: "deploy.sh"
  depends_on: ["build", "test"] # Multiple dependencies
  allow_dependency_failure: true # Run even if deps fail
```

### Conditionals (`if`)

C-like expressions evaluated at **upload time** (not runtime):

```yaml
- command: "deploy.sh"
  if: build.branch == pipeline.default_branch
- command: "pr-check.sh"
  if: build.pull_request.id != null
- command: "tagged.sh"
  if: build.tag =~ /^v[0-9]/
- command: "skip-wip.sh"
  if: build.message !~ /\[skip ci\]/i
```

Operators: `==`, `!=`, `=~`, `!~`, `||`, `&&`, `includes`, `!`. Variables: `build.*` (branch, commit, message, source, tag, pull_request, env()), `pipeline.*`, `organization.*`.

### Retry

```yaml
retry:
  automatic:
    - exit_status: -1 # Agent lost/timeout
      limit: 2
    - exit_status: "*" # Any non-zero (1-255)
      limit: 1
  manual:
    permit_on_passed: true
```

Auto retry: `exit_status` (int/array/"\*"), `signal`, `signal_reason`, `limit` (max 10).

### Concurrency

```yaml
- command: "deploy.sh"
  concurrency: 1
  concurrency_group: "app/deploy" # Org-wide scope
  concurrency_method: ordered # ordered (FIFO) | eager
```

### Other

```yaml
skip: "Temporarily disabled" # Skip with reason (max 70 chars)
soft_fail: true # All non-zero exits are soft failures
priority: 1 # Higher = dispatched first
timeout_in_minutes: 30
parallelism: 5 # Run N parallel copies
matrix: ["linux", "darwin"] # Expand step per value
```

## buildkite-agent CLI

```bash
# Pipeline
buildkite-agent pipeline upload [file]        # Upload steps (stdin or file)

# Meta-data (build-level key-value, max 100KB/value)
buildkite-agent meta-data set "key" "value"
buildkite-agent meta-data get "key"
buildkite-agent meta-data get "key" --default "fallback"

# Annotations (markdown on build page, max 1MiB)
buildkite-agent annotate "message" --style info --context "ctx"
buildkite-agent annotate --style error --context "ctx" < report.md
buildkite-agent annotate --scope job "Per-job note"  # v3.112+
buildkite-agent annotate --context "ctx" --remove
# Styles: default, info, warning, error, success

# Artifacts
buildkite-agent artifact upload "dist/**/*"
buildkite-agent artifact upload "report.html" --job "other-job-id"
buildkite-agent artifact download "dist/*" ./local/
buildkite-agent artifact shasum "file.tar.gz"

# Step
buildkite-agent step update "label" "New Label"
```

## Environment Variables (Key Subset)

| Variable                             | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `BUILDKITE_BRANCH`                   | Branch being built                                |
| `BUILDKITE_COMMIT`                   | Git commit SHA                                    |
| `BUILDKITE_MESSAGE`                  | Build message (commit msg)                        |
| `BUILDKITE_BUILD_NUMBER`             | Build number (monotonic)                          |
| `BUILDKITE_BUILD_URL`                | URL to build on Buildkite                         |
| `BUILDKITE_BUILD_ID`                 | Build UUID                                        |
| `BUILDKITE_JOB_ID`                   | Job UUID                                          |
| `BUILDKITE_PIPELINE_SLUG`            | Pipeline slug                                     |
| `BUILDKITE_ORGANIZATION_SLUG`        | Organization slug                                 |
| `BUILDKITE_PULL_REQUEST`             | PR number or `false`                              |
| `BUILDKITE_PULL_REQUEST_BASE_BRANCH` | PR target branch or `""`                          |
| `BUILDKITE_TAG`                      | Tag name (if tag build)                           |
| `BUILDKITE_SOURCE`                   | `webhook`, `api`, `ui`, `trigger_job`, `schedule` |
| `BUILDKITE_PARALLEL_JOB`             | Parallel job index (0-based)                      |
| `BUILDKITE_PARALLEL_JOB_COUNT`       | Total parallel jobs                               |
| `BUILDKITE_RETRY_COUNT`              | Times job has been retried                        |
| `BUILDKITE_STEP_KEY`                 | User-defined step key                             |
| `BUILDKITE_AGENT_ACCESS_TOKEN`       | Agent session token                               |
| `BUILDKITE_TRIGGERED_FROM_BUILD_ID`  | Parent build UUID                                 |
| `BUILDKITE_REPO`                     | Repository URL                                    |

Variable precedence (lowest→highest): pipeline env → build env → step env → standard vars → agent env → hook exports. Use `$$VAR` to escape upload-time interpolation.

## Kubernetes Plugin (agent-stack-k8s)

```yaml
plugins:
  - kubernetes:
      checkout:
        cloneFlags: "--depth=100"
        fetchFlags: "--depth=100"
      podSpecPatch:
        serviceAccountName: buildkite-controller
        containers:
          - name: container-0
            image: "ghcr.io/org/ci-base:latest"
            resources:
              requests: { cpu: "250m", memory: "512Mi" }
            envFrom:
              - secretRef: { name: ci-secrets }
            volumeMounts:
              - name: git-mirrors
                mountPath: /buildkite/git-mirrors
                readOnly: true
```

### Debugging killed containers (memcg OOM red herrings)

- Agent output `exit status -7` with "connected to the agent, but then stopped
  communicating without exiting normally" = a client container was SIGKILLed.
  The post-mortem k8s Job `DeadlineExceeded` events (deadline 60) that follow
  are **cleanup**, not cause: the agent-stack completions watcher patches
  `activeDeadlineSeconds` after the agent container terminates.
- A container-level (memcg) OOM kill emits **no** Kubernetes events — `kubectl
  get events` staying clean does not rule out OOM. Check the node kernel log:
  `kubectl debug node/<node> -n kube-system --profile=sysadmin --image=busybox
  -- sh -c 'dmesg | grep -i oom'` and look for `CONSTRAINT_MEMCG` plus a large
  `shmem` count.
- The workspace volume is a memory-backed emptyDir (tmpfs): every byte a step
  writes under `/workspace` is charged to the **writing container's** memory
  limit as shmem — a "disk-sized" write (e.g. a full git pack download) can
  OOM a container whose processes use almost no RAM. Containers without
  explicit resources get the namespace LimitRange default (768Mi). Incident:
  packages/docs/logs/2026-08-02_buildkite-pipeline-upload-oom-diagnosis.md.

## This Monorepo's CI Patterns (historical — pipeline removed 2026-07)

Everything in this section describes the pipeline as it existed before removal. The files below no longer exist in the repo; kept as history for anyone reading old builds/PRs.

**Key files (since removed):**

- `.buildkite/pipeline.yml` — Bootstrap: single step runs TypeScript generator
- `scripts/ci/src/main.ts` — Pipeline generator entry (change detection → build → JSON)
- `scripts/ci/src/change-detection.ts` — Queries BuildKite API for last green build, git diff
- `scripts/ci/src/lib/buildkite.ts` — Step types, retry config, Dagger env
- `scripts/ci/src/lib/k8s-plugin.ts` — K8s plugin builder with resource tiers
- `scripts/ci/src/catalog.ts` — Registry of 13 images, 4 npm pkgs, 7 sites, 29 Helm charts

**Patterns:**

- All CI work via `dagger call` (lint, typecheck, test, push-image, helm-package, etc.)
- Resource tiers: heavy (1000m/2Gi), medium (500m/1Gi), default (250m/512Mi)
- Dagger engine: remote `tcp://dagger-engine.dagger.svc.cluster.local:8080`
- Agent: agent-stack-k8s Helm, max-in-flight=20, git mirrors, batch-low priority
- **Soft-fail gates** — `trivy-scan`, `knip-check`, and `semgrep-scan` are soft failures that do **not** block the quality gate. When the goal is "get CI green," focus on real build/test/lint/typecheck/deploy failures; don't burn time adding CVEs to `.trivyignore` or chasing knip findings.
- **Pushes to `main` cancel the running build** — Buildkite supersedes/cancels the in-flight `main` build on every new push, so a fix being validated at step 92/175 never gets a result. Batch small fixes into one commit and wait for the current build to reach the relevant steps before pushing again; don't push for formatting/trivial churn.
- **Don't eagerly merge `main` into open PRs** — only merge `origin/main` into a branch when GitHub reports it `CONFLICTING` (mergeStateStatus `DIRTY`). Proactive merges add PR noise and, because a merge touching `.dagger/` triggers a full "build everything" CI run, they're slow and expensive. For a branch missing one specific main fix, prefer a surgical `git cherry-pick <sha>` over a full merge.
- **`release` step gates only release-consuming work** — the `release` step runs release-please and is long-lived. Only steps that actually consume release metadata (npm publish, helm push, cooklang push, clauderon upload, version commit-back) should `depends_on: release`. Everything else should depend on `quality-gate` so unrelated work isn't bottlenecked behind release-please.
- **Cold Dagger cache → slow `bun install` that looks hung but isn't** — After a Dagger engine restart or unclean shutdown, the engine logs `dagql persistence store marked unclean; wiping and cold-starting` and deletes its **entire** build cache (100 GB+) before it will serve — that wipe alone is ~15-20 min of recursive delete I/O on the ZFS nvme build-cache pool (`zfspv-pool-nvme` on `torvalds`). On the resulting cold cache, every `bun install --frozen-lockfile` step (a small-file write storm) runs **3-8+ min instead of seconds**: ZFS serializes writes through txg syncs and small-file bursts hit txg backpressure, so the install parks in uninterruptible `D` state (`cv_wait_common`), the Buildkite log goes static, and the build looks wedged. **It is slow, not stuck.** Distinguish with `kubectl exec -n dagger dagger-dagger-helm-engine-0 -- sh -c "ps -eo pid,stat,etime,args | awk '\$2 ~ /^D/'"`: if the D-state PID **rotates** (a fresh `bun install` each check) or the pool's free space keeps moving, it's progressing. Only suspect a real wedge if ONE PID sits in `D` >10 min with zero log output **and** `df /var/lib/dagger` is flat. The pool is healthy and ~19% full — this is write-throughput contention, **not** corruption or capacity. **Do NOT force-restart the engine to "fix" a merely-slow build**: it triggers another full cold-cache wipe (unclean shutdown → cold start), which is strictly worse and kills all in-flight sessions. Concurrent install-heavy steps amplify it; the agent `max-in-flight` cap (reduced to 10) targets exactly this.

## Reference Files

- **`references/pipeline-yaml-full.md`** — Complete step type fields, matrix builds, notifications, retry, conditionals, concurrency
- **`references/plugins-and-hooks.md`** — Plugin syntax, all 13 hooks with execution order, artifact patterns
- **`references/api-reference.md`** — REST API, GraphQL API, bk CLI, agent CLI
- **`references/kubernetes-agent-stack.md`** — Pod spec patching, git mirrors, secrets, container build strategies
- **`references/advanced-features.md`** — Test Engine, Packages, Clusters, Security, 2025-2026 features
