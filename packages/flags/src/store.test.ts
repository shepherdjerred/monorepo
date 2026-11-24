import { expect, test } from "vitest";
import { flagDeployments } from "@shepherdjerred/feature-flags/deployments.ts";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { projectDeploymentFlags } from "@shepherdjerred/feature-flags/project-deployment.ts";
import { FlagStore } from "./store.ts";

test("seedFromInventory adds newly declared inventory keys to existing deployments without overwriting customized flags", () => {
  const store = FlagStore.open(":memory:");
  try {
    const scoutProd = flagDeployments.find(
      (deployment) => deployment.id === "scout/prod",
    );
    if (scoutProd === undefined) {
      throw new Error("scout/prod deployment missing from inventory");
    }
    const projected = projectDeploymentFlags(scoutProd);
    const customizedKey = "dares_enabled";
    const omittedFlag = projected.find((flag) => flag.key !== customizedKey);
    if (omittedFlag === undefined) {
      throw new Error(
        "expected another flag in scout/prod besides dares_enabled",
      );
    }

    const customized: FlagValue = {
      type: "boolean",
      key: customizedKey,
      default: true,
      rollouts: [
        {
          constraints: [{ property: "server", value: "guild-123" }],
          result: false,
        },
      ],
    };

    // Simulate a database seeded by an older image that lacked `omittedFlag.key`
    // and carried operator customizations on `dares_enabled`.
    store.seedDocuments([
      {
        id: "scout/prod",
        flags: [
          customized,
          ...projected.filter(
            (flag) =>
              flag.key !== customizedKey && flag.key !== omittedFlag.key,
          ),
        ],
      },
    ]);
    expect(store.flag("scout/prod", omittedFlag.key)).toBeUndefined();
    expect(store.document("scout/prod")?.revision).toBe(1);

    const reseeded = store.seedFromInventory();
    expect(reseeded.seeded).not.toContain("scout/prod");

    // Newly declared inventory key is now present and revision bumped for ETag clients.
    expect(store.flag("scout/prod", omittedFlag.key)?.flag).toEqual(
      omittedFlag,
    );
    expect(store.document("scout/prod")?.revision).toBe(2);

    // Existing customized flag value and rollout rules remain untouched.
    expect(store.flag("scout/prod", customizedKey)?.flag).toEqual(customized);

    // A subsequent restart with no new keys keeps revision unchanged.
    const steady = store.seedFromInventory();
    expect(steady.seeded).toEqual([]);
    expect(store.document("scout/prod")?.revision).toBe(2);
  } finally {
    store.close();
  }
});
