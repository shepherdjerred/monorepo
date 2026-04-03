# Plugins and Hooks

## Using Plugins

```yaml
steps:
  - command: "test.sh"
    plugins:
      - docker#v5.13.0:
          image: "node:18"
          environment:
            - "NODE_ENV=test"
      - artifacts#v1.9.4:
          upload: "logs/**/*"
```

Plugin format: `org/name#version` or `name#version` (official). Evaluated in order. Multiple plugins can be combined on one step.

## Writing Custom Plugins

```
my-plugin/
├── hooks/
│   ├── environment      # Export secrets/config
│   ├── pre-command       # Setup before command
│   ├── command           # Override default command
│   └── post-command      # Cleanup after command
├── plugin.yml            # Schema definition
├── README.md
└── tests/
```

Plugin hooks are shell scripts (or any executable with v3.85.0+ polyglot support).

## Agent Hooks

### Agent Lifecycle (self-hosted only)

| Hook | When |
|------|------|
| `agent-startup` | Before agent registers (v3.42.0+) |
| `agent-shutdown` | When agent shuts down |

### Job Lifecycle (execution order)

| # | Hook | Scopes | Description |
|---|------|--------|-------------|
| 1 | `pre-bootstrap` | Agent | Before job starts. Exit 0 = permit, non-zero = reject |
| 2 | `environment` | Agent, Plugin (non-vendored) | Export secrets/config. Runs before all other job hooks |
| 3 | `pre-checkout` | Agent, Plugin (non-vendored) | Before git checkout |
| 4 | `checkout` | Plugin (non-vendored), Agent | Override default checkout. Only first one runs |
| 5 | `post-checkout` | Agent, Repository, Plugin (non-vendored) | After checkout completes |
| 6 | `environment` | Plugin (vendored) | Vendored plugin env hooks run after checkout |
| 7 | `pre-command` | Agent, Repository, Plugin (all) | Before build command |
| 8 | `command` | Plugin (all), Repository, Agent | Override default command. Only first one runs |
| 9 | `post-command` | Agent, Repository, Plugin (all) | After command completes |
| 10 | `pre-artifact` | Agent, Repository, Plugin (all) | Before artifact upload (if paths defined) |
| 11 | `post-artifact` | Agent, Repository, Plugin (all) | After artifact upload |
| 12 | `pre-exit` | Agent, Repository, Plugin (all) | Cleanup. Exit code replaces job exit code |

### Hook Scopes

- **Agent hooks**: On agent filesystem (`hooks-path`). Run for every job.
- **Repository hooks**: In `.buildkite/hooks/` in repo. Run for every pipeline using that repo.
- **Plugin hooks**: In plugin's `hooks/` dir. Only run for steps using that plugin.

### Hook Failure Behavior

- Pre-command hook failure → command phase does NOT run
- Post-command hook failure → job fails but command already executed
- `pre-exit` exit code replaces command exit code as final result

### Polyglot Hooks (v3.85.0+)

Hooks can be any executable (Python, Ruby, Go, Rust, etc.):
- Interpreted: must have valid shebang (`#!/usr/bin/env python3`)
- Binary: must be executable by agent user
- Extra env vars: `BUILDKITE_HOOK_PHASE`, `BUILDKITE_HOOK_PATH`, `BUILDKITE_HOOK_SCOPE`
- Caveat: environment variable changes NOT auto-captured (use Job API)

## Artifacts

### Upload
```bash
# From step config
artifact_paths: "dist/**/*;coverage/**/*"

# From command
buildkite-agent artifact upload "report.html"
buildkite-agent artifact upload "logs/**/*" --job "other-job-id"

# To custom destination
buildkite-agent artifact upload "pkg/*" "s3://my-bucket/builds/${BUILDKITE_BUILD_ID}"
```

### Download
```bash
buildkite-agent artifact download "dist/*" ./local/
buildkite-agent artifact download "report.html" . --step "build-step"
buildkite-agent artifact download "*" . --build "build-uuid"
```

### Embed in Annotations
```bash
buildkite-agent artifact upload "screenshot.png"
echo '<img src="artifact://screenshot.png" height=250>' | buildkite-agent annotate --style info
echo '<a href="artifact://coverage/index.html">Coverage Report</a>' | buildkite-agent annotate
```

### Storage Backends
Default: Buildkite-managed storage. Custom: S3 (`s3://bucket/path`), GCS (`gs://bucket/path`). Configure via `BUILDKITE_ARTIFACT_UPLOAD_DESTINATION` or `artifact_upload_destination` agent config.
