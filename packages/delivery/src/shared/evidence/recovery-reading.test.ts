import { describe, expect, it } from "vitest";
import {
  NO_CAUSE,
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
  const interruptedSync = [
    { key: "step-apply-safety", status: "succeeded", message: "" },
    { key: "step-sync", status: "running", message: "step-sync: running" },
  ];
  const failedPhase =
    "Independent Application readback: media, resourceVersion 1, request 942174ca, operation 6052ec99, phase Failed, finished 2026-11-22T08:14:30Z";

  it("keeps the executor's words while no recovery intent has settled", () => {
    expect(failureReason(unlocked, undefined, [])).toBe(STALE);
    expect(failureReason(unlocked, [], [])).toBe(STALE);
    expect(failureReason(unlocked, [intent("pending")], [])).toBe(STALE);
    // A newer pending intent reopens the question an older one settled.
    expect(
      failureReason(
        unlocked,
        [intent("succeeded"), intent("pending", [], 2)],
        interruptedSync,
      ),
    ).toBe(STALE);
    // While the lock holds, nothing has released the deployment's claim.
    expect(
      failureReason(
        { message: STALE, recoveryRequired: true },
        [intent("succeeded")],
        interruptedSync,
      ),
    ).toBe(STALE);
  });

  it("states a phase recovery read back that is not Succeeded", () => {
    expect(
      failureReason(unlocked, [intent("succeeded", [failedPhase])], []),
    ).toBe(
      "Recovery intent 1 read the external operation back after the deployment ended: it ended in phase Failed.",
    );
  });

  it("never explains a failure by a readback of Succeeded: it names the step the deployment ended on", () => {
    expect(
      failureReason(unlocked, [intent("succeeded")], interruptedSync),
    ).toBe("Step step-sync was still running when the deployment ended");
    expect(
      failureReason(
        unlocked,
        [intent("succeeded")],
        [
          ...interruptedSync,
          {
            key: "step-verify",
            status: "failed",
            message: "step-verify: health check timed out",
          },
        ],
      ),
    ).toBe("Step step-verify failed: health check timed out");
  });

  it("says no cause was recorded when no step names one", () => {
    expect(failureReason(unlocked, [intent("succeeded")], [])).toBe(NO_CAUSE);
    expect(
      failureReason(
        unlocked,
        [intent("succeeded")],
        [{ key: "step-sync", status: "succeeded", message: "" }],
      ),
    ).toBe("No cause was recorded");
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

  it("never takes a prior operation's phase as this deployment's work", () => {
    // The write-body failure `unsynced.ts` settles: no sync was requested,
    // and the Application still matches the prior release's Succeeded sync.
    const summary =
      "Independent Application readback (no sync requested): flags, resourceVersion 7, spec.source matches history 4, prior request 1d2e, operation 9, phase Succeeded, finished 2026-11-22T03:27:16Z. Settled automatically";
    expect(readBack([summary])).toBeNull();
    const reading = recoveryReading([intent("succeeded", [summary])]);
    expect(reading?.readbacks).toEqual([
      { text: summary, application: "flags", request: null, phase: null },
    ]);
  });

  it("reads no phase out of a machine receipt", () => {
    const reading = recoveryReading([
      intent("succeeded", [JSON.stringify({ phase: "phase Succeeded" })]),
    ]);
    expect(reading?.readbacks).toEqual([]);
    expect(recoveryReading([intent("failed")])).toBeNull();
  });
});
