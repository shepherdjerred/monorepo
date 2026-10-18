import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";
import { createWoodpeckerStepNetworkPolicy } from "./step-network-policy.ts";
import { createDeliveryNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/network-policy.ts";

async function emittedApiConsumers() {
  const process = Bun.spawn(
    [
      "bun",
      "-e",
      `
      import { buildPipelineSteps } from "./src/pipeline/steps.ts";
      import { emitWorkflow } from "./src/pipeline/emit.ts";
      import { TEST_IMAGES, TEST_IDENTITY } from "./test/identity.ts";
      import { parse } from "yaml";
      const consumers = buildPipelineSteps({images: TEST_IMAGES, changedBase: "base", deliveryPublication: true})
        .filter(step => step.secrets?.some(grant => grant.env === "DELIVERY_API_TOKEN"))
        .map(step => ({key: step.key, labels: parse(emitWorkflow(step, TEST_IDENTITY)).steps[0].backend_options.kubernetes.labels}));
      console.log(JSON.stringify(consumers));
    `,
    ],
    {
      cwd: fileURLToPath(
        new URL(
          "../../../../../../woodpecker-config-extension/",
          import.meta.url,
        ),
      ),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`CI emitter contract failed: ${stderr}`);
  return z
    .array(
      z.object({ key: z.string(), labels: z.record(z.string(), z.string()) }),
    )
    .parse(JSON.parse(stdout));
}

const PeerSchema = z
  .object({
    namespaceSelector: z
      .object({ matchLabels: z.record(z.string(), z.string()).optional() })
      .loose()
      .optional(),
    podSelector: z
      .object({ matchLabels: z.record(z.string(), z.string()).optional() })
      .loose()
      .optional(),
    ipBlock: z.object({ cidr: z.string() }).loose().optional(),
  })
  .loose();

const RuleSchema = z
  .object({
    to: z.array(PeerSchema).optional(),
    ports: z
      .array(
        z
          .object({
            port: z.union([z.number(), z.string()]),
            protocol: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const CiPeerSchema = z.object({
  podSelector: z.object({
    matchExpressions: z.array(
      z.object({ key: z.string(), operator: z.string() }),
    ),
  }),
});

const NetworkPolicySchema = z
  .object({
    kind: z.literal("NetworkPolicy"),
    metadata: z
      .object({ name: z.string(), namespace: z.string().optional() })
      .loose(),
    spec: z
      .object({
        podSelector: z
          .object({
            matchLabels: z.record(z.string(), z.string()).optional(),
            matchExpressions: z
              .array(
                z.object({ key: z.string(), operator: z.string() }).loose(),
              )
              .optional(),
          })
          .loose(),
        policyTypes: z.array(z.string()).optional(),
        ingress: z.array(z.unknown()).optional(),
        egress: z.array(RuleSchema).optional(),
      })
      .loose(),
  })
  .loose();

function documents(yamlContent: string): unknown[] {
  return yamlContent
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => parseYaml(document));
}

function stepPolicy() {
  const app = new App({ outdir: ".test-synth-woodpecker-step-netpol" });
  createWoodpeckerChart(app);
  const found = documents(app.synthYaml())
    .map((document) => NetworkPolicySchema.safeParse(document))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .find((policy) => policy.metadata.name === "woodpecker-step-netpol");
  if (found === undefined) {
    throw new Error("woodpecker-step-netpol was not synthesized");
  }
  return found;
}

/** Does any egress rule reach this port, and through what kind of peer? */
function egressTo(
  policy: z.infer<typeof NetworkPolicySchema>,
  port: number,
): z.infer<typeof RuleSchema>[] {
  return (policy.spec.egress ?? []).filter((rule) =>
    (rule.ports ?? []).some((entry) => entry.port === port),
  );
}

describe("CI step pod network boundary", () => {
  it("pairs exact real generator archive/publication Pod labels with both sides of Delivery HTTP access", async () => {
    const consumers = await emittedApiConsumers();
    expect(consumers.map((consumer) => consumer.key).toSorted()).toEqual([
      "delivery-publish",
      "helm-push",
      "images",
      "scout-site-archives",
      "trmnl-plugin-archives",
    ]);
    const api = new Chart(new App(), "delivery-network", {
      namespace: "delivery",
    });
    const ci = new Chart(new App(), "ci-network", {
      namespace: "woodpecker-ci",
    });
    createDeliveryNetworkPolicy(api);
    createWoodpeckerStepNetworkPolicy(ci);
    const apiPolicy = NetworkPolicySchema.parse(api.toJson()[0]);
    const ciPolicy = z
      .array(NetworkPolicySchema)
      .parse(ci.toJson())
      .find((policy) =>
        policy.metadata.name.includes("delivery-publication-egress"),
      );
    expect(apiPolicy.spec.podSelector.matchLabels).toEqual({ app: "delivery" });
    expect(ciPolicy?.metadata.namespace).toBe("woodpecker-ci");
    const Rule = z.object({
      from: z.array(PeerSchema),
      ports: z.array(z.object({ port: z.number(), protocol: z.string() })),
    });
    const peers = z
      .array(Rule)
      .parse(apiPolicy.spec.ingress)
      .flatMap((rule) =>
        rule.from
          .filter(
            (peer) =>
              peer.namespaceSelector?.matchLabels?.[
                "kubernetes.io/metadata.name"
              ] === "woodpecker-ci",
          )
          .map((peer) => {
            expect(rule.ports).toEqual([{ port: 7353, protocol: "TCP" }]);
            return peer;
          }),
      );
    expect(peers).toHaveLength(1);
    const Selector = z.object({
      matchExpressions: z.array(
        z.object({
          key: z.string(),
          operator: z.literal("In"),
          values: z.array(z.string()),
        }),
      ),
    });
    for (const selector of [
      Selector.parse(peers[0]?.podSelector),
      Selector.parse(ciPolicy?.spec.podSelector),
    ]) {
      expect(selector.matchExpressions).toHaveLength(1);
      const expression = selector.matchExpressions[0];
      expect(expression?.values.toSorted()).toEqual(
        consumers.map((consumer) => consumer.key).toSorted(),
      );
      for (const consumer of consumers)
        expect(expression?.values).toContain(
          consumer.labels[expression?.key ?? ""],
        );
      expect(expression?.values).not.toContain("verify");
      expect(expression?.values).not.toContain("scout-beta-release");
    }
    expect(ciPolicy?.spec.egress).toEqual([
      {
        to: [
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "delivery" },
            },
            podSelector: { matchLabels: { app: "delivery" } },
          },
        ],
        ports: [{ port: 7353, protocol: "TCP" }],
      },
    ]);
  });
  /**
   * Selecting by label existence rather than value is deliberate: the step key
   * and commit labels both vary per build, so there is no constant value to
   * match on, and requiring one would mean changing the emitter.
   */
  it("selects every generated step pod and nothing else", () => {
    const policy = stepPolicy();
    expect(policy.spec.podSelector.matchExpressions).toEqual([
      { key: "ci.sjer.red/step-key", operator: "Exists" },
    ]);
    expect(policy.spec.podSelector.matchLabels).toBeUndefined();
  });

  it("lives with the CI pods", () => {
    expect(stepPolicy().metadata.namespace).toBe("woodpecker-ci");
  });

  it("constrains both directions", () => {
    expect(stepPolicy().spec.policyTypes).toEqual(["Egress", "Ingress"]);
  });

  /**
   * A step's services are separate pods it reaches by hostname, so CI pods
   * must reach each other -- and nothing else may reach them. The agent
   * drives pods through the Kubernetes API, not the pod network.
   */
  it("accepts ingress only from other CI pods", () => {
    const ingress = stepPolicy().spec.ingress ?? [];
    expect(ingress).toHaveLength(1);
    const peers = z.object({ from: z.array(CiPeerSchema) }).parse(ingress[0]);
    expect(peers.from).toEqual([
      {
        podSelector: {
          matchExpressions: [
            { key: "ci.sjer.red/step-key", operator: "Exists" },
          ],
        },
      },
    ]);
  });

  it("reaches other CI pods, and no pod outside the namespace", () => {
    const rules = (stepPolicy().spec.egress ?? []).filter(
      (rule) => rule.ports === undefined,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.to).toEqual([
      {
        podSelector: {
          matchExpressions: [
            { key: "ci.sjer.red/step-key", operator: "Exists" },
          ],
        },
      },
    ]);
  });

  it("allows DNS", () => {
    const rules = egressTo(stepPolicy(), 53);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.to?.[0]?.podSelector?.matchLabels).toEqual({
      "k8s-app": "kube-dns",
    });
  });

  /**
   * The image lanes build through buildkitd's plaintext gRPC endpoint. This is
   * the one in-cluster destination a step needs, and the only rule here that
   * is not HTTPS; losing it would break every image build.
   */
  it("allows buildkitd, scoped to its namespace", () => {
    const rules = egressTo(stepPolicy(), 1234);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.to?.[0]?.namespaceSelector?.matchLabels).toEqual({
      "kubernetes.io/metadata.name": "buildkitd",
    });
    expect(rules[0]?.to?.[0]?.ipBlock).toBeUndefined();
  });

  it("allows outbound HTTPS", () => {
    const rules = egressTo(stepPolicy(), 443);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.to?.[0]?.ipBlock?.cidr).toBe("0.0.0.0/0");
  });

  /**
   * The point of the policy. Plaintext egress to arbitrary destinations is
   * what a broad rule would grant, and buildkitd is the single exception.
   */
  it("opens no other port", () => {
    const ports = new Set(
      (stepPolicy().spec.egress ?? []).flatMap((rule) =>
        (rule.ports ?? []).map((entry) => entry.port),
      ),
    );
    expect([...ports].sort((a, b) => Number(a) - Number(b))).toEqual([
      53, 443, 1234,
    ]);
  });
});
