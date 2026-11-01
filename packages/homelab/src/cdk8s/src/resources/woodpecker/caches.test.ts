import { expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { CI_WORKSPACE_VOLUME_SIZE } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
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
  spec: z.looseObject({
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
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

test("workspaces and the golden claim share one whole-GiB size, so a clone equals its snapshot", () => {
  // ZFS rounds a volume up to whole GiB; a decimal size would leave the
  // snapshot larger than the clones that request it.
  expect(CI_WORKSPACE_VOLUME_SIZE).toMatch(/^[1-9]\d*Gi$/u);
  const chart = new Chart(new App(), "caches");
  createWoodpeckerCaches(chart);
  const golden = chart
    .toJson()
    .flatMap((manifest: unknown) => {
      const claim = ClaimSchema.safeParse(manifest);
      return claim.success ? [claim.data] : [];
    })
    .find((claim) => claim.metadata.name === WOODPECKER_WORKSPACE_GOLDEN_CLAIM);
  expect(golden?.spec.resources.requests.storage).toBe(
    CI_WORKSPACE_VOLUME_SIZE,
  );
});
