import { describe, expect, it } from "vitest";
import type { ReadableIntent } from "#shared/evidence/recovery-reading.ts";
import { stated, steppedReadback } from "./recovery.ts";

const STALE =
  "External operation may still be active; inspect its recorded identity before releasing ownership";

/** Delivery control-plane r171's settled automatic intent. */
const settled: ReadableIntent = {
  id: "argo/auto-de8f76cb",
  sequence: 1,
  outcome: "succeeded",
  evidence: [
    {
      summary:
        "Independent Application readback: delivery-control-plane, resourceVersion 330526147, request b1aaf54f, operation 26f46d77, phase Succeeded, finished 2026-11-22T07:10:00Z",
    },
  ],
};

describe("a failure as the hub pages state it", () => {
  const row = { id: "de8f76cb", message: STALE, recoveryRequired: false };

  it("replaces the executor's stale words once recovery settled, and keeps them while it has not", () => {
    expect(stated(row, new Map([[row.id, [settled]]])).message).toBe(
      "Recovery intent 1 read the external operation back after the deployment ended: it ended in phase Succeeded.",
    );
    expect(
      stated(row, new Map([[row.id, [{ ...settled, outcome: "pending" }]]]))
        .message,
    ).toBe(STALE);
    expect(stated(row, new Map()).message).toBe(STALE);
  });

  it("gives an interrupted step the phase its own request read back", () => {
    expect(steppedReadback([settled], { operationId: "b1aaf54f" })).toBe(
      "Succeeded",
    );
    expect(steppedReadback([settled], { operationId: "another" })).toBeNull();
    expect(steppedReadback([], { operationId: "b1aaf54f" })).toBeNull();
  });
});
