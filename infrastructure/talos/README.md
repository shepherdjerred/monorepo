# Talos Configuration

This directory contains Talos machine configuration patches for the homelab cluster.

## Node: torvalds

**Patch file**: `torvalds-patch.yaml`

### Changes

1. **ZFS ARC Maximum**: Increased from 48 GB to 62.5 GB
   - Addresses recurring PagerDuty alerts for ZFS hash collisions
   - Sets ARC to industry standard 50% of total system RAM (125 GB)
   - Allows ARC to grow during I/O peaks, reducing eviction pressure

2. **Kubelet Max Pods**: Increased from 250 to 300
   - Provides headroom for cluster growth

### Application

```bash
# Apply the patch
talosctl patch machineconfig --nodes torvalds --patch @infrastructure/talos/torvalds-patch.yaml

# Reboot to apply changes
talosctl reboot --nodes torvalds
```

### Validation

After reboot, verify changes:

```bash
# Check max pods
kubectl get node torvalds -o jsonpath='{.status.capacity.pods}'
# Expected: 300

# Check ZFS ARC max (from Prometheus)
kubectl port-forward -n prometheus svc/prometheus-kube-prometheus-prometheus 9090:9090
# Then query: node_zfs_arc_c_max
# Expected: 67108864000 (62.5 GB)
```

### Background

**Issue**: ZFS ARC hash collision alerts (PagerDuty #2136, #2140, #2154, #2156)

**Root Cause**: ARC limited to 48 GB was running at 98% capacity (47/48 GB). During I/O spikes, the cache couldn't grow, forcing aggressive evictions and causing hash collisions (1,192-1,640/sec, exceeding 1,000/sec threshold).

**Solution**: Increased ARC max to 62.5 GB (50% of 125 GB total RAM), giving the cache room to grow during peaks.

**Expected Result**: Zero ZFS hash collision PagerDuty alerts.

### Runtime Application (Temporary)

The ZFS ARC change was also applied at runtime via a privileged DaemonSet for immediate effect:

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: zfs-arc-tuner
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: zfs-arc-tuner
  template:
    metadata:
      labels:
        name: zfs-arc-tuner
    spec:
      hostPID: true
      hostNetwork: true
      nodeSelector:
        kubernetes.io/hostname: torvalds
      tolerations:
      - operator: Exists
      containers:
      - name: tuner
        image: alpine:latest
        command: ["/bin/sh", "-c"]
        args:
          - |
            echo 67108864000 > /host/sys/module/zfs/parameters/zfs_arc_max
            sleep infinity
        securityContext:
          privileged: true
        volumeMounts:
        - name: sys
          mountPath: /host/sys
      volumes:
      - name: sys
        hostPath:
          path: /sys
          type: Directory
EOF
```

This DaemonSet can be removed after applying the persistent Talos patch and rebooting.
