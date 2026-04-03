# Pipeline YAML Full Reference

## Command Step — All Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` / `commands` | `string \| string[]` | — | Shell command(s) to run |
| `label` | `string` | — | Display label (supports emoji) |
| `key` / `identifier` | `string` | — | Unique step ID (cannot be UUID pattern) |
| `agents` | `map` | — | Agent tag targeting (e.g., `queue: default`) |
| `artifact_paths` | `string \| string[]` | — | Glob paths for artifact upload |
| `branches` | `string` | — | Branch pattern (e.g., `"main stable/*"`) |
| `cancel_on_build_failing` | `boolean` | `false` | Cancel job when build marked failing |
| `concurrency` | `integer` | — | Max concurrent jobs (requires `concurrency_group`) |
| `concurrency_group` | `string` | — | Org-wide concurrency label |
| `concurrency_method` | `string` | `ordered` | `ordered` (FIFO) or `eager` |
| `depends_on` | `string \| string[]` | — | Step key(s) to depend on |
| `allow_dependency_failure` | `boolean` | `false` | Run even if deps fail |
| `env` | `map` | — | Step environment variables |
| `secrets` | `string[] \| map` | — | Buildkite Secrets (names or env→secret map) |
| `if` | `string` | — | Boolean expression; omits when false |
| `if_changed` | `string \| object` | — | Glob; omits if no matching files changed |
| `image` | `string` | — | Container image (agent-stack-k8s, experimental) |
| `matrix` | `string[] \| object` | — | Matrix expansion |
| `parallelism` | `integer` | — | Number of parallel copies |
| `plugins` | `array` | — | Plugin configurations |
| `priority` | `integer` | — | Job priority (higher = first) |
| `retry` | `object` | — | `{automatic, manual}` retry config |
| `skip` | `boolean \| string` | — | Skip step (string = reason, max 70 chars) |
| `soft_fail` | `boolean \| array` | — | `true` or `[{exit_status: N}]` |
| `timeout_in_minutes` | `integer` | — | Max runtime |

## Wait Step

```yaml
- wait: ~                    # Explicit null recommended
  continue_on_failure: true  # Proceed after failure (NOT after cancellation)
  if: build.branch == "main"
  key: "deploy-gate"
```

Fields: `continue_on_failure`, `branches`, `if`, `depends_on`, `key`, `allow_dependency_failure`.

**Gotchas**: Block steps adjacent to wait steps cause the wait to be ignored. A regular wait blocking execution prevents subsequent `continue_on_failure` waits from running.

## Block Step

Creates **implicit dependencies** — subsequent steps wait for unblock.

```yaml
- block: ":rocket: Deploy?"
  blocked_state: passed        # passed | failed | running
  allowed_teams: ["deployers"]
  fields:
    - text: "Version"
      key: "version"
      hint: "Semantic version"
      required: true
      format: "[0-9]+\\.[0-9]+\\.[0-9]+"
    - select: "Environment"
      key: "env"
      options: [{ label: "Staging", value: "stg" }, { label: "Prod", value: "prod" }]
      multiple: false
```

Select display: <=6 single-select → radio buttons; >6 → dropdown; multiple → checkboxes.

## Input Step

Same as block but **no implicit dependencies** — other steps run while waiting for input.

```yaml
- input: "Release details"
  fields:
    - text: "Notes"
      key: "notes"
      required: false
```

## Trigger Step

```yaml
- trigger: "deploy-pipeline"
  async: true                    # true: fire-and-forget
  soft_fail: true                # Triggered build failure won't fail parent
  build:
    message: "${BUILDKITE_MESSAGE}"
    commit: "${BUILDKITE_COMMIT}"
    branch: "${BUILDKITE_BRANCH}"
    meta_data: { version: "1.0" }
    env: { DEPLOY: "true" }
```

**Warning**: Passing `BUILDKITE_PULL_REQUEST` in env causes PR ref checkout in triggered build.

## Group Step

```yaml
- group: ":test_tube: Tests"
  key: "tests"
  depends_on: "build"
  steps:
    - command: "unit.sh"
    - command: "integration.sh"
```

- No nested groups
- Consecutive groups run in parallel
- Wait steps inside groups are independent of other groups
- Groups with matching labels merge in UI from uploaded pipelines

## Retry Configuration

### Automatic
```yaml
retry:
  automatic:
    - exit_status: -1          # Agent lost
      limit: 2
    - exit_status: [1, 2, 3]   # Specific codes
      limit: 1
    - exit_status: "*"          # All non-zero (1-255)
      signal: SIGKILL
      signal_reason: agent_stop
      limit: 3                  # Max 10
```

Fields: `exit_status` (int/int[]/"*"), `signal` (string/"*"), `signal_reason` (none/cancel/agent_stop/agent_refused/agent_incompatible/process_run_error/signature_rejected/stack_error), `limit` (default 2, max 10). Each rule tracks independently.

### Manual
```yaml
retry:
  manual:
    allowed: false
    reason: "Deploys can't be retried"
    permit_on_passed: true
```

## Matrix Builds

### Single Dimension
```yaml
- label: "Test {{matrix}}"
  command: "test.sh {{matrix}}"
  matrix: ["linux", "darwin", "windows"]
```

### Multi-Dimensional
```yaml
- label: "{{matrix.os}}/{{matrix.arch}}"
  command: "build.sh"
  matrix:
    setup:
      os: ["linux", "darwin"]
      arch: ["amd64", "arm64"]
    adjustments:
      - with: { os: "darwin", arch: "arm64" }
        soft_fail: true
      - with: { os: "linux", arch: "riscv" }  # New combo
```

**Limits**: 6 dimensions, 25 elements/dim, 128 bytes/element, 12 adjustments, 50 jobs/matrix. Incompatible with `parallelism` on same step. Cannot use matrix values in `key` or `concurrency_group`.

## Notifications

Build-level (`notify` at same level as `steps`) or step-level (`notify` inside step).

| Type | Build | Step |
|------|:-----:|:----:|
| Slack | yes | yes |
| Email | yes | no |
| GitHub commit status | yes | yes |
| GitHub check | yes | yes |
| PagerDuty change event | yes | no |
| Webhook | yes | no |
| Basecamp Campfire | yes | yes |

```yaml
# Slack
notify:
  - slack: "#deploys"
  - slack:
      channels: ["#alerts", "#oncall"]
      message: "Build failed on ${BUILDKITE_BRANCH}"
    if: build.state == "failed"

# First failure / recovery
  - slack: "#builds"
    if: build.branch == "main" && pipeline.started_failing
  - slack: "#builds"
    if: build.branch == "main" && pipeline.started_passing

# GitHub commit status
  - github_commit_status:
      context: "ci/tests"

# GitHub check (requires GitHub App)
steps:
  - command: "lint.sh"
    notify:
      - github_check:
          name: "Linting"
          output:
            title: "Results"
            summary: "Found issues"
            annotations:
              - path: "src/main.js"
                start_line: 15
                annotation_level: "warning"  # notice | warning | failure
                message: "Missing semicolon"
```

Conditional variables: `build.state` (build-level only), `build.branch`, `pipeline.started_failing`, `pipeline.started_passing`, `step.outcome` (step-level: `hard_failed`/`soft_failed`/`passed`).

## Conditional Expressions

Evaluated at **upload time**. Full syntax:

```
build.branch == pipeline.default_branch
build.pull_request.id != null
build.tag =~ /^v[0-9]+\.[0-9]+/
build.message !~ /\[skip ci\]/i
build.source == "schedule"
build.env("CUSTOM_VAR") == "value"
build.pull_request.labels includes "deploy"
!build.pull_request.draft
build.creator.teams includes "platform"
```

Variables: `build.*` (branch, commit, message, source, tag, pull_request.*, merge_queue.*, author.*, creator.*, env(), id, number, state), `pipeline.*` (default_branch, id, repository, slug), `organization.*` (id, slug), `step.*` (notifications only).

## Concurrency

```yaml
- command: "deploy.sh"
  concurrency: 1
  concurrency_group: "app/deploy"  # Org-wide
  concurrency_method: ordered      # ordered (default, FIFO) | eager

# Concurrency gates pattern:
- command: "start-gate"
  concurrency_group: gate
  concurrency: 1
  key: start-gate
- wait: ~
- command: "parallel-work"
  parallelism: 5
  depends_on: start-gate
- wait: ~
- command: "end-gate"
  concurrency_group: gate
  concurrency: 1
```

Block/input steps prevent jobs from joining concurrency groups until unblocked.
