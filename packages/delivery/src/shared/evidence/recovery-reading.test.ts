import { describe, expect, it } from "vitest";
import {
  failureReason,
  readbackOutcome,
  recoveryReading,
  type ReadableIntent,
} from "./recovery-reading.ts";

const STALE =
  "External operation may still be active; inspect its recorded identity before releasing ownership";

/** Streambot prod r348's automatic intent, as the live record holds it. */
function intent(
  outcome: ReadableIntent["outcome"],
  summaries: string[] = [
    "Independent Application readback: media, resourceVersion 330545892, request 942174ca, operation 6052ec99, phase Succeeded, finished 2026-11-22T08:14:30Z. Settled automatically by independent Application readback of the finished operation",
  ],
  sequence = 1,
): ReadableIntent {
  return {
    id: `argo/auto-${String(sequence)}`,
    sequence,
    outcome,
    evidence: summaries.map((summary) => ({ summary })),
  };
}

describe("why a failed deployment failed, as every page states it", () => {
  const unlocked = { message: STALE, recoveryRequired: false };

  it("keeps the executor's words while no recovery intent has settled", () => {
    expect(failureReason(unlocked, undefined)).toBe(STALE);
    expect(failureReason(unlocked, [])).toBe(STALE);
    expect(failureReason(unlocked, [intent("pending")])).toBe(STALE);
    // A newer pending intent reopens the question an older one settled.
    expect(
      failureReason(unlocked, [intent("succeeded"), intent("pending", [], 2)]),
    ).toBe(STALE);
    // While the lock holds, nothing has released the deployment's claim.
    expect(
      failureReason({ message: STALE, recoveryRequired: true }, [
        intent("succeeded"),
      ]),
    ).toBe(STALE);
  });

  it("states what recovery read back once its newest intent settled", () => {
    expect(failureReason(unlocked, [intent("succeeded")])).toBe(
      "Recovery intent 1 read the external operation back after the deployment ended: it ended in phase Succeeded.",
    );
  });
});

/** How a settled intent that recorded `summaries` read the work back. */
function readBack(summaries: string[]) {
  const reading = recoveryReading([intent("succeeded", summaries)]);
  if (reading === null) throw new Error("settled");
  return readbackOutcome(reading);
}

describe("how recovery read the external work back", () => {
  it("is succeeded only when every readback ended Succeeded", () => {
    expect(readBack(["readback: web, phase Succeeded"])).toBe("succeeded");
    expect(
      readBack([
        "readback: web, phase Succeeded",
        "readback: api, phase Failed",
      ]),
    ).toBe("failed");
    expect(
      readBack(["readback: web, phase Succeeded", "Settled by an operator"]),
    ).toBeNull();
    expect(readBack([])).toBeNull();
  });

  it("reads no phase out of a machine receipt", () => {
    const reading = recoveryReading([
      intent("succeeded", [JSON.stringify({ phase: "phase Succeeded" })]),
    ]);
    expect(reading?.readbacks).toEqual([]);
    expect(recoveryReading([intent("failed")])).toBeNull();
  });
});
