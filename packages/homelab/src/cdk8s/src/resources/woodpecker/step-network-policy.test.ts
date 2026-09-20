import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";

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

const NetworkPolicySchema = z
  .object({
    kind: z.literal("NetworkPolicy"),
    metadata: z.object({ name: z.string() }).loose(),
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

  it("constrains both directions", () => {
    expect(stepPolicy().spec.policyTypes).toEqual(["Egress", "Ingress"]);
  });

  /**
   * Nothing dials a step pod: the agent drives steps through the Kubernetes
   * API, and a step's service containers share its pod and use localhost.
   */
  it("accepts no ingress", () => {
    expect(stepPolicy().spec.ingress).toEqual([]);
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
