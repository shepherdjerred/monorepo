# Troubleshooting

## Complete Debugging Workflow

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

## Sync Issues

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

## Out of Sync

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

## Resource Health Issues

```bash
# List unhealthy resources
argocd app resources my-app | grep -v Healthy

# Get details on specific resource
argocd app resources my-app --kind Deployment --name my-deployment

# Check pod status directly
kubectl get pods -n my-namespace -l app=my-app
kubectl describe pod -n my-namespace <pod-name>
```

## Repository Connection Issues

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

## Cluster Connection Issues

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

## RBAC and Permission Issues

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

## Common Error Messages

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

## Performance Issues

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

## Recovery Operations

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
