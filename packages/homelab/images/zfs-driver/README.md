# Maintained ZFS driver

This image builds the pinned OpenEBS ZFS LocalPV driver with one restore
transport change: the restore client's idle timeout is 300 seconds instead of
three. Backup transport and pipeline error propagation remain unchanged.
The build runs the upstream driver tests and the restore argument regression.

The existing OpenEBS Helm Application consumes the immutable image selected
by the root chart's `delivery.dependencies.zfs-driver` binding. Its upstream
chart joins `repository:tag`, so the tag is rendered as `selected@sha256:…`;
`selected` is a formatting label, not a publication version or a mutable
selection. The digest retains the original qualified image identity.
The common driver value changes both the node DaemonSet and controller
Deployment. Both use the existing Docker Hub reader in the `openebs` namespace.

Reconcile this change through the existing guarded root release only after
backup and restore workers are terminal and no native ZFS or netcat operation
is active. Confirm the selected driver digest and both CSI workloads' readiness
before starting another restore. Source tests and image publication do not prove
restoration: a normal isolated restore must complete and its application data
must pass the existing validation. Preserve completed backups and failed
attempts; do not substitute an upstream tag or bypass the preservation gate.
