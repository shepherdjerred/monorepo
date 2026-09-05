import { describe, expect, it } from "vitest";
import { Testing } from "cdk8s";
import { z } from "zod";
import { createMarioKartApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/mario-kart.ts";
import { createPokemonApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/pokemon.ts";

const ApplicationSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({ name: z.string() }),
    spec: z.object({ syncPolicy: z.unknown().optional() }).loose(),
  })
  .loose();

describe("Discord Applications", () => {
  it("restore automatic synchronization", () => {
    const chart = Testing.chart();
    createMarioKartApp(chart);
    createPokemonApp(chart);

    const applications = z
      .array(z.unknown())
      .parse(Testing.synth(chart))
      .flatMap((manifest) => {
        const parsed = ApplicationSchema.safeParse(manifest);
        return parsed.success &&
          ["mario-kart", "pokemon"].includes(parsed.data.metadata.name)
          ? [parsed.data]
          : [];
      });

    expect(applications).toHaveLength(2);
    for (const application of applications) {
      expect(application.spec.syncPolicy).toEqual({
        automated: { enabled: true },
      });
    }
  });
});
