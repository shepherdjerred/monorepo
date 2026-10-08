import { beforeEach, describe, expect, test, vi } from "vitest";
import { WorkflowNotFoundError } from "@temporalio/client";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";

const describeExecution = vi.fn();

vi.mock("#src/temporal/runtime.ts", () => ({
  currentScoutTemporalSupervisor: () => ({
    client: () => ({
      workflow: { getHandle: () => ({ describe: describeExecution }) },
    }),
  }),
}));

const { readLegacyMatchCompletion } =
  await import("#src/temporal/match/legacy-completion.ts");

let matchNumber = 9000;

/** A fresh match per case, so the once-per-match log never hides a read. */
function nextRef() {
  matchNumber += 1;
  return {
    stage: "beta" as const,
    riotMatchId: RiotMatchIdSchema.parse(`NA1_${matchNumber.toString()}`),
  };
}

beforeEach(() => {
  describeExecution.mockReset();
});

describe("legacy-v1 match completion", () => {
  test.each(["COMPLETED", "FAILED", "TERMINATED", "TIMED_OUT", "CANCELED"])(
    "answers complete for a v1 execution that closed %s",
    async (status) => {
      describeExecution.mockResolvedValue({ status: { name: status } });

      await expect(readLegacyMatchCompletion(nextRef())).resolves.toEqual({
        completed: true,
      });
      expect(describeExecution).toHaveBeenCalledTimes(1);
    },
  );

  test("answers complete once retention has removed the v1 execution", async () => {
    describeExecution.mockRejectedValue(
      new WorkflowNotFoundError(
        "not found",
        "scout-beta-match-NA1_1",
        undefined,
      ),
    );

    await expect(readLegacyMatchCompletion(nextRef())).resolves.toEqual({
      completed: true,
    });
  });

  test("an unreadable status explains nothing but still answers", async () => {
    describeExecution.mockRejectedValue(new Error("Temporal unavailable"));

    await expect(readLegacyMatchCompletion(nextRef())).resolves.toEqual({
      completed: true,
    });
  });

  test("reads each match's status once", async () => {
    describeExecution.mockResolvedValue({ status: { name: "FAILED" } });
    const ref = nextRef();

    await readLegacyMatchCompletion(ref);
    await readLegacyMatchCompletion(ref);

    expect(describeExecution).toHaveBeenCalledTimes(1);
  });
});
