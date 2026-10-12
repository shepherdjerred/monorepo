import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findResource,
  scoutResources,
} from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";

const DeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z.array(
        z
          .object({
            env: z.array(
              z
                .object({ name: z.string(), value: z.string().optional() })
                .loose(),
            ),
            ports: z
              .array(z.object({ containerPort: z.number() }).loose())
              .optional(),
          })
          .loose(),
      ),
    }),
  }),
});

const ServiceMonitorSpecSchema = z.object({
  endpoints: z.array(z.object({ port: z.string() }).loose()),
  selector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
});

const NetworkPolicySpecSchema = z.object({
  ingress: z.array(
    z
      .object({
        ports: z.array(z.object({ port: z.number() }).loose()).optional(),
      })
      .loose(),
  ),
});

/** Each runtime role's container, keyed by its SCOUT_RUNTIME_ROLE. */
function containersByRole(stage: "beta" | "prod") {
  const byRole = new Map<
    string,
    z.infer<
      typeof DeploymentSpecSchema
    >["template"]["spec"]["containers"][number]
  >();
  for (const resource of scoutResources(stage)) {
    if (resource.kind !== "Deployment") continue;
    const spec = DeploymentSpecSchema.parse(resource.spec);
    for (const container of spec.template.spec.containers) {
      const role = container.env.find(
        (entry) => entry.name === "SCOUT_RUNTIME_ROLE",
      )?.value;
      if (role !== undefined) byRole.set(role, container);
    }
  }
  return byRole;
}

describe.each(["beta", "prod"] as const)(
  "%s embedded Temporal Worker metrics",
  (stage) => {
    // These two roles run every unversioned Scout Workflow and Activity; the
    // SDK's per-attempt Workflow Task failure counters exist only if they
    // export them.
    test.each(["application", "activity-worker"])(
      "the %s role exports and exposes the SDK metrics",
      (role) => {
        const container = containersByRole(stage).get(role);
        expect(container, role).toBeDefined();
        expect(container?.env).toContainEqual({
          name: "TEMPORAL_METRICS_ADDRESS",
          value: "0.0.0.0:9464",
        });
        expect(container?.ports?.map((port) => port.containerPort)).toContain(
          9464,
        );
      },
    );

    test("the gateway role, which runs no Workers, does not", () => {
      const container = containersByRole(stage).get("gateway");
      expect(container).toBeDefined();
      expect(container?.env.map((entry) => entry.name)).not.toContain(
        "TEMPORAL_METRICS_ADDRESS",
      );
    });

    test.each([
      [`scout-temporal-${stage}-service-monitor`, "scout"],
      [
        `scout-activity-worker-temporal-${stage}-service-monitor`,
        "scout-activity-worker",
      ],
    ])("%s scrapes the exporter port", (name, app) => {
      const spec = ServiceMonitorSpecSchema.parse(
        findResource(scoutResources(stage), "ServiceMonitor", name).spec,
      );
      expect(spec.endpoints.map((endpoint) => endpoint.port)).toEqual([
        "temporal-sdk",
      ]);
      expect(spec.selector.matchLabels).toEqual({ app, stage });
    });

    test.each(["scout-ingress-netpol", "scout-activity-worker-netpol"])(
      "%s admits Prometheus to the exporter port",
      (name) => {
        const spec = NetworkPolicySpecSchema.parse(
          findResource(scoutResources(stage), "NetworkPolicy", name).spec,
        );
        const ports = spec.ingress.flatMap(
          (rule) => rule.ports?.map((port) => port.port) ?? [],
        );
        expect(ports).toContain(9464);
      },
    );
  },
);
