# Advanced Features

## Test Engine

BuildKite Test Engine collects, analyzes, and visualizes test results across CI runs.

### Key Features

- **Flaky test detection & quarantine**: Identify and quarantine flaky tests to prevent blocking builds
- **Test ownership**: Assign team ownership to tests
- **Test suites**: Organize with state tracking, tags, labels, saved views
- **Native collectors**: Android, Elixir, Go, JavaScript, .NET, Python, Ruby, Rust, Swift
- **Import formats**: JUnit XML, JSON, custom collectors
- **Workflows (Preview)**: Monitors and Actions for automated test management
- **Integrations**: Linear issue tracking, email notifications

### Test Splitting (bktec)

The `bktec` CLI distributes tests across parallel agents using historical timing data:

```bash
# Basic usage with RSpec
bktec --test-cmd "bundle exec rspec {{testExamples}}" \
  --test-file-pattern "spec/**/*_spec.rb"

# pytest with tag filters
bktec --test-cmd "pytest {{testExamples}}" \
  --test-file-pattern "tests/**/*.py" \
  --tag-filters "test.type:integration"

# Custom runner (v2.1.0+)
bktec --test-cmd "my-runner {{testExamples}}" \
  --test-file-pattern "tests/**/*"
```

Features (v2.1.0):

- Custom test runner support (any runner accepting file path args)
- Split slow pytest files by individual example
- Tag filters for selective test execution

## Package Registries

Managed artifact/package hosting integrated into CI/CD.

### Supported Ecosystems (15+)

- **Linux**: Alpine (apk), Debian (deb), Red Hat (rpm)
- **Container/Helm**: OCI, Helm (OCI-based and standard)
- **Languages**: JavaScript (npm), Python (PyPI), Ruby (gems), Java (Maven/Gradle), NuGet (.NET), Terraform
- **ML**: Hugging Face (preview)
- **Generic**: Files

### Features

- **Private storage link**: Store packages in your own S3 or GCS (preview)
- **Migration tools**: Import from JFrog Artifactory, Cloudsmith, Packagecloud
- **Security**: OIDC authentication, permissions management, SLSA provenance
- **Registry management**: Per-ecosystem configuration

## Clusters

Organizational units grouping agents and queues for isolation.

- **Per-cluster agent tokens**: Separate registration tokens per cluster
- **Rules**: Control which pipelines can use which clusters
- **Queue management**: Each cluster has its own queues; pause/resume supported
- **Cluster maintainers**: Designated users for cluster configuration
- **Insights**: Cluster-level metrics and queue health
- **Migration path**: Documentation for unclustered → clustered agents

## Security

### Buildkite Secrets

Access-controlled secrets with policies. Agent v3.81+ supports `buildkite-agent secret get`.

```yaml
# In pipeline YAML
secrets:
  - GH_TOKEN
  - name: CUSTOM_VAR
    secret: my-secret-name
```

### OIDC

Native OIDC support for AWS and Azure — no static credentials needed:

```bash
OIDC_TOKEN=$(buildkite-agent oidc request-token --audience "https://sts.amazonaws.com")
```

Tokens auto-redacted from build logs (agent v3.104+).

### Signed Pipelines

Pipeline step signing to prevent tampering. Configure via `signing-jwks-file` and `verification-jwks-file` agent config.

### Audit Log

Enterprise feature. GraphQL API: `auditEvent` query with `AuditEvent`, `AuditActor`, `AuditSubject` objects. Tracks web UI, REST API, and agent API actions.

### Agent Security Options

```ini
no-command-eval=true           # Block arbitrary commands (only scripts)
no-plugins=true                # Disable plugins
no-local-hooks=true            # Disable repo hooks
allowed-repositories=^git@github\.com:org/.*  # Regex allowlist
allowed-plugins=^org/.*        # Regex allowlist
```

## Recent Features (2025-2026)

### AI/Agentic

- **MCP Server**: Prompt injection protection (invisible char filtering, control sequence stripping, HTML sanitization, LLM delimiter neutralization). `list_builds` no longer requires `pipeline_slug`. `--max-log-bytes` flag (default 100MB). Per-user rate limiting at 50 req/min.
- **Agentic Workflows**: Top-level platform capability for AI-powered CI.

### Build UI

- **Job-scoped annotations** (v3.112+): `buildkite-agent annotate --scope job`. Jobs show annotation indicators.
- **Run durations on canvas nodes**: Steps display duration directly.
- **Collapsed group steps**: Groups collapsed by default; auto-expand on failure. Press G to toggle.
- **Case-sensitive log search**: Toggle in job log search bar.

### Security & Auth

- **API token expiry**: 1d, 7d, 30d, 90d, 1y, custom, never. Email 3 days before expiry.
- **CLI OAuth auth** (v3.32.0+): `bk auth login`. Tokens in OS keychain (no plaintext).
- **OIDC token auto-redaction** (v3.104+): Automatic log redaction via Job API.

### SDK & Multi-Cloud

- **Buildkite SDK**: C# support (v0.8.0, NuGet). Also JS/TS, Python, Go, Ruby. Type-safe pipeline definitions.
- **GCP + Azure plugin support**: `secrets`, `cache`, `docker-cache`, `docker-image-push` plugins. New `azure-login` plugin.

### Dynamic Pipelines

- **`if_changed`**: Path-based conditional step generation (agent-applied, not upload-time).
- **Buildkite SDK preview**: Programmatic pipeline definition (alternative to YAML).

### Platform

- **Step state: canceled**: Returns `state: "canceled"` instead of errored (distinguishable from timeouts).
- **Service quotas dashboard**: Org Settings > Quotas.
- **Elastic CI Stack → K8s migration**: Comprehensive docs for ECR auth, hooks, secrets, Docker daemon.
- **CircleCI pipeline converter**: Translate CircleCI workflows to BuildKite.

### Test Engine

- **bktec v2.1.0**: Custom runner support, split slow files by example, tag filters.
- **Saved views**: Quick-access filtered views on Suite Summary page.
