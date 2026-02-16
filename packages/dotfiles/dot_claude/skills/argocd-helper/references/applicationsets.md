# ApplicationSets

ApplicationSets automate the generation of ArgoCD Applications using templating and generators.

## List Generator

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

## Cluster Generator

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

## Git Generator (Directory)

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

## Git Generator (Files)

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

## Matrix Generator

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

## Progressive Rollout Strategy

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
