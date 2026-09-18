import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createPinchtabChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/pinchtab.ts";

const NamespaceSchema = z.object({
  kind: z.literal("Namespace"),
  metadata: z.object({
    name: z.string(),
    labels: z.record(z.string(), z.string()),
  }),
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      metadata: z.object({
        annotations: z.record(z.string(), z.string()),
      }),
      spec: z.object({
        automountServiceAccountToken: z.boolean(),
        containers: z.array(
          z.object({
            name: z.string(),
            livenessProbe: z.object({
              exec: z.object({ command: z.array(z.string()) }),
            }),
            readinessProbe: z.object({
              exec: z.object({ command: z.array(z.string()) }),
            }),
          }),
        ),
        initContainers: z.array(
          z.object({
            name: z.string(),
            args: z.array(z.string()),
            securityContext: z.record(z.string(), z.unknown()),
          }),
        ),
      }),
    }),
  }),
});

const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    egress: z.array(
      z.object({
        ports: z
          .array(z.object({ port: z.number(), protocol: z.string() }))
          .optional(),
      }),
    ),
  }),
});

function resources(): unknown[] {
  const app = new App({ outdir: ".test-synth-pinchtab-boundary" });
  createPinchtabChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    document.toJSON(),
  );
}

describe("PinchTab network boundary", () => {
  test("admits only the explicit NET_ADMIN firewall init container", () => {
    const synthesized = resources();
    const namespace = synthesized.flatMap((resource) => {
      const parsed = NamespaceSchema.safeParse(resource);
      return parsed.success && parsed.data.metadata.name === "pinchtab"
        ? [parsed.data]
        : [];
    })[0];
    const deployment = synthesized.flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    })[0];
    if (namespace == null || deployment == null) {
      throw new Error("PinchTab namespace and Deployment must be synthesized");
    }
    expect(namespace.metadata.labels).toMatchObject({
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    });
    expect(
      deployment.spec.template.metadata.annotations[
        "ci.sjer.red/pod-security-enforcement"
      ],
    ).toBe("privileged");
    expect(deployment.spec.template.spec.automountServiceAccountToken).toBe(
      false,
    );
    const firewall = deployment.spec.template.spec.initContainers[0];
    if (firewall == null) {
      throw new Error("PinchTab firewall init container must be synthesized");
    }
    expect(firewall.securityContext).toMatchObject({
      runAsUser: 0,
      allowPrivilegeEscalation: false,
      capabilities: { add: ["NET_ADMIN"], drop: ["ALL"] },
    });
    const rules = firewall.args.join("\n");
    expect(rules).toContain("iptables -P OUTPUT DROP");
    expect(rules).toContain("100.64.0.0/10");
    expect(rules).toContain("fc00::/7");
    expect(rules).toContain("--dport 443 -j ACCEPT");
  });

  test("documents HTTPS-only public egress", () => {
    const policy = resources().flatMap((resource) => {
      const parsed = NetworkPolicySchema.safeParse(resource);
      return parsed.success &&
        parsed.data.metadata.name === "pinchtab-egress-netpol"
        ? [parsed.data]
        : [];
    })[0];
    if (policy == null) {
      throw new Error("PinchTab egress NetworkPolicy must be synthesized");
    }
    const ports = policy.spec.egress.flatMap((entry) => entry.ports ?? []);
    expect(ports).toContainEqual({ port: 443, protocol: "TCP" });
    expect(ports).not.toContainEqual({ port: 80, protocol: "TCP" });
  });

  test("keeps the API available while liveness recovers Chrome", () => {
    const deployment = resources().flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    })[0];
    const pinchtab = deployment?.spec.template.spec.containers[0];
    if (pinchtab == null) {
      throw new Error("PinchTab container must be synthesized");
    }
    expect(pinchtab.livenessProbe.exec.command.join(" ")).toContain(
      "/instances",
    );
    expect(pinchtab.readinessProbe.exec.command.join(" ")).toContain("/health");
  });
});
