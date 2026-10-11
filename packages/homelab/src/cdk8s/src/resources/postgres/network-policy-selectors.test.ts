import { describe, expect, it } from "vitest";
import type { App } from "cdk8s";
import { App as CdkApp } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createAlertDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/alert-dashboard.ts";
import { createBugsinkChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/bugsink.ts";
import { createPhoenixChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/phoenix.ts";
import { createPostalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/postal.ts";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";
import { POSTGRES_CLUSTER_NAME_LABEL } from "./cluster-label.ts";

const LabelsSchema = z.record(z.string(), z.string());
const SelectorSchema = z.object({ matchLabels: LabelsSchema.optional() });
const PeerSchema = z.object({ podSelector: SelectorSchema.optional() }).loose();
const RuleSchema = z
  .object({
    from: z.array(PeerSchema).optional(),
    to: z.array(PeerSchema).optional(),
  })
  .loose();
const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string() }),
  spec: z
    .object({
      podSelector: SelectorSchema,
      ingress: z.array(RuleSchema).optional(),
      egress: z.array(RuleSchema).optional(),
    })
    .loose(),
});
const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      metadata: z.object({ labels: LabelsSchema.optional() }).loose(),
    }),
  }),
});

type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

function synthesize(create: (app: App) => unknown, outdir: string): unknown[] {
  const app = new CdkApp({ outdir });
  create(app);
  return parseAllDocuments(app.synthYaml()).map((document) => document.toJS());
}

function policies(documents: unknown[]): NetworkPolicy[] {
  return documents.flatMap((document) => {
    const parsed = NetworkPolicySchema.safeParse(document);
    return parsed.success ? [parsed.data] : [];
  });
}

function selectors(policy: NetworkPolicy): Record<string, string>[] {
  const peers = [...(policy.spec.ingress ?? []), ...(policy.spec.egress ?? [])]
    .flatMap((rule) => [...(rule.from ?? []), ...(rule.to ?? [])])
    .flatMap((peer) =>
      peer.podSelector?.matchLabels === undefined
        ? []
        : [peer.podSelector.matchLabels],
    );
  const own = policy.spec.podSelector.matchLabels;
  return own === undefined ? peers : [own, ...peers];
}

describe("database NetworkPolicy selectors", () => {
  it.each([
    ["temporal", createTemporalChart, "temporal-postgresql"],
    ["bugsink", createBugsinkChart, "bugsink-postgresql"],
    ["phoenix", createPhoenixChart, "phoenix-postgresql"],
    ["woodpecker", createWoodpeckerChart, "woodpecker-postgresql"],
  ] as const)(
    "%s selects its PostgreSQL pods by the operator's cluster label",
    (name, create, cluster) => {
      const labels = policies(
        synthesize(create, `.test-synth-pg-selectors-${name}`),
      ).flatMap((policy) => selectors(policy));
      const clusterSelectors = labels.filter((selector) =>
        Object.values(selector).includes(cluster),
      );

      expect(clusterSelectors.length).toBeGreaterThan(0);
      for (const selector of clusterSelectors) {
        expect(selector).toEqual({ [POSTGRES_CLUSTER_NAME_LABEL]: cluster });
      }
    },
  );

  it("selects Postal's MariaDB pod by the chart's labels", () => {
    const labels = policies(
      synthesize(createPostalChart, ".test-synth-pg-selectors-postal"),
    ).flatMap((policy) => selectors(policy));

    expect(labels).not.toContainEqual({ app: "postal-mariadb" });
    expect(labels).toContainEqual({
      "app.kubernetes.io/instance": "postal-mariadb",
      "app.kubernetes.io/name": "mariadb",
    });
  });

  it("labels the alert dashboard pod the way its policy selects it", () => {
    const documents = synthesize(
      createAlertDashboardChart,
      ".test-synth-pg-selectors-alert-dashboard",
    );
    const policy = policies(documents).find(
      (candidate) => candidate.metadata.name === "alert-dashboard-app-netpol",
    );
    const podLabels = documents.flatMap((document) => {
      const parsed = DeploymentSchema.safeParse(document);
      return parsed.success ? [parsed.data.spec.template.metadata.labels] : [];
    });

    expect(policy?.spec.podSelector.matchLabels).toEqual({
      app: "alert-dashboard",
    });
    expect(podLabels).toHaveLength(1);
    expect(podLabels[0]).toMatchObject({ app: "alert-dashboard" });
  });
});
