import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const SecurityContextSchema = z.object({
  allowPrivilegeEscalation: z.boolean(),
  capabilities: z.object({
    add: z.array(z.string()),
    drop: z.array(z.string()),
  }),
  runAsUser: z.number(),
});

const ContainerSchema = z.object({
  name: z.string(),
  args: z.array(z.string()).optional(),
  env: z.array(z.object({ name: z.string(), value: z.string().optional() })),
  securityContext: SecurityContextSchema,
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    template: z.object({
      metadata: z.object({
        annotations: z.record(z.string(), z.string()),
        labels: z.record(z.string(), z.string()),
      }),
      spec: z.object({
        containers: z.array(ContainerSchema),
        initContainers: z.array(ContainerSchema),
      }),
    }),
  }),
});

const NamespaceSchema = z.object({
  kind: z.literal("Namespace"),
  metadata: z.object({
    name: z.string(),
    labels: z.record(z.string(), z.string()),
  }),
});

const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    podSelector: z.object({
      matchLabels: z.record(z.string(), z.string()),
    }),
    ingress: z
      .array(
        z.object({
          from: z
            .array(
              z.object({
                podSelector: z
                  .object({
                    matchLabels: z.record(z.string(), z.string()).optional(),
                    matchExpressions: z.array(z.unknown()).optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
});

function resources(): unknown[] {
  const app = new App({ outdir: ".test-synth-temporal-agent-boundary" });
  createTemporalChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    document.toJSON(),
  );
}

describe("Temporal agent provider network boundary", () => {
  test("permits the explicit firewall capabilities while auditing baseline", () => {
    const namespaces = resources().flatMap((resource) => {
      const parsed = NamespaceSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const namespace = namespaces.find(
      (candidate) => candidate.metadata.name === "temporal",
    );
    if (namespace === undefined) {
      throw new Error("Temporal Namespace was not synthesized");
    }

    expect(namespace.metadata.labels).toMatchObject({
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/audit": "baseline",
      "pod-security.kubernetes.io/warn": "baseline",
    });
  });

  test("rolls the agent worker when its admission contract changes", () => {
    const synthesized = resources();
    const namespace = synthesized.flatMap((resource) => {
      const parsed = NamespaceSchema.safeParse(resource);
      return parsed.success && parsed.data.metadata.name === "temporal"
        ? [parsed.data]
        : [];
    })[0];
    const deployment = synthesized.flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success &&
        parsed.data.metadata.name === "temporal-temporal-agent-worker"
        ? [parsed.data]
        : [];
    })[0];
    if (namespace === undefined || deployment === undefined) {
      throw new Error(
        "Temporal Namespace and agent worker Deployment must be synthesized",
      );
    }

    expect(
      deployment.spec.template.metadata.annotations[
        "ci.sjer.red/pod-security-enforcement"
      ],
    ).toBe(namespace.metadata.labels["pod-security.kubernetes.io/enforce"]);
  });

  test("runs provider commands under a firewalled uid distinct from the poller", () => {
    const deployments = resources().flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const deployment = deployments.find(
      (candidate) =>
        candidate.metadata.name === "temporal-temporal-agent-worker",
    );
    if (deployment === undefined) {
      throw new Error("Temporal agent worker Deployment was not synthesized");
    }

    expect(deployment.spec.template.metadata.labels["app"]).toBe(
      "temporal-agent-worker",
    );
    const worker = deployment.spec.template.spec.containers[0];
    const firewall = deployment.spec.template.spec.initContainers[0];
    if (worker === undefined || firewall === undefined) {
      throw new Error(
        "Temporal agent worker requires worker and firewall containers",
      );
    }

    expect(worker.securityContext).toMatchObject({
      runAsUser: 0,
      allowPrivilegeEscalation: false,
      capabilities: { add: ["SETUID"], drop: ["ALL"] },
    });
    expect(
      worker.env.find((variable) => variable.name === "AGENT_PROVIDER_UID")
        ?.value,
    ).toBe("1001");
    expect(firewall).toMatchObject({
      name: "install-provider-firewall",
      securityContext: {
        runAsUser: 0,
        allowPrivilegeEscalation: false,
        capabilities: { add: ["NET_ADMIN"], drop: ["ALL"] },
      },
    });
    const rules = firewall.args?.join("\n") ?? "";
    expect(rules).toContain("--uid-owner 1001");
    expect(rules).toContain("for firewall in iptables ip6tables");
    expect(rules).toContain("for port in 7233 8080");
    expect(rules).toContain("temporal.tailnet-1a49.ts.net");
    expect(rules).toContain("temporal-ui.tailnet-1a49.ts.net");
    expect(rules).toContain("*:*) firewall=ip6tables");
    expect(rules).toContain('-d "$address" --dport 443');
    expect(rules).toContain("--reject-with tcp-reset");
  });

  test("keeps agent pods out of the broad infra policy", () => {
    const policies = resources().flatMap((resource) => {
      const parsed = NetworkPolicySchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const infra = policies.find(
      (policy) => policy.metadata.name === "temporal-infra-worker-netpol",
    );
    const agent = policies.find(
      (policy) => policy.metadata.name === "temporal-agent-worker-netpol",
    );
    const server = policies.find(
      (policy) => policy.metadata.name === "temporal-server-netpol",
    );
    if (infra === undefined || agent === undefined || server === undefined) {
      throw new Error("Temporal worker network policies were not synthesized");
    }

    expect(infra.spec.podSelector.matchLabels["component"]).toBe(
      "infra-worker",
    );
    expect(agent.spec.podSelector.matchLabels["component"]).toBe(
      "agent-worker",
    );
    expect(
      (server.spec.ingress ?? []).some((entry) =>
        (entry.from ?? []).some(
          (source) =>
            source.podSelector?.matchLabels?.["app"] ===
            "temporal-agent-worker",
        ),
      ),
    ).toBe(true);
  });
});
