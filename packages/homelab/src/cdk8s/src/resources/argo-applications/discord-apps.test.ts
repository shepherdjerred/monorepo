import { describe, expect, it } from "bun:test";
import { Testing } from "cdk8s";
import { z } from "zod";
import { createMarioKartApp } from "./mario-kart.ts";
import { createPokemonApp } from "./pokemon.ts";

const ApplicationSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({ name: z.string() }),
    spec: z.object({ syncPolicy: z.unknown().optional() }).loose(),
  })
  .loose();

describe("deferred Discord Applications", () => {
  it("omit syncPolicy instead of rendering a null Argo field", () => {
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
      expect(application.spec).not.toHaveProperty("syncPolicy");
    }
  });
});
