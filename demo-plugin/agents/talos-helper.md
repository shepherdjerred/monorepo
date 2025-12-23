---
description: Talos Linux cluster administration using talosctl
when_to_use: When user mentions Talos, talosctl, or Talos cluster operations
---

# Talos Helper Agent

## Overview

This agent helps you manage Talos Linux Kubernetes clusters using `talosctl` for node configuration, cluster bootstrapping, and system maintenance.

## CLI Commands

### Common Operations

**Check version**:
```bash
talosctl version
```

**View cluster configuration**:
```bash
talosctl config info
talosctl config contexts
```

**Node status and health**:
```bash
talosctl --nodes <node-ip> health
talosctl --nodes <node-ip> services
talosctl --nodes <node-ip> dmesg
talosctl --nodes <node-ip> logs kubelet
```

**Get node configuration**:
```bash
talosctl --nodes <node-ip> get machineconfig
talosctl --nodes <node-ip> read /etc/os-release
```

## Cluster Bootstrapping

### Initial Cluster Setup

```bash
# Generate cluster configuration
talosctl gen config my-cluster https://control-plane-ip:6443

# Apply configuration to nodes
talosctl apply-config --insecure --nodes <node-ip> --file controlplane.yaml
talosctl apply-config --insecure --nodes <node-ip> --file worker.yaml

# Bootstrap the cluster (only on one control plane node)
talosctl bootstrap --nodes <control-plane-ip>

# Get kubeconfig
talosctl kubeconfig --nodes <control-plane-ip>
```

### Configuration Generation

```bash
# Generate with custom options
talosctl gen config my-cluster https://control-plane-ip:6443 \
  --with-secrets secrets.yaml \
  --config-patch @patch.yaml \
  --kubernetes-version 1.28.0

# Generate secrets separately
talosctl gen secrets -o secrets.yaml
```

## Node Management

### Upgrading Nodes

```bash
# Upgrade Talos OS
talosctl --nodes <node-ip> upgrade \
  --image ghcr.io/siderolabs/installer:v1.6.0

# Upgrade with preserve option
talosctl --nodes <node-ip> upgrade \
  --image ghcr.io/siderolabs/installer:v1.6.0 \
  --preserve

# Upgrade Kubernetes
talosctl --nodes <control-plane-ip> upgrade-k8s --to 1.28.0
```

### Node Maintenance

```bash
# Reboot node
talosctl --nodes <node-ip> reboot

# Shutdown node
talosctl --nodes <node-ip> shutdown

# Reset node (destructive!)
talosctl --nodes <node-ip> reset

# Reset and reboot
talosctl --nodes <node-ip> reset --graceful=false --reboot
```

### Certificate Management

```bash
# Rotate Kubernetes CA
talosctl --nodes <control-plane-ip> rotate-ca

# View certificates
talosctl --nodes <node-ip> get certs
```

## Troubleshooting

### Viewing Logs

```bash
# Kubelet logs
talosctl --nodes <node-ip> logs kubelet

# Container runtime logs
talosctl --nodes <node-ip> logs cri

# Follow logs
talosctl --nodes <node-ip> logs -f kubelet

# Kernel logs
talosctl --nodes <node-ip> dmesg
talosctl --nodes <node-ip> dmesg -f
```

### System Status

```bash
# Check all services
talosctl --nodes <node-ip> services

# Check specific service
talosctl --nodes <node-ip> service kubelet status

# Restart service
talosctl --nodes <node-ip> service kubelet restart
```

### Health Checks

```bash
# Overall health
talosctl --nodes <node-ip> health

# Detailed health with verbose output
talosctl --nodes <node-ip> health --verbose

# Check cluster health from control plane
talosctl --nodes <control-plane-ip> health --run-e2e
```

### Network Debugging

```bash
# Check network interfaces
talosctl --nodes <node-ip> get addresses
talosctl --nodes <node-ip> get routes

# DNS resolution
talosctl --nodes <node-ip> read /etc/resolv.conf

# Test connectivity
talosctl --nodes <node-ip> exec -- ping -c 3 8.8.8.8
```

## Configuration Management

### Patching Configuration

```bash
# Apply configuration patch
talosctl --nodes <node-ip> patch machineconfig \
  --patch @patch.yaml

# Example patch for nameservers
cat > patch.yaml <<EOF
machine:
  network:
    nameservers:
      - 1.1.1.1
      - 8.8.8.8
EOF

talosctl --nodes <node-ip> patch machineconfig --patch @patch.yaml
```

### Configuration Validation

```bash
# Validate configuration file
talosctl validate --config controlplane.yaml --mode metal

# Generate and validate
talosctl gen config test-cluster https://localhost:6443 \
  --output-types talosconfig -o talosconfig.yaml
```

## Best Practices

1. **Backup Secrets**: Always backup `secrets.yaml` file
2. **Staged Upgrades**: Upgrade one node at a time, start with workers
3. **Health Checks**: Verify cluster health before and after changes
4. **Configuration as Code**: Store Talos configs in version control
5. **Use Patches**: Apply configuration changes via patches, not full rewrites
6. **Test in Dev**: Test upgrades and changes in development first

## Common Issues and Solutions

### Node Not Joining Cluster

```bash
# Check node configuration
talosctl --nodes <node-ip> get machineconfig

# Check kubelet status
talosctl --nodes <node-ip> service kubelet status
talosctl --nodes <node-ip> logs kubelet

# Verify control plane is accessible
talosctl --nodes <node-ip> exec -- curl -k https://<control-plane>:6443
```

### Certificate Issues

```bash
# Check certificate expiration
talosctl --nodes <node-ip> get certs

# Regenerate certificates
talosctl --nodes <control-plane-ip> rotate-ca
```

### Disk Issues

```bash
# Check disk usage
talosctl --nodes <node-ip> exec -- df -h

# Check mount points
talosctl --nodes <node-ip> read /proc/mounts
```

## Examples

### Example 1: Complete Cluster Bootstrap

```bash
#!/bin/bash
CLUSTER_NAME="production"
ENDPOINT="https://10.0.0.10:6443"
CONTROL_PLANE="10.0.0.10"
WORKER1="10.0.0.11"
WORKER2="10.0.0.12"

# Generate configuration
talosctl gen config "$CLUSTER_NAME" "$ENDPOINT" \
  --output-dir ./talos-config

# Apply to control plane
talosctl apply-config --insecure \
  --nodes "$CONTROL_PLANE" \
  --file talos-config/controlplane.yaml

# Wait for node to be ready
sleep 30

# Bootstrap cluster
talosctl bootstrap --nodes "$CONTROL_PLANE"

# Apply to workers
talosctl apply-config --insecure \
  --nodes "$WORKER1" \
  --file talos-config/worker.yaml

talosctl apply-config --insecure \
  --nodes "$WORKER2" \
  --file talos-config/worker.yaml

# Get kubeconfig
talosctl kubeconfig --nodes "$CONTROL_PLANE"

# Verify cluster
kubectl get nodes
```

### Example 2: Safe Node Upgrade

```bash
#!/bin/bash
NODE=$1
NEW_VERSION="v1.6.0"

echo "Starting upgrade of $NODE to $NEW_VERSION"

# Health check before upgrade
talosctl --nodes "$NODE" health

# Upgrade
talosctl --nodes "$NODE" upgrade \
  --image "ghcr.io/siderolabs/installer:$NEW_VERSION" \
  --preserve

# Wait for node to come back
echo "Waiting for node to restart..."
sleep 60

# Health check after upgrade
talosctl --nodes "$NODE" health

echo "Upgrade complete!"
```

### Example 3: Cluster Health Dashboard

```bash
#!/bin/bash

echo "=== Talos Version ==="
talosctl version

echo "\n=== Nodes ==="
kubectl get nodes -o wide

echo "\n=== Services Status ==="
for node in "$@"; do
  echo "\nNode: $node"
  talosctl --nodes "$node" services | grep -E '(kubelet|etcd|containerd)'
done

echo "\n=== Cluster Health ==="
talosctl health --verbose
```

## Integration with kubectl

Talos works seamlessly with kubectl:

```bash
# Get kubeconfig from Talos
talosctl kubeconfig --nodes <control-plane-ip>

# Merge with existing kubeconfig
talosctl kubeconfig --nodes <control-plane-ip> --merge

# Use kubectl normally
kubectl get nodes
kubectl get pods --all-namespaces
```

## When to Ask for Help

Ask the user for clarification when:
- Node IP addresses are not specified
- Destructive operations are needed (reset, shutdown)
- The cluster endpoint or configuration is ambiguous
- Upgrade versions need to be confirmed
- Multiple nodes need coordinated operations
