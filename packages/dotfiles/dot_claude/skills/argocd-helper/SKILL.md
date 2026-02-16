---
name: argocd-helper
description: |
  ArgoCD GitOps deployment management and troubleshooting
  When user mentions ArgoCD, GitOps, application sync, or argocd commands
---

# ArgoCD Helper Agent

## What's New in ArgoCD 2.13+ & 2025

- **ApplicationSets**: Templated application generation across clusters, repos, and environments
- **Multi-Source Applications**: Combine multiple repos/charts in a single Application
- **Server-Side Diff**: More accurate diff calculations with live cluster state
- **Progressive Rollouts**: ApplicationSet rollout strategies with canary deployments
- **Improved Notifications**: Native notifications controller with triggers and templates
- **Enhanced RBAC**: Fine-grained permissions with project-scoped roles
- **Config Management Plugins v2**: Sidecar-based plugins for custom tooling
- **Resource Tracking**: Improved annotation-based resource tracking

## Overview

This agent helps you work with ArgoCD for GitOps-based Kubernetes deployments, application synchronization, and declarative configuration management.

## Auto-Approved Commands

Safe read-only commands that don't require confirmation:
- `argocd app list` - List applications
- `argocd app get` - Get application details
- `argocd app diff` - Show diff between git and cluster
- `argocd app history` - Show application history
- `argocd app manifests` - Show application manifests
- `argocd app resources` - List application resources
- `argocd proj list` - List projects
- `argocd proj get` - Get project details
- `argocd repo list` - List repositories
- `argocd cluster list` - List clusters
- `argocd context` - Show current context
- `argocd account get-user-info` - Show current user info
- `argocd version` - Show version information

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

## ApplicationSets

ApplicationSets automate the generation of ArgoCD Applications using templating and generators.

### List Generator

Generate applications from a static list:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: cluster-apps
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - cluster: production
            url: https://prod.k8s.example.com
          - cluster: staging
            url: https://staging.k8s.example.com
  template:
    metadata:
      name: '{{cluster}}-app'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/apps
        path: 'overlays/{{cluster}}'
        targetRevision: HEAD
      destination:
        server: '{{url}}'
        namespace: app
```

### Cluster Generator

Auto-discover clusters registered in ArgoCD:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: cluster-addons
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            env: production
  template:
    metadata:
      name: '{{name}}-monitoring'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/cluster-addons
        path: monitoring
      destination:
        server: '{{server}}'
        namespace: monitoring
```

### Git Generator (Directory)

Generate apps from directories in a git repo:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: apps-from-dirs
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/myorg/apps
        revision: HEAD
        directories:
          - path: apps/*
          - path: apps/excluded
            exclude: true
  template:
    metadata:
      name: '{{path.basename}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/apps
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: '{{path.basename}}'
```

### Git Generator (Files)

Generate apps from config files:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: apps-from-files
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/myorg/config
        revision: HEAD
        files:
          - path: "apps/**/config.json"
  template:
    metadata:
      name: '{{name}}'
    spec:
      project: '{{project}}'
      source:
        repoURL: '{{repoURL}}'
        path: '{{path}}'
        targetRevision: '{{revision}}'
      destination:
        server: '{{cluster.server}}'
        namespace: '{{namespace}}'
```

### Matrix Generator

Combine multiple generators:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: matrix-apps
  namespace: argocd
spec:
  generators:
    - matrix:
        generators:
          - clusters:
              selector:
                matchLabels:
                  env: production
          - list:
              elements:
                - app: frontend
                  port: "80"
                - app: backend
                  port: "8080"
  template:
    metadata:
      name: '{{name}}-{{app}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/apps
        path: '{{app}}'
      destination:
        server: '{{server}}'
        namespace: '{{app}}'
```

### Progressive Rollout Strategy

Roll out changes progressively across clusters:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: progressive-rollout
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - cluster: canary
            url: https://canary.k8s.example.com
          - cluster: production-1
            url: https://prod1.k8s.example.com
          - cluster: production-2
            url: https://prod2.k8s.example.com
  strategy:
    type: RollingSync
    rollingSync:
      steps:
        - matchExpressions:
            - key: cluster
              operator: In
              values: [canary]
        - matchExpressions:
            - key: cluster
              operator: In
              values: [production-1]
          maxUpdate: 1
        - matchExpressions:
            - key: cluster
              operator: In
              values: [production-2]
  template:
    metadata:
      name: '{{cluster}}-app'
      labels:
        cluster: '{{cluster}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/myorg/app
        path: k8s
      destination:
        server: '{{url}}'
        namespace: app
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

## Multi-Source Applications

Combine multiple sources in a single application:

### Helm Chart with Values from Git

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: multi-source-app
  namespace: argocd
spec:
  project: default
  sources:
    # Helm chart from external repo
    - repoURL: https://charts.example.com
      chart: my-app
      targetRevision: 1.2.3
      helm:
        valueFiles:
          - $values/overlays/production/values.yaml
    # Values from git repo
    - repoURL: https://github.com/myorg/config
      targetRevision: HEAD
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: my-app
```

### Multiple Helm Charts

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: platform
  namespace: argocd
spec:
  project: default
  sources:
    - repoURL: https://prometheus-community.github.io/helm-charts
      chart: kube-prometheus-stack
      targetRevision: 45.0.0
      helm:
        releaseName: monitoring
    - repoURL: https://grafana.github.io/helm-charts
      chart: loki-stack
      targetRevision: 2.9.0
      helm:
        releaseName: logging
  destination:
    server: https://kubernetes.default.svc
    namespace: observability
```

### Kustomize with Remote Base

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kustomize-multi
  namespace: argocd
spec:
  project: default
  sources:
    - repoURL: https://github.com/myorg/base-manifests
      targetRevision: v1.0.0
      path: base
      ref: base
    - repoURL: https://github.com/myorg/overlays
      targetRevision: HEAD
      path: production
      kustomize:
        components:
          - $base
  destination:
    server: https://kubernetes.default.svc
    namespace: app
```

## Notifications

Configure ArgoCD notifications for sync events.

### Install Notifications Controller

```bash
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/notifications_catalog/install.yaml
```

### Configure Slack Integration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  service.slack: |
    token: $slack-token
  template.app-sync-status: |
    message: |
      Application {{.app.metadata.name}} sync status: {{.app.status.sync.status}}
      Health: {{.app.status.health.status}}
      {{if .app.status.operationState}}
      Message: {{.app.status.operationState.message}}
      {{end}}
  trigger.on-sync-succeeded: |
    - when: app.status.operationState.phase in ['Succeeded']
      send: [app-sync-status]
  trigger.on-sync-failed: |
    - when: app.status.operationState.phase in ['Error', 'Failed']
      send: [app-sync-status]
  trigger.on-health-degraded: |
    - when: app.status.health.status == 'Degraded'
      send: [app-sync-status]
---
apiVersion: v1
kind: Secret
metadata:
  name: argocd-notifications-secret
  namespace: argocd
stringData:
  slack-token: xoxb-your-slack-token
```

### Subscribe Applications to Notifications

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.slack: my-channel
    notifications.argoproj.io/subscribe.on-sync-failed.slack: my-channel
    notifications.argoproj.io/subscribe.on-health-degraded.slack: alerts-channel
spec:
  # ... application spec
```

### Common Notification Triggers

```yaml
# Trigger on any sync operation
trigger.on-sync-running: |
  - when: app.status.operationState.phase in ['Running']
    send: [app-sync-running]

# Trigger on new deployment
trigger.on-deployed: |
  - when: app.status.operationState.phase in ['Succeeded'] and app.status.health.status == 'Healthy'
    send: [app-deployed]

# Trigger on out of sync
trigger.on-sync-status-unknown: |
  - when: app.status.sync.status == 'OutOfSync'
    send: [app-out-of-sync]
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

### Complete Debugging Workflow

```bash
#!/bin/bash
APP=$1

echo "=== Application Status ==="
argocd app get "$APP"

echo -e "\n=== Sync Status ==="
argocd app get "$APP" --show-operation

echo -e "\n=== Resource Health ==="
argocd app resources "$APP" | grep -v Healthy

echo -e "\n=== Diff (Git vs Cluster) ==="
argocd app diff "$APP" 2>&1 | head -50

echo -e "\n=== Recent Events ==="
kubectl get events -n argocd --field-selector involvedObject.name="$APP" --sort-by='.lastTimestamp' | tail -20

echo -e "\n=== Application Controller Logs ==="
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller --tail=30 | grep -i "$APP"
```

### Sync Issues

```bash
# Check application controller logs
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller --tail=100

# Check repo server logs (manifest generation issues)
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-repo-server --tail=100

# Check server logs (API issues)
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-server --tail=100

# Force hard refresh (clear cache)
argocd app get my-app --refresh --hard-refresh

# Terminate stuck sync operation
argocd app terminate-op my-app
```

### Out of Sync

```bash
# Show diff between git and cluster
argocd app diff my-app

# Show live vs desired state
argocd app manifests my-app

# Check for ignored differences (false positives)
argocd app get my-app -o yaml | grep -A 20 ignoreDifferences

# Sync specific resources only
argocd app sync my-app --resource Deployment:my-deployment
argocd app sync my-app --resource :ConfigMap:my-config
```

### Resource Health Issues

```bash
# List unhealthy resources
argocd app resources my-app | grep -v Healthy

# Get details on specific resource
argocd app resources my-app --kind Deployment --name my-deployment

# Check pod status directly
kubectl get pods -n my-namespace -l app=my-app
kubectl describe pod -n my-namespace <pod-name>
```

### Repository Connection Issues

```bash
# Test repository access
argocd repo list
argocd repo get https://github.com/myorg/myrepo

# Check repo server logs for auth errors
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-repo-server | grep -i error

# Re-add repository with credentials
argocd repo rm https://github.com/myorg/myrepo
argocd repo add https://github.com/myorg/myrepo --username user --password token
```

### Cluster Connection Issues

```bash
# List clusters and check connectivity
argocd cluster list

# Get cluster details
argocd cluster get https://my-cluster.example.com

# Check application controller for cluster errors
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller | grep -i "cluster"

# Re-register cluster
argocd cluster rm https://my-cluster.example.com
argocd cluster add my-context --name my-cluster
```

### RBAC and Permission Issues

```bash
# Check current user permissions
argocd account can-i sync applications '*'
argocd account can-i get applications '*'
argocd account can-i create applications 'my-project/*'

# Check project permissions
argocd proj get my-project

# List project roles
argocd proj role list my-project

# Check RBAC ConfigMap
kubectl get configmap argocd-rbac-cm -n argocd -o yaml
```

### Common Error Messages

**"ComparisonError"**:
```bash
# Usually a manifest generation issue
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-repo-server | grep -i error
# Check if helm/kustomize is failing
argocd app manifests my-app --source live
```

**"Unable to create application"**:
```bash
# Check project source/destination restrictions
argocd proj get my-project
argocd proj add-source my-project https://github.com/myorg/myrepo
argocd proj add-destination my-project https://kubernetes.default.svc my-namespace
```

**"Sync failed: failed to sync cluster"**:
```bash
# Check cluster connectivity
argocd cluster get https://my-cluster
kubectl --context my-cluster get nodes
# Check for RBAC issues in target cluster
kubectl --context my-cluster auth can-i create deployments -n my-namespace
```

**"Unknown revision"**:
```bash
# Force refresh repository cache
argocd app get my-app --hard-refresh
# Check if branch/tag exists
git ls-remote https://github.com/myorg/myrepo refs/heads/my-branch
```

### Performance Issues

```bash
# Check controller queue depth
kubectl exec -n argocd deploy/argocd-application-controller -- argocd-application-controller --metrics-port 8082 &
kubectl port-forward -n argocd svc/argocd-metrics 8082:8082 &
curl localhost:8082/metrics | grep workqueue

# Check repo server cache
kubectl exec -n argocd deploy/argocd-repo-server -- ls -la /tmp

# Scale components for high app count
kubectl scale -n argocd deploy/argocd-repo-server --replicas=3
kubectl scale -n argocd deploy/argocd-application-controller --replicas=2
```

### Recovery Operations

```bash
# Terminate stuck sync
argocd app terminate-op my-app

# Force sync even with errors
argocd app sync my-app --force

# Reset application to a known state
argocd app rollback my-app <revision>

# Delete and recreate stuck application
argocd app delete my-app --cascade=false  # Keep resources
argocd app create my-app ...  # Recreate with same settings
```

## When to Ask for Help

Ask the user for clarification when:
- ArgoCD server URL or credentials are not specified
- Application name or namespace is ambiguous
- Repository URL or path needs confirmation
- Sync strategy (auto vs manual) is unclear
- Destructive operations like prune need confirmation
- Multiple clusters/destinations are involved
