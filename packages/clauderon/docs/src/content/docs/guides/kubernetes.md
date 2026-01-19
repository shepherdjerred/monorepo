---
title: Kubernetes Backend
description: Running sessions in Kubernetes pods for cloud-native isolation
---

The Kubernetes backend runs AI agent sessions as pods in your Kubernetes cluster, providing enterprise-grade isolation and scalability.

## Requirements

- Kubernetes cluster (1.24+)
- kubectl configured with cluster access
- Storage class for persistent volumes
- Enable with `--enable-kubernetes-backend` flag

## Enabling the Backend

The Kubernetes backend is experimental and must be explicitly enabled:

```bash
# Via command line flag
clauderon daemon --enable-kubernetes-backend

# Or via environment variable
export CLAUDERON_FEATURE_ENABLE_KUBERNETES_BACKEND=1
clauderon daemon

# Or via config file
# ~/.clauderon/config.toml
[features]
kubernetes_backend = true
```

## Creating Sessions

```bash
clauderon create --backend kubernetes \
  --repo ~/project \
  --prompt "Deploy to staging"
```

## Configuration

Configure Kubernetes settings in `~/.clauderon/config.toml`:

```toml
[kubernetes]
# Namespace for pods (must exist)
namespace = "clauderon"

# Storage class for persistent volumes
storage_class = "standard"

# Image pull secrets (for private registries)
image_pull_secrets = ["my-registry-secret"]
```

## How It Works

When you create a Kubernetes session, clauderon:

1. Creates a PersistentVolumeClaim for the workspace
2. Creates a git worktree and syncs it to the PVC
3. Creates a Pod with the Claude Code image
4. Configures environment variables for proxy access
5. Starts the agent with your prompt

### Pod Specification

Sessions run as pods with:

- Single container running Claude Code
- PVC mounted at `/workspace`
- ConfigMap for CA certificate
- Service account for limited cluster access
- Resource requests and limits

## Namespace Setup

Create a namespace for clauderon sessions:

```bash
kubectl create namespace clauderon
```

### RBAC (Optional)

If sessions need to interact with Kubernetes resources:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: clauderon
  name: clauderon-session
rules:
- apiGroups: [""]
  resources: ["pods", "services", "configmaps"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  namespace: clauderon
  name: clauderon-session-binding
subjects:
- kind: ServiceAccount
  name: default
  namespace: clauderon
roleRef:
  kind: Role
  name: clauderon-session
  apiGroup: rbac.authorization.k8s.io
```

## Storage Configuration

### Default Storage Class

If no storage class is specified, the cluster's default is used:

```bash
kubectl get storageclass
```

### Custom Storage Class

For better performance, use an SSD-backed storage class:

```toml
[kubernetes]
storage_class = "fast-ssd"
```

### Storage Size

Sessions use a default PVC size. Adjust based on your project needs.

## Network Configuration

### Proxy Access

The pod needs to reach the clauderon proxy. Options:

1. **NodePort Service** - Expose proxy on node ports
2. **LoadBalancer** - External IP for proxy
3. **Ingress** - HTTP routing to proxy

### Example Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: clauderon-proxy
  namespace: clauderon
spec:
  rules:
  - host: clauderon.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: clauderon-proxy
            port:
              number: 3030
```

## Resource Limits

Configure default resource limits:

```bash
clauderon create --backend kubernetes \
  --cpu-limit 4 \
  --memory-limit 8Gi \
  --repo ~/project \
  --prompt "Heavy computation"
```

## Image Pull Secrets

For private container registries:

```bash
# Create secret
kubectl create secret docker-registry my-registry-secret \
  --docker-server=ghcr.io \
  --docker-username=user \
  --docker-password=token \
  -n clauderon
```

```toml
[kubernetes]
image_pull_secrets = ["my-registry-secret"]
```

## Monitoring

### View Pod Logs

```bash
kubectl logs -n clauderon <pod-name>
```

### Watch Pod Status

```bash
kubectl get pods -n clauderon -w
```

### Describe Pod

```bash
kubectl describe pod -n clauderon <pod-name>
```

## Attaching to Sessions

Attach to a running pod:

```bash
clauderon attach <session-name>
```

This runs `kubectl exec` to attach to the pod's TTY.

## Cleanup

### Delete Session

```bash
clauderon delete <session-name>
```

This removes:
- The Pod
- The PVC
- Any ConfigMaps created for the session

### Manual Cleanup

If sessions are orphaned:

```bash
# List clauderon resources
kubectl get pods,pvc -n clauderon -l app=clauderon

# Delete orphaned resources
kubectl delete pod,pvc -n clauderon -l session=<name>
```

## Troubleshooting

### Pod Stuck in Pending

Check for resource issues:

```bash
kubectl describe pod -n clauderon <pod-name>
```

Common causes:
- No available nodes with requested resources
- Storage class not available
- Image pull issues

### Pod CrashLoopBackOff

Check logs:

```bash
kubectl logs -n clauderon <pod-name> --previous
```

Common causes:
- Proxy not reachable
- Missing credentials
- Image issues

### PVC Not Binding

Check storage class:

```bash
kubectl get pvc -n clauderon
kubectl describe pvc -n clauderon <pvc-name>
```

### Network Issues

Test proxy connectivity from the pod:

```bash
kubectl exec -n clauderon <pod-name> -- \
  curl -v http://clauderon-proxy:3030/health
```

## Scaling

### Multiple Sessions

Run many sessions in parallel:

```bash
for i in {1..10}; do
  clauderon create --backend kubernetes \
    --repo ~/project \
    --prompt "Task $i" &
done
```

### Node Autoscaling

Combine with cluster autoscaler for dynamic capacity:

```yaml
apiVersion: autoscaling/v1
kind: HorizontalPodAutoscaler
# Configure based on your cluster setup
```

## Security Considerations

### Pod Security

Sessions run with:
- Non-root user
- Read-only root filesystem
- Dropped capabilities
- No privilege escalation

### Network Policies

Restrict pod network access:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: clauderon-sessions
  namespace: clauderon
spec:
  podSelector:
    matchLabels:
      app: clauderon
  policyTypes:
  - Egress
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: clauderon-proxy
    ports:
    - port: 3030
```

## See Also

- [Backends Comparison](/getting-started/backends/) - Compare all backends
- [Docker Backend](/guides/docker/) - For local container sessions
- [Troubleshooting](/guides/troubleshooting/) - Common issues and solutions
