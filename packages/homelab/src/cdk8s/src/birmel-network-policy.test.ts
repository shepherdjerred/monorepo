import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createBirmelChart } from "./cdk8s-charts/birmel.ts";

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

const BirmelDeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.literal("birmel") }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            name: z.literal("main"),
            env: z.array(z.object({ name: z.string() }).loose()),
            ports: z.array(
              z.object({ name: z.string(), containerPort: z.number() }),
            ),
            startupProbe: z.unknown(),
            livenessProbe: z.unknown(),
            readinessProbe: z.unknown(),
          }),
        ),
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
  it("allows external UDP egress for Discord voice audio", () => {
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

    const allowsDiscordVoiceUdp = (birmelEgress.spec?.egress ?? []).some(
      (rule) => {
        const allowsExternal = (rule.to ?? []).some(
          (peer) => peer.ipBlock?.cidr === "0.0.0.0/0",
        );
        const allowsUdp = (rule.ports ?? []).some(
          (port) =>
            port.protocol === "UDP" &&
            port.port === 50_000 &&
            port.endPort === 65_535,
        );

        return allowsExternal && allowsUdp;
      },
    );

    expect(allowsDiscordVoiceUdp).toBe(true);
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
    const container = deployment.data.spec.template.spec.containers[0];
    if (container == null) {
      throw new Error("birmel container was not synthesized");
    }
    expect(container.ports).toContainEqual({
      name: "health",
      containerPort: 8080,
    });
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
    const environmentNames = container.env.map(({ name }) => name);
    expect(environmentNames).toContain("HEALTH_PORT");
    expect(environmentNames).not.toContain("MEMORY_DB_PATH");
    expect(environmentNames).not.toContain("MASTRA_MEMORY_DB_PATH");
  });
});
