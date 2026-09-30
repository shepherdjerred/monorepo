export const memoryLeakExpression = [
  "((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) - on(instance) ",
  "group_left node_zfs_arc_size) - ((node_memory_MemTotal_bytes offset 24h - ",
  "node_memory_MemAvailable_bytes offset 24h) - on(instance) group_left ",
  "node_zfs_arc_size offset 24h) > 8589934592",
].join("");

export function pvcProjectedFullExpression(days: number): string {
  const seconds = days * 24 * 60 * 60;
  return `(
  kubelet_volume_stats_available_bytes
  /
  deriv(kubelet_volume_stats_used_bytes[7d])
) < ${String(seconds)}
and on (namespace, persistentvolumeclaim)
deriv(kubelet_volume_stats_used_bytes[7d]) > 0
and on (namespace, persistentvolumeclaim) kubelet_volume_stats_used_bytes offset 7d`;
}
