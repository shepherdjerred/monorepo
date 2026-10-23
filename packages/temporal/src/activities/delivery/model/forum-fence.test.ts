import { describe, expect, test, vi } from "vitest";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import type * as Client from "#lib/delivery/client.ts";

const requests = vi.hoisted(() => {
  const paths: string[] = [];
  return { paths };
});
vi.mock("#lib/delivery/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Client>()),
  deliveryRequest: (path: string) => {
    requests.paths.push(path);
    return Promise.resolve({ verified: true });
  },
}));

const { forumBaselineFence } = await import("./forum-bundle.ts");

describe("forum baseline fence", () => {
  test("only the Application that owns the forum release re-observes the baseline", async () => {
    const { current, recipe } = forumDetail();
    const baselined = structuredClone(current);
    // The fence only asks whether a first upgrade froze a baseline; the
    // server checks the snapshot itself.
    Object.assign(baselined.deployment, {
      forumBaselineSnapshot: { intentId: "baseline/original" },
    });
    // Another member of a compound recipe: no forum-bundle step.
    const other = {
      ...recipe,
      steps: recipe.steps.filter((step) => step.kind !== "forum-bundle"),
    };
    await forumBaselineFence(baselined, other);
    expect(requests.paths).toEqual([]);
    await forumBaselineFence(baselined, recipe);
    expect(requests.paths).toEqual([
      `deployments/${encodeURIComponent(current.deployment.id)}/forum-baseline-check`,
    ]);
  });
});
