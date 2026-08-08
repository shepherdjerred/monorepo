import { beforeEach, describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createAlertDashboardChart } from "./cdk8s-charts/alert-dashboard.ts";
import { createPostalChart } from "./cdk8s-charts/postal.ts";
import { createAppsChart } from "./cdk8s-charts/apps.ts";
import { createAlertDashboardApp } from "./resources/argo-applications/alert-dashboard.ts";
import {
  getRegisteredBackendProbes,
  resetProbeRegistry,
} from "./misc/probe-registry.ts";

const SelectorSchema = z.object({
  matchLabels: z.record(z.string(), z.string()).optional(),
});

const PeerSchema = z
  .object({
    namespaceSelector: SelectorSchema.optional(),
    podSelector: SelectorSchema.optional(),
  })
  .loose();

const RuleSchema = z.object({
  from: z.array(PeerSchema).optional(),
  to: z.array(PeerSchema).optional(),
  ports: z
    .array(
      z.object({
        port: z.union([z.number(), z.string()]),
        protocol: z.string().optional(),
      }),
    )
    .optional(),
});

const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    ingress: z.array(RuleSchema).optional(),
    egress: z.array(RuleSchema).optional(),
  }),
});

const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.string() }),
});

type Rule = z.infer<typeof RuleSchema>;
type Peer = z.infer<typeof PeerSchema>;

beforeEach(resetProbeRegistry);

function findPolicy(yaml: string, name: string) {
  for (const document of yaml.split(/^---$/mu)) {
    const parsed: unknown = parseYaml(document);
    const result = NetworkPolicySchema.safeParse(parsed);
    if (result.success && result.data.metadata.name === name) {
      return result.data;
    }
  }
  throw new Error(`${name} was not synthesized`);
}

function applicationNames(yaml: string): string[] {
  return yaml
    .split(/^---$/mu)
    .map((document) => ApplicationSchema.safeParse(parseYaml(document)))
    .filter((result) => result.success)
    .map((result) => result.data.metadata.name);
}

function hasPort(rule: Rule, port: number): boolean {
  return (rule.ports ?? []).some(
    (candidate) => candidate.port === port && candidate.protocol === "TCP",
  );
}

function hasPeer(
  peers: readonly Peer[] | undefined,
  namespace: string,
  app?: string,
): boolean {
  return (peers ?? []).some(
    (peer) =>
      peer.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"] ===
        namespace &&
      (app === undefined || peer.podSelector?.matchLabels?.["app"] === app),
  );
}

function allowsIngress(
  rules: readonly Rule[] | undefined,
  namespace: string,
  port: number,
  app?: string,
): boolean {
  return (rules ?? []).some(
    (rule) => hasPort(rule, port) && hasPeer(rule.from, namespace, app),
  );
}

describe("alert dashboard network paths", () => {
  it("keeps deployment activation gated on a real public image digest", async () => {
    const app = new App({ outdir: ".test-synth-alert-dashboard-app-gate" });
    await createAppsChart(app);
    const activeApplications = applicationNames(app.synthYaml());

    expect(activeApplications).not.toContain("alert-dashboard");

    const definitionApp = new App({
      outdir: ".test-synth-alert-dashboard-app-definition",
    });
    const chart = new Chart(definitionApp, "alert-dashboard-app-definition");
    createAlertDashboardApp(chart);

    expect(applicationNames(definitionApp.synthYaml())).toContain(
      "alert-dashboard",
    );
  });

  it("allows primary and fallback delivery into Postal", () => {
    const app = new App({ outdir: ".test-synth-alert-dashboard-postal" });
    createPostalChart(app);
    const yaml = app.synthYaml();
    const web = findPolicy(yaml, "postal-web-netpol");
    const smtp = findPolicy(yaml, "postal-smtp-netpol");

    expect(allowsIngress(web.spec.ingress, "alert-dashboard", 5000)).toBe(true);
    expect(allowsIngress(smtp.spec.ingress, "prometheus", 25)).toBe(true);
  });

  it("does not admit deferred runtime consumers before activation", () => {
    const dashboardApp = new App({
      outdir: ".test-synth-alert-dashboard-readers",
    });
    createAlertDashboardChart(dashboardApp);
    const dashboard = findPolicy(
      dashboardApp.synthYaml(),
      "alert-dashboard-app-netpol",
    );

    expect(allowsIngress(dashboard.spec.ingress, "temporal", 7341)).toBe(false);
    expect(allowsIngress(dashboard.spec.ingress, "trmnl-dashboard", 7341)).toBe(
      false,
    );
  });

  it("does not register a service probe before activation", () => {
    const app = new App({ outdir: ".test-synth-alert-dashboard-probe-gate" });
    createAlertDashboardChart(app);

    expect(getRegisteredBackendProbes()).not.toContainEqual(
      expect.objectContaining({
        namespace: "alert-dashboard",
        serviceName: "alert-dashboard-service",
      }),
    );
  });
});
