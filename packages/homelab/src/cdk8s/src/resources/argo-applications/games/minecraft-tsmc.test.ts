import { describe, expect, it } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createMinecraftTsmcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts";

const OpItemSchema = z
  .object({
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z.object({ itemPath: z.string() }).loose(),
  })
  .loose();

const MinecraftAppSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z
      .object({
        source: z.object({
          helm: z.object({
            valuesObject: z.object({
              extraEnv: z.object({
                STORM_BRAIN_BEARER_TOKEN: z.object({
                  valueFrom: z.object({
                    secretKeyRef: z.object({
                      name: z.string(),
                      key: z.string(),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
      .loose(),
  })
  .loose();

function synthTsmc(): unknown[] {
  const app = new App();
  const chart = new Chart(app, "test", { disableResourceNameHashes: true });
  createMinecraftTsmcApp(chart);
  return Testing.synth(chart);
}

describe("minecraft-tsmc storm-brain wiring", () => {
  it("syncs the owning storm-brain vault item into the game namespace", () => {
    // Secrets cannot cross namespaces: the game pod cannot mount the
    // storm-brain namespace secret, so the same owning 1Password item is
    // synced again here. Only the token field is consumed (below).
    const item = synthTsmc()
      .map((manifest) => OpItemSchema.safeParse(manifest))
      .find(
        (result) =>
          result.success &&
          result.data.metadata.name === "minecraft-tsmc-storm-brain",
      )?.data;
    if (item === undefined) {
      throw new Error("Missing OnePasswordItem/minecraft-tsmc-storm-brain");
    }
    expect(item.spec.itemPath).toMatch(/\/items\/storm-brain$/);
  });

  it("injects the shared bearer token as an explicit secretKeyRef", () => {
    // The agent module aborts plugin startup without
    // STORM_BRAIN_BEARER_TOKEN; this must match the token projected into
    // the storm-brain namespace (same vault item).
    const application = synthTsmc()
      .map((manifest) => MinecraftAppSchema.safeParse(manifest))
      .find(
        (result) =>
          result.success && result.data.metadata.name === "minecraft-tsmc",
      )?.data;
    if (application === undefined) {
      throw new Error("Missing Application/minecraft-tsmc manifest");
    }
    expect(
      application.spec.source.helm.valuesObject.extraEnv
        .STORM_BRAIN_BEARER_TOKEN.valueFrom.secretKeyRef,
    ).toEqual({
      name: "minecraft-tsmc-storm-brain",
      key: "STORM_BRAIN_BEARER_TOKEN",
    });
  });
});
