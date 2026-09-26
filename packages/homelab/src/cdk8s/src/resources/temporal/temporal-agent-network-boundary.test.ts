import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";

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
  volumeMounts: z
    .array(
      z.object({
        name: z.string(),
        mountPath: z.string(),
        readOnly: z.boolean().optional(),
      }),
    )
    .optional(),
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
        automountServiceAccountToken: z.boolean(),
        securityContext: z
          .object({ fsGroup: z.number().optional() })
          .optional(),
        containers: z.array(ContainerSchema),
        initContainers: z.array(ContainerSchema),
        volumes: z.array(z.looseObject({ name: z.string() })),
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
    egress: z.array(z.unknown()).optional(),
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
      capabilities: {
        add: ["CHOWN", "DAC_OVERRIDE", "KILL", "SETGID", "SETUID"],
        drop: ["ALL"],
      },
    });
    expect(deployment.spec.template.spec.automountServiceAccountToken).toBe(
      false,
    );
    expect(
      deployment.spec.template.spec.securityContext?.fsGroup,
    ).toBeUndefined();
    expect(
      deployment.spec.template.spec.volumes.find(
        (volume) => volume.name === "provider-hidden-service-account",
      ),
    ).toMatchObject({
      projected: {
        defaultMode: 384,
        sources: expect.arrayContaining([
          {
            serviceAccountToken: {
              path: "token",
              expirationSeconds: 3600,
            },
          },
        ]),
      },
    });
    expect(worker.volumeMounts).toContainEqual({
      name: "provider-hidden-service-account",
      mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
      readOnly: true,
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
    expect(JSON.stringify(agent.spec.egress)).toContain("seaweedfs");
    expect(JSON.stringify(agent.spec.egress)).toContain("8333");
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
