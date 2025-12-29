---
description: Helm chart management for Kubernetes deployments
when_to_use: When user mentions Helm, charts, helm commands, values, releases, or Kubernetes packaging
---

# Helm Helper Agent

## What's New in Helm 4.x & 2025

- **OCI Registry Support**: Push/pull charts using `oci://` protocol to container registries
- **Server-Side Dry Run**: Full API validation with `--dry-run=server`
- **JSON Schema Validation**: Validate values with `values.schema.json`
- **Enhanced Diff**: Preview changes with `helm diff` plugin
- **Provenance & Signing**: Sigstore support for chart verification
- **Library Charts**: Reusable chart components with `type: library`

## Overview

Helm is the package manager for Kubernetes. Charts are packages containing Kubernetes resource definitions. Repositories store and share charts. Releases are instances of charts deployed to a cluster.

## CLI Commands

### Auto-Approved Commands

The following `helm` commands are auto-approved and safe to use:
- `helm list` - List releases
- `helm get` - Download release information
- `helm status` - Display release status
- `helm show` - Show chart information
- `helm search` - Search for charts
- `helm version` - Show version info
- `helm env` - Display client environment
- `helm history` - Fetch release history

### Chart Discovery

```bash
# Search Artifact Hub (public charts)
helm search hub nginx

# Search local repositories
helm search repo bitnami/nginx

# Show all versions
helm search repo bitnami/nginx --versions

# Search with version constraints
helm search repo bitnami/nginx --version "^10.0.0"
```

### Installation & Upgrades

```bash
# Basic install
helm install my-release bitnami/nginx

# Install with custom values file
helm install my-release bitnami/nginx -f values.yaml

# Install with inline values
helm install my-release bitnami/nginx --set replicaCount=3

# Install to specific namespace (create if missing)
helm install my-release bitnami/nginx -n production --create-namespace

# Dry run with server-side validation
helm install my-release bitnami/nginx --dry-run=server

# Install with wait and timeout
helm install my-release bitnami/nginx --wait --timeout 5m

# Atomic install (rollback on failure)
helm install my-release bitnami/nginx --atomic

# Install from OCI registry
helm install my-release oci://registry.example.com/charts/nginx --version 1.0.0
```

**Upgrade patterns**:
```bash
# Upgrade existing release
helm upgrade my-release bitnami/nginx -f values.yaml

# Install or upgrade (idempotent)
helm upgrade --install my-release bitnami/nginx

# Reuse previous values and add new ones
helm upgrade my-release bitnami/nginx --reuse-values --set image.tag=v2

# Reset to chart defaults
helm upgrade my-release bitnami/nginx --reset-values

# Rollback on upgrade failure
helm upgrade my-release bitnami/nginx --atomic

# Force replace resources
helm upgrade my-release bitnami/nginx --force
```

### Release Management

```bash
# View release history
helm history my-release

# Rollback to previous revision
helm rollback my-release

# Rollback to specific revision
helm rollback my-release 3

# Uninstall release
helm uninstall my-release

# Uninstall but keep history
helm uninstall my-release --keep-history
```

### Repository Management

```bash
# Add repository
helm repo add bitnami https://charts.bitnami.com/bitnami

# Update repository cache
helm repo update

# List repositories
helm repo list

# Remove repository
helm repo remove bitnami

# Add with credentials
helm repo add private https://charts.example.com --username user --password pass
```

### Chart Development

```bash
# Create new chart
helm create mychart

# Validate chart
helm lint mychart

# Render templates locally
helm template my-release mychart

# Render specific template
helm template my-release mychart --show-only templates/deployment.yaml

# Package chart
helm package mychart

# Package with specific version
helm package mychart --version 1.0.0

# Update dependencies
helm dependency update mychart

# List dependencies
helm dependency list mychart
```

### Information Commands

```bash
# Get all release info
helm get all my-release

# Get deployed values
helm get values my-release

# Get manifest (rendered templates)
helm get manifest my-release

# Get release notes
helm get notes my-release

# Get hooks
helm get hooks my-release

# Show chart info
helm show chart bitnami/nginx

# Show default values
helm show values bitnami/nginx

# Show README
helm show readme bitnami/nginx
```

## Common Workflows

### Install Chart with Custom Values

```bash
# 1. View available values
helm show values bitnami/nginx > default-values.yaml

# 2. Create custom values file
cat > my-values.yaml <<EOF
replicaCount: 3
service:
  type: LoadBalancer
resources:
  limits:
    cpu: 500m
    memory: 256Mi
EOF

# 3. Dry run to preview
helm install my-nginx bitnami/nginx -f my-values.yaml --dry-run=server

# 4. Install
helm install my-nginx bitnami/nginx -f my-values.yaml --atomic --wait
```

### Upgrade with Rollback Strategy

```bash
# 1. Check current status
helm status my-release

# 2. Preview changes (requires helm-diff plugin)
helm diff upgrade my-release bitnami/nginx -f new-values.yaml

# 3. Upgrade with automatic rollback on failure
helm upgrade my-release bitnami/nginx -f new-values.yaml --atomic --timeout 10m

# 4. If manual rollback needed
helm rollback my-release 0  # Previous revision
```

### Working with OCI Registries

```bash
# Login to registry
helm registry login registry.example.com

# Push chart to OCI registry
helm push mychart-1.0.0.tgz oci://registry.example.com/charts

# Pull chart
helm pull oci://registry.example.com/charts/mychart --version 1.0.0

# Install from OCI
helm install my-release oci://registry.example.com/charts/mychart --version 1.0.0

# Logout
helm registry logout registry.example.com
```

## Chart Development

### Template Syntax

```yaml
# Access values
{{ .Values.replicaCount }}

# Release information
{{ .Release.Name }}
{{ .Release.Namespace }}
{{ .Release.IsUpgrade }}

# Chart metadata
{{ .Chart.Name }}
{{ .Chart.Version }}

# Common functions
{{ .Values.name | quote }}
{{ .Values.name | upper }}
{{ default "nginx" .Values.image.name }}
{{ required "image.tag is required" .Values.image.tag }}

# Conditionals
{{- if .Values.ingress.enabled }}
# ingress config here
{{- end }}

# Loops
{{- range .Values.hosts }}
- {{ . | quote }}
{{- end }}
```

### Chart.yaml Structure

```yaml
apiVersion: v2
name: mychart
version: 1.0.0
appVersion: "1.16.0"
description: My Helm chart
type: application  # or "library"
keywords:
  - nginx
  - web
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
```

### Values Schema Validation

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["replicaCount"],
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "properties": {
        "repository": {"type": "string"},
        "tag": {"type": "string"}
      }
    }
  }
}
```

### Hooks

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-db-migrate
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  template:
    spec:
      containers:
      - name: migrate
        image: migrate:latest
        command: ["./migrate.sh"]
      restartPolicy: Never
```

Hook types: `pre-install`, `post-install`, `pre-delete`, `post-delete`, `pre-upgrade`, `post-upgrade`, `pre-rollback`, `post-rollback`, `test`

## Best Practices

1. **Always use `--atomic` for production** - Automatic rollback on failure
   ```bash
   helm upgrade --install my-release chart --atomic
   ```

2. **Pin chart versions** - Never use floating versions
   ```bash
   helm install my-release bitnami/nginx --version 15.0.0
   ```

3. **Use helm diff before upgrades**
   ```bash
   helm plugin install https://github.com/databus23/helm-diff
   helm diff upgrade my-release chart -f values.yaml
   ```

4. **Structure values files by environment**
   ```
   values.yaml          # defaults
   values-dev.yaml      # development overrides
   values-staging.yaml  # staging overrides
   values-prod.yaml     # production overrides
   ```

5. **Use library charts for shared components**
   ```yaml
   # Chart.yaml
   dependencies:
     - name: common
       version: 1.x.x
       repository: https://charts.bitnami.com/bitnami
   ```

6. **Template naming conventions**
   - Use `.yaml` extension for YAML output
   - Use `.tpl` for helper templates
   - Name files after the resource type: `deployment.yaml`, `service.yaml`

## Troubleshooting

### Failed Installation

```bash
# Check release status
helm status my-release

# Get detailed info
helm get all my-release

# Check events
kubectl get events --sort-by='.lastTimestamp'

# View rendered templates
helm get manifest my-release
```

### Pending Upgrades

```bash
# List all releases including pending
helm list --all

# Check for stuck releases
helm list --pending

# Force rollback
helm rollback my-release 0 --force
```

### Hook Failures

```bash
# List hooks
helm get hooks my-release

# Check hook job status
kubectl get jobs -l app.kubernetes.io/managed-by=Helm

# View hook logs
kubectl logs job/my-release-pre-upgrade
```

### Template Rendering Issues

```bash
# Debug template rendering
helm template my-release mychart --debug

# Validate with lint
helm lint mychart --strict

# Test with specific values
helm template my-release mychart -f values.yaml --validate
```

## Examples

### Example 1: Complete Deployment Workflow

```bash
#!/bin/bash
set -e

RELEASE="my-app"
CHART="./charts/my-app"
NAMESPACE="production"
VALUES="values-prod.yaml"

# Lint chart
helm lint "$CHART" -f "$VALUES" --strict

# Dry run
helm upgrade --install "$RELEASE" "$CHART" \
  -n "$NAMESPACE" \
  -f "$VALUES" \
  --dry-run=server

# Deploy with atomic
helm upgrade --install "$RELEASE" "$CHART" \
  -n "$NAMESPACE" \
  -f "$VALUES" \
  --atomic \
  --timeout 10m \
  --wait

# Verify
helm status "$RELEASE" -n "$NAMESPACE"
kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/instance="$RELEASE"
```

### Example 2: Multi-Environment Values

```bash
# Base values.yaml
replicaCount: 1
image:
  repository: nginx
  tag: "1.25"

# values-prod.yaml (overrides)
replicaCount: 3
resources:
  limits:
    cpu: 1
    memory: 512Mi

# Deploy to production
helm upgrade --install my-app ./chart \
  -f values.yaml \
  -f values-prod.yaml \
  -n production
```

### Example 3: Umbrella Chart Pattern

```yaml
# umbrella/Chart.yaml
apiVersion: v2
name: my-platform
version: 1.0.0
dependencies:
  - name: frontend
    version: "1.x.x"
    repository: "file://../frontend"
  - name: backend
    version: "1.x.x"
    repository: "file://../backend"
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
```

```bash
# Update dependencies
cd umbrella
helm dependency update

# Install entire platform
helm install my-platform . -f values.yaml
```

## When to Ask for Help

Ask the user for clarification when:
- The target namespace or cluster context is ambiguous
- Values file paths or chart locations are unclear
- Destructive operations (uninstall, rollback) need confirmation
- Version constraints conflict with requirements
- OCI registry credentials are needed
- Multiple releases match the criteria
