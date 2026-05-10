# NVMe Firmware Update — `torvalds` (Samsung 990 PRO 4 TB × 2)

## Status

In Progress — pre-flight not yet run; awaiting approval to execute.

## Goal

Update both Samsung 990 PRO drives from **4B2QJXD7 → 8B2QJXD7** in one maintenance window with one `talosctl reboot`. Single-node Talos 1.12.0; downtime acceptable.

## Why now

| Signal           | Value                                             |
| ---------------- | ------------------------------------------------- |
| Current firmware | 4B2QJXD7 (~5 versions behind)                     |
| Latest firmware  | 8B2QJXD7 (Dec 2025, read-stability fixes)         |
| Wear bug         | Patched in 1B (already past it)                   |
| Urgency          | YELLOW — maintenance-window worthy, not emergency |

## Approach

Single window. Both drives, one reboot. Possible because:

1. NVMe spec lets us `fw-download` both drives while in use, then `fw-commit -a 2` (activate at next reset).
2. Velero healthy: 6-hourly + daily + weekly + monthly backups, latest 23 min before this plan was drafted.
3. Namespaces `dagger`, `buildkite`, `home`, `ddns`, `intel-device-plugin-operator` already labelled `pod-security.kubernetes.io/enforce=privileged` → no PSA changes needed for the privileged debug pod.

## Phase 1 — Pre-flight (read-only, do BEFORE scheduling window)

| #   | Action                                                                    | Command / file                                                                                                                    | Pass criteria                                                            |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1.1 | Verify firmware download from Samsung directly (not the subagent's claim) | `WebFetch https://semiconductor.samsung.com/consumer-storage/support/tools/`                                                      | Find official 8B2QJXD7 ISO URL + SHA256                                  |
| 1.2 | Save Talos `machineconfig` externally                                     | `talosctl --nodes torvalds get mc -o yaml > ~/talos-backup/torvalds-machineconfig-$(date +%Y%m%d).yaml`                           | File saved + verified                                                    |
| 1.3 | Confirm `secrets.yaml` is in password manager                             | manual                                                                                                                            | Present, recoverable                                                     |
| 1.4 | Confirm IPMI / out-of-band access                                         | manual                                                                                                                            | Tested in last 30 days                                                   |
| 1.5 | Restore-test one Velero backup to a temp namespace                        | `velero restore create test-restore --from-backup <latest> --include-namespaces home --namespace-mappings home:home-restore-test` | PVC restored, contents readable, then delete temp ns                     |
| 1.6 | Pre-pull `debian:bookworm` to node containerd cache                       | `kubectl run pull-cache --image=debian:bookworm --restart=Never --rm -it --command -- true`                                       | Image cached locally on node                                             |
| 1.7 | Identify writable firmware slots on each drive                            | privileged debug pod (Phase 2 spec): `nvme fw-log /dev/nvme0n1` and `…/nvme1n1`                                                   | Note number of slots + which are read-only                               |
| 1.8 | Read-only check `man nvme-fw-commit` semantics in target Debian image     | `kubectl exec ... -- man nvme-fw-commit`                                                                                          | Confirm `--action=2` = "activate at next reset" in this nvme-cli version |

## Phase 2 — Privileged debug pod manifest

Deployed in `dagger` namespace (already PSA-`privileged`). Used in both pre-flight (1.7, 1.8) and execution.

```yaml
# nvme-fw-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: nvme-fw-updater
  namespace: dagger
spec:
  hostPID: true
  restartPolicy: Never
  nodeSelector: { kubernetes.io/hostname: torvalds }
  containers:
    - name: tools
      image: debian:bookworm
      stdin: true
      tty: true
      securityContext: { privileged: true }
      command: ["/bin/bash", "-c"]
      args:
        [
          "apt-get update && apt-get install -y nvme-cli zfsutils-linux man-db && sleep infinity",
        ]
      volumeMounts:
        - { name: dev, mountPath: /dev }
        - { name: sys, mountPath: /sys }
  volumes:
    - { name: dev, hostPath: { path: /dev } }
    - { name: sys, hostPath: { path: /sys } }
```

## Phase 3 — Execution (60–90 min window, cluster offline)

| #    | Step                                                                 | Command                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Freeze ArgoCD auto-sync                                              | `for app in $(argocd app list -o name); do argocd app set $app --sync-policy none; done`                                                                                                                                                |
| 3.2  | Stop CI controller                                                   | `kubectl -n buildkite scale deploy buildkite-controller --replicas=0`                                                                                                                                                                   |
| 3.3  | Scale all workloads using `zfs-ssd*` PVCs to 0                       | `kubectl get pvc -A -o json \| jq -r '.items[] \| select(.spec.storageClassName \| test("zfs-ssd")) \| "\(.metadata.namespace) \(.metadata.name)"' > /tmp/zfs-pvcs.txt` then iterate and scale owners (StatefulSets + Deployments) to 0 |
| 3.4  | Snapshot etcd (belt-and-braces; Velero covers PVCs not etcd)         | `talosctl --nodes torvalds etcd snapshot /var/lib/etcd/snapshot-pre-fw.db && talosctl --nodes torvalds copy /var/lib/etcd/snapshot-pre-fw.db ./etcd-pre-fw-$(date +%Y%m%d).db`                                                          |
| 3.5  | Scale openebs zfs-localpv to 0 (otherwise DaemonSet keeps pool busy) | `kubectl -n openebs scale deploy openebs-zfs-controller --replicas=0; kubectl -n openebs delete daemonset openebs-zfs-node`                                                                                                             |
| 3.6  | Deploy debug pod                                                     | `kubectl apply -f nvme-fw-pod.yaml; kubectl -n dagger wait --for=condition=Ready pod/nvme-fw-updater --timeout=180s`                                                                                                                    |
| 3.7  | Copy firmware bin into pod                                           | `kubectl -n dagger cp ~/Downloads/990pro-8B2QJXD7.bin nvme-fw-updater:/tmp/fw.bin`                                                                                                                                                      |
| 3.8  | Verify both drives visible                                           | `kubectl -n dagger exec nvme-fw-updater -- nvme list`                                                                                                                                                                                   |
| 3.9  | Export ZFS pool                                                      | `kubectl -n dagger exec nvme-fw-updater -- zpool export zfspv-pool-nvme`                                                                                                                                                                |
| 3.10 | fw-download to nvme0n1, activate-at-reset                            | `kubectl -n dagger exec nvme-fw-updater -- nvme fw-download /dev/nvme0n1 --fw=/tmp/fw.bin && kubectl -n dagger exec nvme-fw-updater -- nvme fw-commit /dev/nvme0n1 --slot=0 --action=2`                                                 |
| 3.11 | fw-download to nvme1n1, activate-at-reset                            | same as 3.10 with `/dev/nvme1n1`                                                                                                                                                                                                        |
| 3.12 | Reboot Talos                                                         | `talosctl --nodes torvalds reboot`                                                                                                                                                                                                      |
| 3.13 | Wait for node Ready (5–10 min)                                       | `kubectl get nodes -w`                                                                                                                                                                                                                  |

## Phase 4 — Post-reboot verification

| #   | Check                                             | Command                                                               | Pass criteria                    |
| --- | ------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| 4.1 | Both drives report new firmware                   | `toolkit grafana query 'nvme_device_info' --instant`                  | `firmware="8B2QJXD7"` on both    |
| 4.2 | ZFS pool re-imported clean                        | recreate debug pod, `zpool status zfspv-pool-nvme`                    | `state: ONLINE`, no errors       |
| 4.3 | All PVCs bound                                    | `kubectl get pvc -A \| grep -v Bound \| grep -v NAMESPACE`            | empty output                     |
| 4.4 | Re-enable openebs (Argo will re-deploy if synced) | `argocd app sync openebs`                                             | DaemonSet running                |
| 4.5 | Restore CI                                        | `kubectl -n buildkite scale deploy buildkite-controller --replicas=1` | first Buildkite Job pod succeeds |
| 4.6 | Re-enable ArgoCD auto-sync                        | reverse of 3.1                                                        | Apps Synced                      |
| 4.7 | Cleanup                                           | `kubectl -n dagger delete pod nvme-fw-updater`                        | pod gone                         |

## Rollback paths

| Failure                                               | Recovery                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Cluster doesn't return after 30 min                   | IPMI → boot Talos rescue ISO → re-apply `machineconfig.yaml` → restore etcd snapshot → restart                         |
| Pool fails to import (firmware ABI changed something) | Boot rescue, `zpool import -fF zfspv-pool-nvme`. If unrecoverable: rebuild pool, `velero restore` per-namespace        |
| Single drive bricked (rare)                           | Hardware swap. If nvme1n1: cluster boots, restore PVCs from Velero. If nvme0n1: full reimage from `machineconfig.yaml` |
| Both drives bricked                                   | Why we did Phase 1.4 (IPMI) + 1.5 (tested restore). Full rebuild: `secrets.yaml` + Velero                              |

## Risk register

| Risk                                                                | Likelihood                                     | Mitigation                                        |
| ------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Firmware bricks a drive                                             | Low (Samsung firmware is well-tested in field) | IPMI access, tested Velero restore, etcd snapshot |
| `nvme fw-commit --action=2` syntax differs across nvme-cli versions | Medium                                         | Pre-flight 1.8 reads `man nvme-fw-commit` first   |
| Pool fails to re-import after reboot                                | Low                                            | `zpool import -fF` + Velero fallback              |
| Subagent hallucinated 8B2QJXD7 download URL                         | Medium                                         | Pre-flight 1.1 verifies on Samsung's own site     |
| ArgoCD auto-syncs mid-window and undoes scale-to-zero               | Medium                                         | Phase 3.1 freezes auto-sync first                 |
| openebs-zfs-node DaemonSet readd from Argo before pool re-import    | Medium                                         | Phase 4.2 done manually before 4.4                |

## Out of scope

- SSD wear / write-rate optimisation (separate concern; SMART is at 8% / 14% — no urgency)
- Talos OS upgrade (separate maintenance window)
- ZFS pool topology change to mirror (separate decision; backup coverage already mitigates the single-disk risk)

## Verification of "we are done"

After Phase 4 all-pass:

- Both drives `firmware="8B2QJXD7"` in `nvme_device_info`
- All workloads running, all PVCs bound
- One full Buildkite Job has succeeded post-reboot
- `nvme_percentage_used_ratio` unchanged (firmware update doesn't reset this)
