import { describe, expect, it } from "vitest";
import {
  NO_CAUSE,
  readbackApplications,
  settledFindings,
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

  it("never states a readback in any phase, nor one that names no phase, as the reason", () => {
    const stages = [
      { key: "sub2-step-players-offline", status: "running", message: "" },
      { key: "sub3-step-sync", status: "running", message: "" },
    ];
    const cause =
      "Step sub2-step-players-offline was still running when the deployment ended";
    // A failed phase.
    expect(
      failureReason(unlocked, [intent("succeeded", [failedPhase])], stages),
    ).toBe(cause);
    // tsmc: two Applications read back, one with a phase and one without,
    // so the readbacks as a whole name no outcome.
    const mixed = intent("succeeded", [
      "Independent Application readback: minecraft-tsmc-companion, resourceVersion 7, request abc, operation 3, phase Succeeded, finished 2026-11-22T08:14:30Z",
      "Independent Application readback: minecraft-tsmc, resourceVersion 8, no operation recorded",
    ]);
    const reading = recoveryReading([mixed]);
    if (reading === null) throw new Error("settled");
    expect(readbackOutcome(reading)).toBeNull();
    expect(failureReason(unlocked, [mixed], stages)).toBe(cause);
    expect(failureReason(unlocked, [mixed], [])).toBe(NO_CAUSE);
    expect(settledFindings(reading)).toBe(
      "minecraft-tsmc-companion ended in phase Succeeded",
    );
    expect(readbackApplications(reading)).toEqual([
      "minecraft-tsmc-companion",
      "minecraft-tsmc",
    ]);
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
