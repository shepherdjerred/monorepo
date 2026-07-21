import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/buildkite.ts";
import { createBuildkiteDashboard } from "./buildkite-dashboard.ts";

const TargetSchema = z
  .object({
    expr: z.string(),
    legendFormat: z.string(),
    instant: z.boolean().optional(),
    range: z.boolean().optional(),
  })
  .loose();

const PanelSchema = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    type: z.string(),
    targets: z.array(TargetSchema).optional(),
  })
  .loose();

const DashboardSchema = z
  .object({
    title: z.string(),
    tags: z.array(z.string()),
    panels: z.array(PanelSchema),
  })
  .loose();

const dashboard = DashboardSchema.parse(createBuildkiteDashboard());

function panel(title: string): z.infer<typeof PanelSchema> {
  const match = dashboard.panels.find((candidate) => candidate.title === title);
  if (match === undefined) throw new Error(`missing dashboard panel: ${title}`);
  return match;
}

function panelQueries(title: string): string[] {
  return panel(title).targets?.map((target) => target.expr) ?? [];
}

describe("Buildkite CI I/O dashboard", () => {
  it("contains the complete impact, attribution, and pressure views", () => {
    expect(dashboard.title).toBe("Buildkite — CI Resources & I/O");
    expect(dashboard.tags).toContain("io");
    expect(dashboard.panels.map((candidate) => candidate.title)).toEqual(
      expect.arrayContaining([
        "Pod Lifetime Writes Seen (24h)",
        "Physical / Logical Amplification",
        "Running Jobs Measured",
        "CI Logical vs Node Physical Writes",
        "CI Read & Write Operations",
        "Top Step Write Rates",
        "Container I/O Attribution",
        "CI Pod I/O Pressure",
        "Node I/O Pressure",
        "Disk Write Latency",
        "Disk Queue Depth (Diagnostic)",
        "Kubernetes API p99 Write Latency",
        "etcd Request p99 Latency",
        "Limiter State",
        "Scheduling Outcomes",
        "Controller Query Health",
      ]),
    );
  });

  it("uses the unique parent counter for every logical total", () => {
    const queries = [
      ...panelQueries("Pod Lifetime Writes Seen (24h)"),
      ...panelQueries("Logical Write Rate"),
      ...panelQueries("CI Logical vs Node Physical Writes"),
      ...panelQueries("CI Read & Write Throughput"),
      ...panelQueries("CI Read & Write Operations"),
      ...panelQueries("Top Step Write Rates"),
    ].join("\n");

    expect(queries).toContain("buildkite:pod_parent_fs_writes_bytes_total");
    expect(queries).toContain("buildkite:pod_parent_fs_reads_bytes_total");
    expect(queries).toContain("buildkite:pod_parent_fs_writes_total");
    expect(queries).toContain("buildkite:pod_parent_fs_reads_total");
    expect(queries).not.toContain("container_fs_writes_bytes_total{");
    expect(queries).not.toContain("buildkite:container_fs_writes_bytes_total");
  });

  it("reads the precomputed pod-lifetime cohort value with one instant query", () => {
    expect(panel("Pod Lifetime Writes Seen (24h)").targets?.[0]).toEqual(
      expect.objectContaining({
        expr: BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC,
        instant: true,
        range: false,
      }),
    );
    expect(panel("Pod Lifetime Writes Seen (24h)").description).toContain(
      "Series crossing the left boundary include earlier writes",
    );
    expect(panel("Pod Lifetime Writes Seen (24h)").description).toContain(
      "not an exact 24-hour write delta",
    );
  });

  it("keeps child counters confined to the container attribution panel", () => {
    const queries = panelQueries("Container I/O Attribution").join("\n");
    expect(queries).toContain("buildkite:container_fs_writes_bytes_total");
    expect(queries).toContain("buildkite:container_fs_reads_bytes_total");
    expect(queries).not.toContain("buildkite:pod_parent_fs_writes_bytes_total");
  });

  it("attributes top writers to the stable Buildkite step and job identity", () => {
    const topWriters = panel("Top Step Write Rates");
    expect(topWriters.targets?.[0]?.expr).toContain(
      "label_ci_sjer_red_step_key",
    );
    expect(topWriters.targets?.[0]?.expr).toContain(
      "label_buildkite_com_job_uuid",
    );
    expect(topWriters.targets?.[0]?.legendFormat).toBe(
      "{{label_ci_sjer_red_step_key}} · {{label_buildkite_com_job_uuid}}",
    );
  });

  it("measures telemetry coverage against running jobs only", () => {
    const coverageQuery = panelQueries("Running Jobs Measured").join("\n");
    expect(coverageQuery).toContain('phase="Running"');
    expect(coverageQuery).toContain("buildkite:pod_parent_sample_present");
    expect(coverageQuery).toContain("label_buildkite_com_job_uuid");
    expect(coverageQuery).not.toContain("vector(1)");
  });

  it("does not render missing primary telemetry as zero savings", () => {
    const primaryQueries = [
      ...panelQueries("Pod Lifetime Writes Seen (24h)"),
      ...panelQueries("Logical Write Rate"),
      ...panelQueries("Node Physical Write Rate"),
      ...panelQueries("Canceled Pods (24h)"),
    ].join("\n");

    expect(primaryQueries).not.toContain("vector(0)");
  });

  it("counts only pods whose requested phase is active", () => {
    for (const query of panelQueries("Running vs Pending Pods")) {
      expect(query).toContain("== 1");
    }
  });

  it("labels node-level physical writes as diagnostic rather than savings", () => {
    expect(panel("Node Physical Write Rate").targets?.[0]?.legendFormat).toBe(
      "diagnostic",
    );
    expect(
      panel("CI Logical vs Node Physical Writes").targets?.[1]?.legendFormat,
    ).toBe("node physical (diagnostic)");
    expect(panel("Disk Queue Depth (Diagnostic)").title).toContain(
      "Diagnostic",
    );
  });

  it("preserves latency when the disk write rate is below one operation per second", () => {
    const latencyQuery = panelQueries("Disk Write Latency").join("\n");
    expect(latencyQuery).toContain("node_disk_write_time_seconds_total");
    expect(latencyQuery).toContain("node_disk_writes_completed_total");
    expect(latencyQuery).toContain("1e-9");
    expect(latencyQuery).not.toMatch(/clamp_min\([\s\S]*,\s*1\s*\)/);
  });

  it("correlates pressure with API, etcd, and controller health", () => {
    const queries = [
      ...panelQueries("CI Pod I/O Pressure"),
      ...panelQueries("Node I/O Pressure"),
      ...panelQueries("Kubernetes API p99 Write Latency"),
      ...panelQueries("etcd Request p99 Latency"),
      ...panelQueries("Limiter State"),
      ...panelQueries("Scheduling Outcomes"),
      ...panelQueries("Controller Query Health"),
    ].join("\n");

    expect(queries).toContain("buildkite:pod_parent_io_waiting_seconds_total");
    expect(queries).toContain("node_pressure_io_waiting_seconds_total");
    expect(queries).toContain("apiserver_request_duration_seconds_bucket");
    expect(queries).toContain("etcd_request_duration_seconds_bucket");
    expect(queries).toContain("buildkite_limiter_tokens_available");
    expect(queries).toContain("buildkite_scheduler_job_create_errors_total");
    expect(queries).toContain("buildkite_monitor_job_query_errors_total");
  });
});
