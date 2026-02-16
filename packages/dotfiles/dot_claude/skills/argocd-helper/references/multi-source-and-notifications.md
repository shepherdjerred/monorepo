# Multi-Source Applications

Combine multiple sources in a single application:

## Helm Chart with Values from Git

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

## Multiple Helm Charts

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

## Kustomize with Remote Base

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

# Notifications

Configure ArgoCD notifications for sync events.

## Install Notifications Controller

```bash
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/notifications_catalog/install.yaml
```

## Configure Slack Integration

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

## Subscribe Applications to Notifications

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

## Common Notification Triggers

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
