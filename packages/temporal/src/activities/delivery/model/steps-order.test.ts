import { describe, expect, test, vi } from "vitest";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import { modelSteps, requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import type * as Stages from "./stages.ts";

const state = vi.hoisted(() => {
  const activated: string[] = [];
  const current: unknown = undefined;
  return { current, activated };
});
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  requireOwned: () => Promise.resolve(state.current),
}));
vi.mock("./lease.ts", () => ({
  stepLease: () => ({}),
  withLeaseRenewal: async (_lease: unknown, run: () => Promise<unknown>) =>
    await run(),
}));
vi.mock("./static-site.ts", () => ({
  runStaticSiteStep: (_current: unknown, _policy: unknown, key: string) => {
    state.activated.push(key);
    return Promise.resolve();
  },
}));

const { runDeliveryModelStep } = await import("./steps.ts");

const chart = artifact({
  id: "chart/arcade",
  component: "chart:arcade",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});

/** arcade's Application, then a standalone site, as one compound recipe. */
function compound(stages: { key: string; status: "succeeded" }[]) {
  return detail(
    {
      kind: "compound",
      subRecipes: [
        {
          instance: "application:arcade",
          definition: recipe(
            {
              repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
              chart: "arcade",
            },
            "chart:arcade",
          ),
        },
        {
          instance: "bucket:arcade-site",
          definition: {
            kind: "static-site",
            archiveComponent: "archive:arcade-site",
            bucket: "arcade-site",
            verification: {
              url: "https://arcade.sjer.red/",
              expectedStatus: 200,
            },
          },
        },
      ],
    },
    chart,
    stages,
  );
}

describe("a compound recipe's direct static-site step (T3)", () => {
  test("activates only after every earlier frozen step settled", async () => {
    const keys = modelSteps(requireModelRecipe(compound([]))).map(
      (step) => step.key,
    );
    const site = keys.at(-1) ?? "";
    expect(site).toMatch(/static-site$/u);
    state.current = compound([]);
    await expect(runDeliveryModelStep("deployment/1", site)).rejects.toThrow(
      /runs only after every earlier frozen step settled/u,
    );
    expect(state.activated).toEqual([]);
    state.current = compound(
      keys.slice(0, -1).map((key) => ({ key, status: "succeeded" as const })),
    );
    await runDeliveryModelStep("deployment/1", site);
    expect(state.activated).toEqual([site]);
  });
});
