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
          (port) => port.protocol === "UDP" && port.port === undefined,
        );

        return allowsExternal && allowsUdp;
      },
    );

    expect(allowsDiscordVoiceUdp).toBe(true);
  });
});
