import { describe, expect, it } from "vitest";

import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import { reconcileAndPublish } from "#server/reconciliation";

describe("reconciliation change publication", () => {
  it("publishes successful snapshots without lifecycle transitions", async () => {
    const changes = new ChangeBus();
    const reasons: string[] = [];
    const unsubscribe = changes.subscribe((change) => {
      reasons.push(change.reason);
    });

    await reconcileAndPublish(
      {
        reconcile: () => Promise.resolve({ active: 1, opened: 0, resolved: 0 }),
      },
      changes,
      new Metrics(),
    );
    unsubscribe();

    expect(reasons).toEqual(["reconciliation"]);
  });
});
