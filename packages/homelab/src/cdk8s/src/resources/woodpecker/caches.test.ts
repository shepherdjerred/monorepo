import { expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import {
  createWoodpeckerCaches,
  WOODPECKER_WORKSPACE_GOLDEN_CLAIM,
} from "./caches.ts";

const ClaimSchema = z.looseObject({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.looseObject({
    name: z.string(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

test("only the golden claim, unbound until its first refresh, is left out of application health", () => {
  const chart = new Chart(new App(), "caches");
  createWoodpeckerCaches(chart);
  const claims = chart.toJson().flatMap((manifest: unknown) => {
    const claim = ClaimSchema.safeParse(manifest);
    return claim.success ? [claim.data] : [];
  });
  const ignored = claims
    .filter(
      (claim) =>
        claim.metadata.annotations?.[
          "argocd.argoproj.io/ignore-healthcheck"
        ] === "true",
    )
    .map((claim) => claim.metadata.name);
  expect(ignored).toEqual([WOODPECKER_WORKSPACE_GOLDEN_CLAIM]);
  expect(claims.length).toBeGreaterThan(1);
});
