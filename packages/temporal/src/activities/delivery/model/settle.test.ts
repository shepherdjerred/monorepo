import { afterEach, describe, expect, test, vi } from "vitest";
import {
  artifact,
  detail,
  recipe as arcadeRecipe,
} from "#lib/delivery/model/testing.ts";
import type * as Client from "#lib/delivery/client.ts";
import type * as Kubernetes from "./kubernetes.ts";
import type * as Stages from "./stages.ts";

const calls = vi.hoisted(() => {
  const state: { selfHealed: unknown[]; current: unknown } = {
    selfHealed: [],
    current: undefined,
  };
  return state;
});
vi.mock("./kubernetes.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Kubernetes>()),
  enableSelfHeal: (current: unknown, recipe: unknown) => {
    calls.selfHealed.push({ current, recipe });
    return Promise.resolve(null);
  },
}));
vi.mock("#lib/delivery/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Client>()),
  deliveryRequest: () => Promise.resolve({ required: false }),
}));
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  deploymentDetail: () => Promise.resolve(calls.current),
}));

const { settleDeliveryModel } = await import("./steps.ts");

const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});

/** One Application of arcade's chart under its own name and lock instance. */
function application(name: string) {
  const base = arcadeRecipe(
    { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
    "chart:arcade",
  );
  return {
    ...base,
    application: { ...base.application, name },
    steps: base.steps.map((step) => ({
      ...step,
      instance: `application:${name}`,
    })),
  };
}

/** arcade/prod accepted a compound recipe: two Applications and an npm channel. */
function acceptedCompound() {
  const current = detail(
    {
      kind: "compound",
      subRecipes: [
        { instance: "application:arcade", definition: application("arcade") },
        {
          instance: "channel:npm/@shepherdjerred/webring",
          definition: {
            kind: "channel",
            store: "npm",
            name: "@shepherdjerred/webring",
            pointer: "latest",
            forwardOnly: false,
            artifactComponent: "archive:webring-package",
          },
        },
        {
          instance: "application:arcade-worker",
          definition: application("arcade-worker"),
        },
      ],
    },
    chart,
  );
  return {
    ...current,
    deployment: { ...current.deployment, status: "succeeded" as const },
    environment: {
      ...current.environment,
      acceptedDeploymentId: current.deployment.id,
    },
    selfHeals: true,
  };
}

afterEach(() => {
  calls.selfHealed = [];
});

describe("settling an accepted compound recipe (T4)", () => {
  test("turns self-heal on for each Application sub-recipe, not the channel", async () => {
    const current = acceptedCompound();
    calls.current = current;
    expect(await settleDeliveryModel(current.deployment.id)).toBeNull();
    expect(calls.selfHealed).toEqual(
      ["arcade", "arcade-worker"].map((name) => ({
        current,
        recipe: expect.objectContaining({
          kind: "kubernetes-application",
          application: expect.objectContaining({ name }),
        }),
      })),
    );
  });
});
