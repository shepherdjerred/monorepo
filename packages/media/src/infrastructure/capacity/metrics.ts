import {
  CapacityViewSchema,
  type CapacityView,
} from "#shared/capacity/view.ts";

export function renderCapacityMetrics(input: CapacityView): string {
  const view = CapacityViewSchema.parse(input);
  const lines = [
    "# TYPE media_storage_capacity_sampling_enabled gauge",
    `media_storage_capacity_sampling_enabled ${view.samplingEnabled ? "1" : "0"}`,
    "# TYPE media_storage_capacity_state gauge",
    "# TYPE media_storage_capacity_total_bytes gauge",
    "# TYPE media_storage_capacity_available_bytes gauge",
    "# TYPE media_storage_capacity_sample_timestamp_seconds gauge",
  ];
  for (const role of view.roles) {
    lines.push(
      `media_storage_capacity_state{role="${role.role}",state="${role.state}"} 1`,
    );
    if (
      role.state === "current" &&
      role.sampledAt !== null &&
      role.totalBytes !== null &&
      role.availableBytes !== null
    ) {
      lines.push(
        `media_storage_capacity_total_bytes{role="${role.role}"} ${role.totalBytes}`,
        `media_storage_capacity_available_bytes{role="${role.role}"} ${role.availableBytes}`,
        `media_storage_capacity_sample_timestamp_seconds{role="${role.role}"} ${String(new Date(role.sampledAt).getTime() / 1000)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
