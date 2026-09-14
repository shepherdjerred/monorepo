import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createBirmelChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/birmel.ts";

const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string().optional() }).optional(),
  spec: z
    .object({
      egress: z
        .array(
          z.object({
            to: z
              .array(
                z
                  .object({
                    ipBlock: z
                      .object({
                        cidr: z.string(),
                      })
                      .optional(),
                  })
                  .loose(),
              )
              .optional(),
            ports: z
              .array(
                z
                  .object({
                    protocol: z.string().optional(),
                    port: z.unknown().optional(),
                    endPort: z.number().optional(),
                  })
                  .loose(),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const InitContainerSchema = z.object({
  name: z.string(),
  args: z.array(z.string()),
  securityContext: z.record(z.string(), z.unknown()),
});

const BirmelDeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.literal("birmel") }),
  spec: z.object({
    template: z.object({
      metadata: z.object({
        annotations: z.record(z.string(), z.string()),
      }),
      spec: z.object({
        containers: z.array(
          z.object({
            name: z.string(),
            command: z.array(z.string()).optional(),
            env: z.array(z.object({ name: z.string() }).loose()).optional(),
            ports: z
              .array(z.object({ name: z.string(), containerPort: z.number() }))
              .optional(),
            volumeMounts: z
              .array(z.object({ mountPath: z.string() }))
              .optional(),
            securityContext: z.record(z.string(), z.unknown()).optional(),
            startupProbe: z.unknown().optional(),
            livenessProbe: z.unknown().optional(),
            readinessProbe: z.unknown().optional(),
            resources: z
              .object({
                requests: z.record(z.string(), z.string()).optional(),
                limits: z.record(z.string(), z.string()).optional(),
              })
              .optional(),
          }),
        ),
        automountServiceAccountToken: z.boolean(),
        initContainers: z.array(InitContainerSchema),
      }),
    }),
  }),
});

function parseSynthesizedDocuments(yamlContent: string): unknown[] {
  const documents = yamlContent
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0);

  return documents.map((document) => {
    const parsed: unknown = parseYaml(document);
    return parsed;
  });
}

describe("birmel NetworkPolicy", () => {
  it("opens no wide UDP egress now that voice playback is gone", () => {
    const app = new App({ outdir: ".test-synth-birmel" });
    createBirmelChart(app);

    let birmelEgress: z.infer<typeof NetworkPolicySchema> | undefined;

    for (const document of parseSynthesizedDocuments(app.synthYaml())) {
      const result = NetworkPolicySchema.safeParse(document);
      if (
        result.success &&
        result.data.metadata?.name === "birmel-egress-netpol"
      ) {
        birmelEgress = result.data;
      }
    }

    if (birmelEgress === undefined) {
      throw new Error("birmel-egress-netpol was not synthesized");
    }

    const allowsExternalUdp = (birmelEgress.spec?.egress ?? []).some((rule) => {
      const allowsExternal = (rule.to ?? []).some(
        (peer) => peer.ipBlock?.cidr === "0.0.0.0/0",
      );
      const allowsUdp = (rule.ports ?? []).some(
        (port) => port.protocol === "UDP",
      );

      return allowsExternal && allowsUdp;
    });

    expect(allowsExternalUdp).toBe(false);
  });
});

describe("birmel runtime deployment", () => {
  it("probes the explicit runtime and leaves legacy memory disconnected", () => {
    const app = new App({ outdir: ".test-synth-birmel-runtime" });
    createBirmelChart(app);
    const deployment = parseSynthesizedDocuments(app.synthYaml())
      .map((document) => BirmelDeploymentSchema.safeParse(document))
      .find((result) => result.success);
    if (deployment?.success !== true) {
      throw new Error("birmel Deployment was not synthesized");
    }
    const container = deployment.data.spec.template.spec.containers.find(
      ({ name }) => name === "main",
    );
    if (container == null) {
      throw new Error("birmel container was not synthesized");
    }
    expect(container.ports).toContainEqual({
      name: "health",
      containerPort: 8080,
    });
    expect(container.ports).not.toContainEqual(
      expect.objectContaining({ name: "oauth" }),
    );
    expect(container.startupProbe).toEqual({
      failureThreshold: 24,
      httpGet: { path: "/live", port: 8080, scheme: "HTTP" },
      periodSeconds: 5,
    });
    expect(container.livenessProbe).toEqual({
      failureThreshold: 3,
      httpGet: { path: "/live", port: 8080, scheme: "HTTP" },
      periodSeconds: 30,
    });
    expect(container.readinessProbe).toEqual({
      failureThreshold: 3,
      httpGet: { path: "/ready", port: 8080, scheme: "HTTP" },
      periodSeconds: 10,
    });
    const environmentNames = (container.env ?? []).map(({ name }) => name);
    expect(environmentNames).toContain("HEALTH_PORT");
    expect(environmentNames).not.toContain("MEMORY_DB_PATH");
    expect(environmentNames).not.toContain("MASTRA_MEMORY_DB_PATH");
    expect(environmentNames).not.toContain("EDITOR_ENABLED");

    const sandbox = deployment.data.spec.template.spec.containers.find(
      ({ name }) => name === "code-sandbox",
    );
    if (sandbox == null) {
      throw new Error("code sandbox sidecar was not synthesized");
    }
    expect(
      deployment.data.spec.template.spec.automountServiceAccountToken,
    ).toBe(false);
    expect((sandbox.env ?? []).map(({ name }) => name)).toEqual(["TZ"]);
    expect(sandbox.command).toEqual([
      "tini",
      "-s",
      "--",
      "bun",
      "src/sandbox/server.ts",
    ]);
    expect(sandbox.volumeMounts).toEqual([
      expect.objectContaining({ mountPath: "/tmp/birmel-sandbox" }),
    ]);
    expect(sandbox.resources).toEqual({
      requests: { cpu: "50m", memory: "256Mi" },
      limits: { cpu: "1000m", memory: "2560Mi" },
    });
    expect(sandbox.securityContext).toMatchObject({
      runAsUser: 0,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: {
        add: [
          "CHOWN",
          "DAC_OVERRIDE",
          "FOWNER",
          "KILL",
          "SETGID",
          "SETPCAP",
          "SETUID",
        ],
        drop: ["ALL"],
      },
    });
    expect(
      deployment.data.spec.template.metadata.annotations[
        "ci.sjer.red/pod-security-enforcement"
      ],
    ).toBe("privileged");
    const firewall = deployment.data.spec.template.spec.initContainers.find(
      ({ name }) => name === "install-code-sandbox-firewall",
    );
    if (firewall == null) {
      throw new Error("code sandbox firewall was not synthesized");
    }
    expect(firewall.securityContext).toMatchObject({
      runAsUser: 0,
      allowPrivilegeEscalation: false,
      capabilities: { add: ["NET_ADMIN"], drop: ["ALL"] },
    });
    const firewallRules = firewall.args.join("\n");
    expect(firewallRules).toContain("for uid in 1001 1002");
    expect(firewallRules).toContain('--uid-owner "$uid"');
  });
});
