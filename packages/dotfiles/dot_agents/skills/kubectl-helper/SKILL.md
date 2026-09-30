---
name: kubectl-helper
description: |
  Kubernetes troubleshooting and resource management with kubectl
  When user works with Kubernetes, mentions kubectl, pods, deployments, or k8s errors
---

# Kubernetes Helper Agent

## What's New in Kubernetes 1.33 & 2025

- **Server-Side Apply**: Recommended default for applying manifests (better conflict resolution)
- **Server-Side Dry Run**: Full API validation before applying changes
- **kubectl diff**: Preview changes before applying
- **Containerd Default**: containerd is now the default runtime (Docker deprecated)
- **Enhanced Label Selectors**: More powerful filtering and bulk operations
- **Rollout Control**: Better manual control with `kubectl rollout pause`

## Overview

This agent helps you work with Kubernetes clusters using `kubectl` for resource management, troubleshooting, and debugging.

## CLI Commands

### Auto-Approved Commands

The following `kubectl` commands are auto-approved and safe to use:

- `kubectl get` - List resources
- `kubectl describe` - Show detailed resource information
- `kubectl logs` - View container logs
- `kubectl explain` - Show resource documentation
- `kubectl api-resources` - List available resource types
- `kubectl version` - Show version information
- `kubectl cluster-info` - Display cluster information
- `kubectl config` - Manage kubeconfig
- `kubectl top` - Show resource usage

### Modern Apply Patterns (2025)

**Server-side apply (recommended)**:

```bash
# Apply with server-side processing (better conflict resolution)
kubectl apply -f deployment.yaml --server-side

# Apply directory recursively
kubectl apply -f ./configs/ --server-side --recursive

# Force conflicts to be resolved server-side
kubectl apply -f deployment.yaml --server-side --force-conflicts
```

**Preview changes before applying**:

```bash
# Show diff of what will change
kubectl diff -f deployment.yaml

# Dry run with full server-side validation
kubectl apply -f deployment.yaml --dry-run=server

# Client-side dry run (no server validation)
kubectl apply -f deployment.yaml --dry-run=client
```

**Why server-side apply?**

- Better conflict resolution (server decides, not client)
- Supports collaborative editing (multiple sources can manage same resource)
- Respects field ownership (who owns each field)
- Required for some newer Kubernetes features

### Common Operations

**Get resources**:

```bash
kubectl get pods
kubectl get pods -n production
kubectl get deployments --all-namespaces
kubectl get nodes
kubectl get services
```

**Advanced label selectors (2025)**:

```bash
# Single label match
kubectl get pods -l app=nginx

# Multiple labels (AND)
kubectl get pods -l app=nginx,env=production

# Set-based selectors
kubectl get pods -l 'env in (production,staging)'
kubectl get pods -l 'tier notin (frontend,backend)'

# Exists/not exists
kubectl get pods -l 'release'  # has 'release' label
kubectl get pods -l '!release'  # doesn't have 'release' label

# Bulk operations with labels
kubectl delete pods -l phase=test
kubectl scale deployment -l app=api --replicas=3
```

**Describe resources**:

```bash
kubectl describe pod my-pod
kubectl describe node node-1
kubectl describe deployment my-app
```

**View logs**:

```bash
kubectl logs my-pod
kubectl logs my-pod -c container-name
kubectl logs -f my-pod  # Follow logs
kubectl logs my-pod --previous  # Previous container logs
kubectl logs -l app=nginx  # Logs from all pods with label
```

**Context and namespace management**:

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config use-context production
kubectl config set-context --current --namespace=my-namespace
```

**Rollout management and canary deployments**:

```bash
# View rollout status
kubectl rollout status deployment/my-app

# Pause rollout for manual canary analysis
kubectl rollout pause deployment/my-app

# After validation, resume rollout
kubectl rollout resume deployment/my-app

# Rollback if issues found
kubectl rollout undo deployment/my-app

# View rollout history
kubectl rollout history deployment/my-app

# Rollback to specific revision
kubectl rollout undo deployment/my-app --to-revision=2
```

**Canary deployment workflow**:

```bash
# 1. Update deployment (triggers rollout)
kubectl apply -f deployment.yaml --server-side

# 2. Immediately pause to control rollout
kubectl rollout pause deployment/my-app

# 3. New pods start alongside old pods (manual canary)
kubectl get pods -l app=my-app -L version

# 4. Monitor metrics, test new version
# ... check logs, metrics, error rates ...

# 5. If good, resume full rollout
kubectl rollout resume deployment/my-app

# 6. If bad, rollback
kubectl rollout undo deployment/my-app
```

## Troubleshooting Workflows

### Pod Not Starting

```bash
# 1. Check pod status
kubectl get pod my-pod -o wide

# 2. Describe pod to see events
kubectl describe pod my-pod

# 3. Check logs
kubectl logs my-pod

# 4. Check previous container logs if crash looping
kubectl logs my-pod --previous

# 5. Check events in namespace
kubectl get events --sort-by='.lastTimestamp' | grep my-pod
```

### Debugging Running Pod

```bash
# Execute commands in pod
kubectl exec -it my-pod -- sh
kubectl exec -it my-pod -c container-name -- bash

# Port forward to local machine
kubectl port-forward my-pod 8080:80

# Copy files to/from pod
kubectl cp my-pod:/path/to/file ./local-file
kubectl cp ./local-file my-pod:/path/to/file
```

### Network Issues

```bash
# Check service endpoints
kubectl get endpoints my-service

# Describe service
kubectl describe service my-service

# Test DNS resolution
kubectl run -it --rm debug --image=busybox --restart=Never -- nslookup my-service

# Check network policies
kubectl get networkpolicies
```

### Resource Constraints

```bash
# Check resource usage
kubectl top nodes
kubectl top pods
kubectl top pods --containers

# Describe resource limits
kubectl describe pod my-pod | grep -A 5 Limits
```

## Common Patterns

### Get Resource in Specific Format

```bash
# JSON output
kubectl get pod my-pod -o json

# YAML output
kubectl get pod my-pod -o yaml

# Custom columns
kubectl get pods -o custom-columns=NAME:.metadata.name,STATUS:.status.phase

# JSONPath
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
```

### Filtering and Selecting

```bash
# By label
kubectl get pods -l app=nginx
kubectl get pods -l 'env in (production,staging)'

# By field
kubectl get pods --field-selector status.phase=Running
kubectl get pods --field-selector metadata.namespace!=kube-system
```

### Watch Resources

```bash
# Watch for changes
kubectl get pods --watch
kubectl get pods -w

# Watch with timestamps
kubectl get pods --watch --output-watch-events
```

## Best Practices and Smart Defaults (2025)

### Infrastructure as Code

1. **Always use version control for manifests**:

   ```bash
   # Good: Manifests in git
   git add k8s/
   git commit -m "Update deployment replicas"
   kubectl apply -f k8s/ --server-side

   # Bad: Imperative changes (lost on next apply)
   kubectl scale deployment my-app --replicas=5
   ```

2. **Prefer server-side apply** for all manifest applications

   ```bash
   # Default to server-side
   kubectl apply -f . --server-side --recursive
   ```

3. **Preview changes before applying**:

   ```bash
   # Always diff first
   kubectl diff -f deployment.yaml
   # Then apply
   kubectl apply -f deployment.yaml --server-side
   ```

4. **Use kubectl diff as pre-commit hook**:
   ```bash
   # .git/hooks/pre-commit
   kubectl diff -f k8s/ --exit-code
   ```

### Runtime Notes (K8s 1.33)

- **Containerd is now the default runtime** (Docker deprecated since 1.20)
- If using Docker, migrate to containerd or CRI-O
- Docker shim removed entirely in 1.33+

```bash
# Check current runtime
kubectl get nodes -o wide
# Look at CONTAINER-RUNTIME column

# Verify containerd
kubectl describe node <node-name> | grep "Container Runtime"
```

## Security Best Practices

1. **Use Namespaces**: Isolate workloads with namespaces
2. **RBAC**: Follow principle of least privilege
3. **Network Policies**: Restrict pod-to-pod communication
4. **Resource Limits**: Always set memory and CPU limits
   ```yaml
   resources:
     limits:
       memory: "256Mi"
       cpu: "500m"
     requests:
       memory: "128Mi"
       cpu: "250m"
   ```
5. **Security Contexts**: Run containers as non-root when possible
   ```yaml
   securityContext:
     runAsNonRoot: true
     runAsUser: 1000
     readOnlyRootFilesystem: true
   ```
6. **Secrets**: Use Kubernetes Secrets, never hardcode credentials
7. **Label Consistency**: Use consistent labels for filtering and RBAC
   ```yaml
   labels:
     app: nginx
     env: production
     version: v1.2.3
   ```

## Common Issues and Solutions

### ImagePullBackOff

```bash
# Check image name and tag
kubectl describe pod my-pod | grep Image

# Check image pull secrets
kubectl get secrets
kubectl describe secret my-registry-secret

# Check node's ability to pull
kubectl describe node my-node | grep -A 10 Conditions
```

### CrashLoopBackOff

```bash
# View current logs
kubectl logs my-pod

# View previous logs
kubectl logs my-pod --previous

# Check liveness/readiness probes
kubectl describe pod my-pod | grep -A 5 Probes

# Temporarily disable probes (edit deployment)
kubectl edit deployment my-app
```

### Pending Pods

```bash
# Check events
kubectl describe pod my-pod | grep Events -A 10

# Check node resources
kubectl top nodes
kubectl describe nodes

# Check PVC status
kubectl get pvc
```

## Examples

### Example 1: Complete Pod Debugging

```bash
#!/bin/bash
POD=$1

echo "=== Pod Status ==="
kubectl get pod "$POD" -o wide

echo "\n=== Pod Events ==="
kubectl describe pod "$POD" | grep Events -A 20

echo "\n=== Pod Logs ==="
kubectl logs "$POD" --tail=50

echo "\n=== Resource Usage ==="
kubectl top pod "$POD" --containers
```

### Example 2: Find Pods Using Most Resources

```bash
# CPU
kubectl top pods --all-namespaces --sort-by=cpu

# Memory
kubectl top pods --all-namespaces --sort-by=memory
```

### Example 3: Quick Health Check

```bash
# Check cluster health
kubectl get nodes
kubectl get componentstatuses
kubectl get pods --all-namespaces --field-selector=status.phase!=Running

# Check critical system pods
kubectl get pods -n kube-system
```

## Advanced Operations

### Bulk Operations

```bash
# Delete all pods with label
kubectl delete pods -l app=old-version

# Scale all deployments
kubectl get deployments -o name | xargs -I {} kubectl scale {} --replicas=3

# Restart all pods in deployment (rollout restart)
kubectl rollout restart deployment my-app
```

### Debug with Ephemeral Containers

```bash
# Add debug container to running pod (K8s 1.23+)
kubectl debug my-pod -it --image=busybox --target=my-container

# Create debug pod as copy
kubectl debug my-pod -it --copy-to=my-pod-debug --container=debugger --image=busybox
```

## When to Ask for Help

Ask the user for clarification when:

- The cluster context or namespace is ambiguous
- Destructive operations are needed (delete, drain, cordon)
- RBAC permissions might be insufficient
- The issue requires changes to cluster configuration
- Multiple pods/deployments match the criteria
