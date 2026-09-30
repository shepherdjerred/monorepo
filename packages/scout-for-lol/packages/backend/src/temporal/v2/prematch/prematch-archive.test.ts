import { describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { receiptedCommitV2 } from "#src/temporal/v2/prematch/prematch-archive.ts";

const WHAT = "Archived the NA1_9101 spectator snapshot";

describe("receiptedCommitV2", () => {
  test("reports a first receipt as an applied commit", () => {
    expect(receiptedCommitV2("recorded", WHAT)).toEqual({ outcome: "applied" });
  });

  test("fails non-retryably on an evidence mismatch instead of reporting a conflict commit", () => {
    // Every caller is gated on a receipt read, so a conflict means another
    // writer recorded DIFFERENT evidence for this identity in between: two
    // producers disagreeing about the snapshot's canonical bytes. Returning it
    // as a commit would put the receipt's kind in the Workflow's
    // `receiptKinds` — the run would claim an attestation it does not have,
    // complete, and leave the drift inside one Activity result that no later
    // poll re-examines.
    let thrown: unknown;
    try {
      receiptedCommitV2("conflict", WHAT);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApplicationFailure);
    if (!(thrown instanceof ApplicationFailure)) return;
    expect(thrown.type).toBe("ReceiptEvidenceMismatch");
    // Non-retryable specifically because a retry would BURY it: the next
    // attempt reads the standing receipt and converges quietly on the other
    // writer's descriptor.
    expect(thrown.nonRetryable).toBe(true);
    expect(thrown.message).toContain("different evidence");
  });

  test("fails retryably when the receipt could not be written at all", () => {
    // The transient case: the object is stored but its attestation did not
    // land. A retry is the fix, and the read-first gate makes the repeat
    // harmless — so this must NOT be the terminal failure above.
    let thrown: unknown;
    try {
      receiptedCommitV2("failed", WHAT);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ApplicationFailure);
    if (!(thrown instanceof Error)) return;
    expect(thrown.message).toContain("could not be recorded");
  });
});
