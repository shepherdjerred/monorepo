---
name: buildkite-helper
description: |
  BuildKite CI/CD pipeline configuration, YAML syntax, dynamic pipelines, and agent management
  When user works with BuildKite, mentions CI pipelines, .buildkite/ directory, buildkite-agent commands,
  pipeline YAML, build steps, BuildKite API, or asks about CI configuration, pipeline generation,
  step dependencies, retry configuration, agent queues, or Kubernetes CI agents
---

# BuildKite Helper

## Overview

BuildKite is a CI/CD platform where builds run on your own infrastructure via agents. Pipelines are defined in YAML (static or dynamically generated). This monorepo uses BuildKite as its sole CI platform with dynamic TypeScript pipeline generation and Dagger for all build steps.

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
- wait: ~                          # Waits for all previous steps
- wait: ~
  continue_on_failure: true        # Proceed even if prior steps failed
```

### Block Step (creates implicit dependencies)
```yaml
- block: ":rocket: Deploy?"
  prompt: "Ready to deploy?"
  blocked_state: passed            # passed | failed | running
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
  async: true                      # Don't wait for triggered build
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

**This monorepo**: TypeScript generator at `scripts/ci/src/main.ts` → change detection → JSON → `buildkite-agent pipeline upload`.

## Step Configuration

### Dependencies
```yaml
- command: "build.sh"
  key: "build"
- command: "test.sh"
  depends_on: "build"              # Single dependency
- command: "deploy.sh"
  depends_on: ["build", "test"]    # Multiple dependencies
  allow_dependency_failure: true    # Run even if deps fail
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
    - exit_status: -1              # Agent lost/timeout
      limit: 2
    - exit_status: "*"             # Any non-zero (1-255)
      limit: 1
  manual:
    permit_on_passed: true
```
Auto retry: `exit_status` (int/array/"*"), `signal`, `signal_reason`, `limit` (max 10).

### Concurrency
```yaml
- command: "deploy.sh"
  concurrency: 1
  concurrency_group: "app/deploy"  # Org-wide scope
  concurrency_method: ordered      # ordered (FIFO) | eager
```

### Other
```yaml
skip: "Temporarily disabled"       # Skip with reason (max 70 chars)
soft_fail: true                    # All non-zero exits are soft failures
priority: 1                        # Higher = dispatched first
timeout_in_minutes: 30
parallelism: 5                     # Run N parallel copies
matrix: ["linux", "darwin"]        # Expand step per value
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

| Variable | Description |
|----------|-------------|
| `BUILDKITE_BRANCH` | Branch being built |
| `BUILDKITE_COMMIT` | Git commit SHA |
| `BUILDKITE_MESSAGE` | Build message (commit msg) |
| `BUILDKITE_BUILD_NUMBER` | Build number (monotonic) |
| `BUILDKITE_BUILD_URL` | URL to build on Buildkite |
| `BUILDKITE_BUILD_ID` | Build UUID |
| `BUILDKITE_JOB_ID` | Job UUID |
| `BUILDKITE_PIPELINE_SLUG` | Pipeline slug |
| `BUILDKITE_ORGANIZATION_SLUG` | Organization slug |
| `BUILDKITE_PULL_REQUEST` | PR number or `false` |
| `BUILDKITE_PULL_REQUEST_BASE_BRANCH` | PR target branch or `""` |
| `BUILDKITE_TAG` | Tag name (if tag build) |
| `BUILDKITE_SOURCE` | `webhook`, `api`, `ui`, `trigger_job`, `schedule` |
| `BUILDKITE_PARALLEL_JOB` | Parallel job index (0-based) |
| `BUILDKITE_PARALLEL_JOB_COUNT` | Total parallel jobs |
| `BUILDKITE_RETRY_COUNT` | Times job has been retried |
| `BUILDKITE_STEP_KEY` | User-defined step key |
| `BUILDKITE_AGENT_ACCESS_TOKEN` | Agent session token |
| `BUILDKITE_TRIGGERED_FROM_BUILD_ID` | Parent build UUID |
| `BUILDKITE_REPO` | Repository URL |

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

## This Monorepo's CI Patterns

**Key files:**
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
- Kueue: ClusterQueue with 16 CPU/64Gi quota, FIFO ordering, no preemption
- Agent: agent-stack-k8s Helm, max-in-flight=20, git mirrors, batch-low priority

## Reference Files

- **`references/pipeline-yaml-full.md`** — Complete step type fields, matrix builds, notifications, retry, conditionals, concurrency
- **`references/plugins-and-hooks.md`** — Plugin syntax, all 13 hooks with execution order, artifact patterns
- **`references/api-reference.md`** — REST API, GraphQL API, bk CLI, agent CLI
- **`references/kubernetes-agent-stack.md`** — Pod spec patching, git mirrors, secrets, Kueue, container build strategies
- **`references/advanced-features.md`** — Test Engine, Packages, Clusters, Security, 2025-2026 features
