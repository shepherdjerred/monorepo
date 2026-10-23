import { describe, expect, test, vi } from "vitest";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import { forumRecipe } from "#lib/delivery/model/forum-testing.ts";
import { modelSteps, requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import type * as Stages from "./stages.ts";

const state = vi.hoisted(() => {
  const ran: string[] = [];
  const current: unknown = undefined;
  return { current, ran };
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
    state.ran.push(key);
    return Promise.resolve();
  },
}));
vi.mock("./archive.ts", () => ({
  runArchiveStep: (_current: unknown, _component: unknown, key: string) => {
    state.ran.push(key);
    return Promise.resolve();
  },
}));
vi.mock("./forum-bundle.ts", () => ({
  runForumBundleStep: (_current: unknown, _recipe: unknown, key: string) => {
    state.ran.push(key);
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
const arcade = recipe(
  { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
  "chart:arcade",
);

/** arcade's Application, then a standalone site, as one compound recipe. */
function compound(stages: { key: string; status: "succeeded" }[]) {
  return detail(
    {
      kind: "compound",
      subRecipes: [
        { instance: "application:arcade", definition: arcade },
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
    state.ran.length = 0;
    const keys = modelSteps(requireModelRecipe(compound([]))).map(
      (step) => step.key,
    );
    const site = keys.at(-1) ?? "";
    expect(site).toMatch(/static-site$/u);
    state.current = compound([]);
    await expect(runDeliveryModelStep("deployment/1", site)).rejects.toThrow(
      /runs only after every earlier frozen step settled/u,
    );
    expect(state.ran).toEqual([]);
    state.current = compound(
      keys.slice(0, -1).map((key) => ({ key, status: "succeeded" as const })),
    );
    await runDeliveryModelStep("deployment/1", site);
    expect(state.ran).toEqual([site]);
  });
});

/** The Application steps that act against the backend only its sync deploys. */
const dependents = [
  {
    kind: "static-site",
    step: {
      kind: "static-site",
      instance: "bucket:arcade-site",
      policy: {
        archiveComponent: "archive:arcade-site",
        bucket: "arcade-site",
        verification: { url: "https://arcade.sjer.red/", expectedStatus: 200 },
      },
    },
  },
  {
    kind: "archive",
    step: {
      kind: "archive",
      instance: "application:arcade",
      archiveComponent: "archive:trmnl-plugins",
    },
  },
  {
    kind: "forum-bundle",
    step: {
      kind: "forum-bundle",
      instance: "application:arcade",
      pointOfNoReturn: true,
      imageComponent: "image:arcade",
      bundleComponent: "archive:forum-bundle",
    },
  },
];

/** arcade's Application with `step` frozen at `at`: 1 is before its sync, 2 after. */
function application(step: Record<string, unknown>, at: number) {
  const steps: Record<string, unknown>[] = [...arcade.steps];
  steps.splice(at, 0, step);
  return { ...arcade, steps };
}

/** A synced storm-forum Application ahead of arcade's, as one compound recipe. */
function behindAnotherSync(definition: Record<string, unknown>) {
  return {
    kind: "compound",
    subRecipes: [
      {
        instance: "application:storm-forum",
        definition: { ...forumRecipe, steps: forumRecipe.steps.slice(0, 2) },
      },
      { instance: "application:arcade", definition },
    ],
  };
}

/**
 * Runs `kind`'s step after settling every step frozen before it, so only the
 * recipe's order can refuse it; resolves with the steps that ran.
 */
async function runSettled(definition: unknown, kind: string) {
  state.ran.length = 0;
  const keys = modelSteps(requireModelRecipe(detail(definition, chart))).map(
    (step) => step.key,
  );
  const index = keys.findIndex((key) => key.endsWith(`step-${kind}`));
  state.current = detail(
    definition,
    chart,
    keys.slice(0, index).map((key) => ({ key, status: "succeeded" as const })),
  );
  await runDeliveryModelStep("deployment/1", keys[index] ?? "");
  return state.ran;
}

const misordered = {
  type: "DeliveryModelStepOrder",
  nonRetryable: true,
  message: expect.stringMatching(/before its Application synced/u),
};

describe.each(dependents)(
  "an Application's $kind step order (T3)",
  ({ kind, step }) => {
    test("runs only after its Application's sync", async () => {
      await expect(runSettled(application(step, 2), kind)).resolves.toEqual([
        `step-${kind}`,
      ]);
      // Schema-valid, but it would act before the backend synced.
      await expect(
        runSettled(application(step, 1), kind),
      ).rejects.toMatchObject(misordered);
      expect(state.ran).toEqual([]);
    });

    test("a compound sub-recipe's step waits for that sub-recipe's own sync", async () => {
      await expect(
        runSettled(behindAnotherSync(application(step, 2)), kind),
      ).resolves.toEqual([`sub2-step-${kind}`]);
      // An earlier sub-recipe's sync does not stand in for arcade's own.
      await expect(
        runSettled(behindAnotherSync(application(step, 1)), kind),
      ).rejects.toMatchObject(misordered);
      expect(state.ran).toEqual([]);
    });
  },
);
