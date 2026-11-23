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

  const stages = new Map([
    [
      row.id,
      [{ key: "step-sync", status: "running", message: "step-sync: running" }],
    ],
  ]);

  it("replaces the executor's stale words once recovery settled, and keeps them while it has not", () => {
    // A readback of Succeeded is never the reason: the interrupted step is.
    expect(stated(row, new Map([[row.id, [settled]]]), stages).message).toBe(
      "Step step-sync was still running when the deployment ended",
    );
    expect(stated(row, new Map([[row.id, [settled]]]), new Map()).message).toBe(
      "No cause was recorded",
    );
    expect(
      stated(
        row,
        new Map([[row.id, [{ ...settled, outcome: "pending" }]]]),
        stages,
      ).message,
    ).toBe(STALE);
    expect(stated(row, new Map(), stages).message).toBe(STALE);
  });

  it("states tsmc's mixed readbacks, in any phase, as the step the deployment ended on", () => {
    // minecraft/tsmc: two Applications read back, only one naming a phase, and
    // two steps still running when the deployment ended.
    const mixed: ReadableIntent = {
      id: "argo/auto-4a0251b1",
      sequence: 1,
      outcome: "succeeded",
      evidence: [
        {
          summary:
            "Independent Application readback: minecraft-tsmc-companion, resourceVersion 7, request abc, operation 3, phase Succeeded, finished 2026-11-22T08:14:30Z",
        },
        {
          summary:
            "Independent Application readback: minecraft-tsmc, resourceVersion 8, no operation recorded",
        },
      ],
    };
    const tsmc = { id: "4a0251b1", message: STALE, recoveryRequired: false };
    const steps = new Map([
      [
        tsmc.id,
        [
          {
            key: "sub2-step-players-offline",
            status: "running",
            message: "",
          },
          { key: "sub3-step-sync", status: "running", message: "" },
        ],
      ],
    ]);
    expect(stated(tsmc, new Map([[tsmc.id, [mixed]]]), steps).message).toBe(
      "Step sub2-step-players-offline was still running when the deployment ended",
    );
  });

  it("gives an interrupted step the phase its own request read back", () => {
    expect(steppedReadback([settled], { operationId: "b1aaf54f" })).toBe(
      "Succeeded",
    );
    expect(steppedReadback([settled], { operationId: "another" })).toBeNull();
    expect(steppedReadback([], { operationId: "b1aaf54f" })).toBeNull();
  });
});
