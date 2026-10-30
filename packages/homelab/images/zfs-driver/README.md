# Maintained ZFS driver

This image builds the pinned OpenEBS ZFS LocalPV driver with one transport
change: the `nc` idle timeout on both the backup and restore streams is 300
seconds instead of three. OpenBSD `nc -w` is an idle timeout that exits
cleanly, so a cloud stall longer than three seconds killed `zfs send` with
SIGPIPE and handed the Velero plugin an EOF that looked like a complete, but
truncated, stream. The backup client also passes `-N` so the plugin sees the
real end of the stream as soon as `zfs send` finishes, rather than after the
idle timeout. Pipeline error propagation is unchanged. The build runs the
upstream driver tests and the netcat argument regressions.

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
