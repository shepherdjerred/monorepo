import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-server-config");
}

const PodSpecSchema = z.object({
  spec: z.object({
    template: z.object({
      spec: z.object({
        initContainers: z.array(
          z.object({
            name: z.string(),
            image: z.string(),
            args: z.array(z.string()).optional(),
            env: z.array(z.object({ name: z.string() }).loose()).optional(),
            volumeMounts: z
              .array(z.object({ mountPath: z.string() }).loose())
              .optional(),
          }),
        ),
        containers: z.array(
          z.object({
            image: z.string(),
            env: z.array(z.object({ name: z.string() }).loose()).optional(),
            resources: z
              .object({
                requests: z.record(z.string(), z.string()),
                limits: z.record(z.string(), z.string()),
              })
              .optional(),
          }),
        ),
      }),
    }),
  }),
});

function serverDeployment() {
  return PodSpecSchema.parse(
    findTemporalResource(resources(), "Deployment", "temporal-temporal-server"),
  ).spec.template.spec;
}

/**
 * `temporalio/server` is not `temporalio/auto-setup`. It ships no
 * config_template.yaml, its entrypoint is a bare `exec temporal-server start`
 * with no dockerize step, and its config loader expands no environment
 * variables. Configuration therefore has to be a real file, complete, before
 * the server starts — and none of that is observable from typecheck, lint or
 * helm rendering, so it is pinned here.
 */
describe("Temporal server configuration", () => {
  test("configures PostgreSQL identity in the config itself", () => {
    const configMap = findTemporalResource(
      resources(),
      "ConfigMap",
      "temporal-server-config",
    );
    const config = z
      .object({ "development.yaml": z.string() })
      .parse(configMap.data)["development.yaml"];

    // Trust the stable CA (ca.crt), never the rotating leaf's own tls.crt:
    // the leaf's key rotates on every cert-manager renewal while this
    // long-running server only re-reads its trust file on restart.
    expect(config).toContain('caFile: "/etc/temporal/postgres-tls/ca.crt"');
    expect(config).toContain("enableHostVerification: true");
    expect(config).not.toContain("enableHostVerification: false");

    // Host verification only means something against the name in the cert.
    expect(config).toContain(
      'connectAddr: "temporal-postgresql.temporal.svc.cluster.local:5432"',
    );
    expect(config).toContain(
      'serverName: "temporal-postgresql.temporal.svc.cluster.local"',
    );

    // IMMUTABLE for the life of the cluster. Changing this does not fail
    // loudly, it corrupts the deployment.
    expect(config).toContain("numHistoryShards: 512");

    // Rendered per pod, so no literal may ever be committed here.
    expect(config).toContain("__POSTGRES_PASSWORD__");
    expect(config).toContain("__POD_IP__");
    expect(config).toContain('bindOnIP: "0.0.0.0"');
  });

  test("renders the config before the server reads it", () => {
    const spec = serverDeployment();
    const [configInit] = spec.initContainers;
    if (configInit === undefined) {
      throw new Error("Temporal server has no config-render init container");
    }

    expect(configInit.image).toBe(spec.containers[0]?.image);
    const script = configInit.args?.join(" ") ?? "";

    // The previous init container copied
    // /etc/temporal/config/config_template.yaml out of the image. That file
    // exists in auto-setup and in no version of temporalio/server, so the pod
    // died at container init with no logs at all. Never reintroduce it.
    expect(script).not.toContain("config_template.yaml");

    expect(script).toContain("__POSTGRES_PASSWORD__");
    expect(script).toContain("__POD_IP__");
    // A surviving placeholder would start the server against a config that
    // cannot authenticate.
    expect(script).toContain("still contains a placeholder");

    const names = new Set((configInit.env ?? []).map((e) => e.name));
    expect(names.has("POSTGRES_PWD")).toBe(true);
    expect(names.has("POD_IP")).toBe(true);

    expect(configInit.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mountPath: "/config-template" }),
        expect.objectContaining({ mountPath: "/etc/temporal/config" }),
      ]),
    );
  });

  test("tells the server where its config is, which start does not infer", () => {
    const spec = serverDeployment();
    const env = new Map(
      (spec.containers[0]?.env ?? []).map((entry) => [
        entry.name,
        entry["value"],
      ]),
    );

    // Without this, `temporal-server start` logs "Loading configuration from
    // environment variables only", renders its own embedded template and dies
    // on Cassandra defaults, with the rendered config unread beside it. It is
    // a silent fallback, not an error about a missing file.
    //
    // `render-config` defaults the other way and DOES discover config files,
    // so validating the config with that subcommand cannot catch this.
    expect(env.get("TEMPORAL_SERVER_CONFIG_FILE_PATH")).toBe(
      "/etc/temporal/config/development.yaml",
    );
  });

  test("keeps the database credential out of the server container", () => {
    const spec = serverDeployment();
    const names = new Set(
      (spec.containers[0]?.env ?? []).map((entry) => entry.name),
    );
    // Only the init container renders the credential; the long-running
    // server has no need of it.
    expect(names.has("POSTGRES_PWD")).toBe(false);
  });

  test("has enough memory headroom for the production schedule fleet", () => {
    const containerResources = serverDeployment().containers[0]?.resources;

    expect(containerResources).toEqual({
      requests: { cpu: "100m", memory: "3584Mi" },
      limits: { cpu: "1000m", memory: "5120Mi" },
    });
  });

  test("keeps Go's soft memory limit below the container limit", () => {
    const env = new Map(
      (serverDeployment().containers[0]?.env ?? []).map((entry) => [
        entry.name,
        entry["value"],
      ]),
    );
    // 3200 MiB of the 4096 MiB limit leaves room for non-heap memory.
    expect(env.get("GOMEMLIMIT")).toBe("3200MiB");
  });

  test("drops only the unused matching-service histograms", () => {
    const monitor = z
      .object({
        spec: z.object({
          endpoints: z.array(
            z.object({
              metricRelabelings: z.array(
                z.object({
                  sourceLabels: z.array(z.string()),
                  regex: z.string(),
                  action: z.string(),
                }),
              ),
            }),
          ),
        }),
      })
      .parse(
        findTemporalResource(
          resources(),
          "ServiceMonitor",
          "temporal-server-metrics-service-monitor",
        ),
      );
    const [relabeling] = monitor.spec.endpoints[0]?.metricRelabelings ?? [];
    expect(relabeling?.action).toBe("drop");
    expect(relabeling?.sourceLabels).toEqual(["__name__"]);
    const dropped = new RegExp(`^(?:${relabeling?.regex ?? ""})$`, "u");
    for (const name of [
      "poll_latency_bucket",
      "pri_poll_latency_count",
      "task_dispatch_latency_bucket",
      "syncmatch_latency_sum",
      "pri_task_write_latency_bucket",
    ]) {
      expect(dropped.test(name), name).toBe(true);
    }
    // Alerts and dashboards read these; they must survive the drop.
    for (const name of [
      "task_schedule_to_start_latency_bucket",
      "schedule_action_delay_bucket",
      "service_errors_nondeterministic",
      "service_latency_bucket",
    ]) {
      expect(dropped.test(name), name).toBe(false);
    }
  });
});
