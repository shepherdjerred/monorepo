---
description: ArgoCD GitOps deployment management and troubleshooting
when_to_use: When user mentions ArgoCD, GitOps, application sync, or argocd commands
---

# ArgoCD Helper Agent

## Overview

This agent helps you work with ArgoCD for GitOps-based Kubernetes deployments, application synchronization, and declarative configuration management.

## CLI Commands

### Installation

```bash
# macOS
brew install argocd

# Linux
curl -sSL -o argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd
sudo mv argocd /usr/local/bin/
```

### Authentication

```bash
# Login to ArgoCD
argocd login argocd.example.com

# Login with token
argocd login argocd.example.com --auth-token=$ARGOCD_AUTH_TOKEN

# Login insecure (for testing)
argocd login localhost:8080 --insecure

# Get current context
argocd context
```

### Common Operations

**List applications**:
```bash
argocd app list
argocd app list -o wide
argocd app list --selector environment=production
```

**Get application details**:
```bash
argocd app get my-app
argocd app get my-app --refresh
argocd app get my-app -o yaml
```

**Sync application**:
```bash
# Sync application
argocd app sync my-app

# Sync with prune (remove resources not in git)
argocd app sync my-app --prune

# Sync specific resource
argocd app sync my-app --resource Deployment:my-deployment

# Dry run
argocd app sync my-app --dry-run
```

**Rollback**:
```bash
# List history
argocd app history my-app

# Rollback to specific revision
argocd app rollback my-app 5
```

**Diff application**:
```bash
# Show diff between git and cluster
argocd app diff my-app

# Diff specific revision
argocd app diff my-app --revision HEAD
```

## Application Management

### Creating Applications

**Via CLI**:
```bash
argocd app create my-app \
  --repo https://github.com/myorg/myrepo \
  --path manifests \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace default \
  --sync-policy automated \
  --auto-prune \
  --self-heal
```

**Via YAML**:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/myrepo
    targetRevision: HEAD
    path: manifests
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

Apply with:
```bash
kubectl apply -f application.yaml
```

### Sync Policies

**Enable auto-sync**:
```bash
argocd app set my-app --sync-policy automated
```

**Enable auto-prune**:
```bash
argocd app set my-app --auto-prune
```

**Enable self-heal**:
```bash
argocd app set my-app --self-heal
```

**Disable auto-sync**:
```bash
argocd app set my-app --sync-policy none
```

## Application Status

### Health and Sync Status

```bash
# Get application status
argocd app get my-app --show-operation

# Watch sync status
argocd app wait my-app --health

# Get sync windows
argocd app get my-app --show-sync-windows
```

### Resource Status

```bash
# List resources
argocd app resources my-app

# Get specific resource
argocd app manifests my-app | kubectl get -f - deployment/my-deployment

# Check resource diff
argocd app diff my-app
```

## Projects

**List projects**:
```bash
argocd proj list
```

**Create project**:
```bash
argocd proj create my-project \
  --description "My Project" \
  --src "https://github.com/myorg/*" \
  --dest "https://kubernetes.default.svc,*" \
  --allow-cluster-resource "*"
```

**Add destination**:
```bash
argocd proj add-destination my-project \
  https://kubernetes.default.svc \
  my-namespace
```

**Add source repo**:
```bash
argocd proj add-source my-project \
  https://github.com/myorg/myrepo
```

## Repository Management

**List repos**:
```bash
argocd repo list
```

**Add repo**:
```bash
# HTTPS
argocd repo add https://github.com/myorg/myrepo \
  --username myuser \
  --password mytoken

# SSH
argocd repo add git@github.com:myorg/myrepo.git \
  --ssh-private-key-path ~/.ssh/id_rsa
```

**Remove repo**:
```bash
argocd repo rm https://github.com/myorg/myrepo
```

## Common Workflows

### Deploy New Application

```bash
#!/bin/bash

APP_NAME="my-app"
REPO_URL="https://github.com/myorg/myrepo"
PATH="k8s/overlays/production"
NAMESPACE="production"

# Create application
argocd app create "$APP_NAME" \
  --repo "$REPO_URL" \
  --path "$PATH" \
  --dest-namespace "$NAMESPACE" \
  --dest-server https://kubernetes.default.svc \
  --sync-policy automated \
  --auto-prune \
  --self-heal

# Wait for sync
argocd app wait "$APP_NAME" --health

# Check status
argocd app get "$APP_NAME"
```

### Troubleshoot Sync Issues

```bash
#!/bin/bash

APP=$1

echo "=== Application Status ==="
argocd app get "$APP"

echo "\n=== Sync Diff ==="
argocd app diff "$APP"

echo "\n=== Recent Events ==="
kubectl get events -n argocd --field-selector involvedObject.name="$APP"

echo "\n=== Application Logs ==="
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller \
  --tail=50 | grep "$APP"
```

### Bulk Sync Applications

```bash
#!/bin/bash

# Sync all applications with label
argocd app list -l environment=production -o name | \
  xargs -I {} argocd app sync {}

# Or use selector directly
argocd app sync -l environment=production
```

## Advanced Features

### Sync Hooks

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
      - name: migrate
        image: migrate:latest
        command: ["./migrate.sh"]
      restartPolicy: Never
```

Hook types:
- `PreSync` - Before sync
- `Sync` - During sync
- `PostSync` - After sync
- `SyncFail` - On sync failure
- `Skip` - Skip resource

### Sync Waves

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  annotations:
    argocd.argoproj.io/sync-wave: "0"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  annotations:
    argocd.argoproj.io/sync-wave: "1"
```

Lower waves sync first.

### App of Apps Pattern

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: apps
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/gitops
    path: apps
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
```

### Resource Hooks

```yaml
metadata:
  annotations:
    # Skip resource from sync
    argocd.argoproj.io/sync-options: Prune=false

    # Force resource replacement
    argocd.argoproj.io/sync-options: Replace=true

    # Respect ignore differences
    argocd.argoproj.io/compare-options: IgnoreExtraneous
```

## Best Practices

1. **Use Projects**: Organize apps into projects for RBAC
2. **Auto-Sync**: Enable automated sync for stable environments
3. **Prune Carefully**: Test prune behavior before enabling
4. **Sync Windows**: Use sync windows for maintenance periods
5. **Hooks**: Use PreSync hooks for database migrations
6. **Waves**: Order resource creation with sync waves
7. **Health Checks**: Define custom health checks for CRDs

## Examples

### Example 1: Complete App Deployment

```bash
#!/bin/bash
set -e

APP="web-app"
ENV="production"

echo "Deploying $APP to $ENV"

# Create application
argocd app create "$APP" \
  --repo https://github.com/myorg/apps \
  --path "apps/$APP/overlays/$ENV" \
  --dest-namespace "$APP-$ENV" \
  --dest-server https://kubernetes.default.svc \
  --project default \
  --sync-policy automated \
  --auto-prune \
  --self-heal \
  --sync-option CreateNamespace=true

# Wait for healthy
argocd app wait "$APP" --health --timeout 300

# Verify deployment
kubectl get all -n "$APP-$ENV"

echo "Deployment complete!"
```

### Example 2: Application Health Check

```bash
#!/bin/bash

# Check all applications health
argocd app list -o json | \
  jq -r '.[] | select(.status.health.status != "Healthy") |
    "\(.metadata.name): \(.status.health.status)"'
```

### Example 3: Rollback on Failure

```bash
#!/bin/bash

APP=$1

# Try to sync
if ! argocd app sync "$APP" --timeout 300; then
  echo "Sync failed, rolling back..."

  # Get previous successful revision
  PREV_REV=$(argocd app history "$APP" | \
    grep "Succeeded" | tail -2 | head -1 | awk '{print $1}')

  # Rollback
  argocd app rollback "$APP" "$PREV_REV"

  echo "Rolled back to revision $PREV_REV"
  exit 1
fi
```

## Troubleshooting

### Sync Issues

```bash
# Check application controller logs
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller

# Check repo server logs
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-repo-server

# Force refresh
argocd app get my-app --refresh --hard-refresh
```

### Out of Sync

```bash
# Show diff
argocd app diff my-app

# Show live vs desired state
argocd app manifests my-app
```

### Permission Issues

```bash
# Check project permissions
argocd proj get my-project

# Check RBAC
argocd account can-i sync applications '*'
```

## When to Ask for Help

Ask the user for clarification when:
- ArgoCD server URL or credentials are not specified
- Application name or namespace is ambiguous
- Repository URL or path needs confirmation
- Sync strategy (auto vs manual) is unclear
- Destructive operations like prune need confirmation
- Multiple clusters/destinations are involved
