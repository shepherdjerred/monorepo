import { BUILDKITE_JOB_POD_PATTERN } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/buildkite.ts";

export const PHYSICAL_DISK_PATTERN =
  "nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|xvd[a-z]+";

export const BUILDKITE_ACTIVE_NODES = `max by (node) (
  kube_pod_info{namespace="buildkite", pod=~"${BUILDKITE_JOB_POD_PATTERN}"}
)`;

export const BUILDKITE_LOGICAL_WRITE_RATE =
  "sum(rate(buildkite:pod_parent_fs_writes_bytes_total[5m]))";

export const BUILDKITE_PHYSICAL_WRITE_RATE = `sum(
  rate(node_disk_written_bytes_total{device=~"${PHYSICAL_DISK_PATTERN}"}[5m])
  and on (node) ${BUILDKITE_ACTIVE_NODES}
)`;
