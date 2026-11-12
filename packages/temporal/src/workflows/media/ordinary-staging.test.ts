import { expect, test, vi } from "vitest";
import type { MediaFileActivities } from "@shepherdjerred/media/automation";
import { stageOrdinaryMedia } from "./ordinary-staging.ts";

const input = {
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
};
type Inspect = MediaFileActivities["inspectAndStageMedia"];
const filePlanHash = "a".repeat(64);

test("ordinary staging performs one planning call and contiguous bounded physical batches", async () => {
  const inspect = vi.fn<Inspect>((value) => {
    const index = value.stagingBatch?.batchIndex;
    return Promise.resolve(
      index === 2
        ? { status: "staged" }
        : {
            status: "staging",
            nextBatchIndex: index === null ? 0 : (index ?? 0) + 1,
            filePlanHash,
          },
    );
  });
  expect(await stageOrdinaryMedia(input, inspect)).toEqual({
    status: "staged",
  });
  expect(inspect.mock.calls.map(([value]) => value)).toEqual(
    [null, 0, 1, 2].map((batchIndex) => ({
      ...input,
      stagingBatch:
        batchIndex === null
          ? { schemaVersion: 1, batchIndex }
          : { schemaVersion: 1, batchIndex, filePlanHash },
    })),
  );
});

test.each(["staged", "blocked"] as const)(
  "an old Files worker's terminal %s reply is never retried as batching progress",
  async (status) => {
    const result =
      status === "staged"
        ? { status }
        : { status, reason: "plex_library_access_required" };
    const inspect = vi.fn<Inspect>(() => Promise.resolve(result));
    expect(await stageOrdinaryMedia(input, inspect)).toEqual(result);
    expect(inspect).toHaveBeenCalledExactlyOnceWith({
      ...input,
      stagingBatch: { schemaVersion: 1, batchIndex: null },
    });
  },
);

test.each([-1, 1, 24, 25, 0.5])(
  "invalid initial progress %s fails without scheduling further work",
  async (nextBatchIndex) => {
    const inspect = vi.fn<Inspect>(() =>
      Promise.resolve({ status: "staging", nextBatchIndex, filePlanHash }),
    );
    await expect(stageOrdinaryMedia(input, inspect)).rejects.toMatchObject({
      type: "OrdinaryMediaStagingProtocolError",
      nonRetryable: true,
    });
    expect(inspect).toHaveBeenCalledTimes(1);
  },
);

test("unchanged progress cannot loop or advance to publication", async () => {
  const inspect = vi.fn<Inspect>(() =>
    Promise.resolve({ status: "staging", nextBatchIndex: 0, filePlanHash }),
  );
  await expect(stageOrdinaryMedia(input, inspect)).rejects.toMatchObject({
    type: "OrdinaryMediaStagingProtocolError",
    nonRetryable: true,
  });
  expect(inspect).toHaveBeenCalledTimes(2);
});

test.each([false, true])(
  "the100-member bound permits at most26 real calls (overflow=%s)",
  async (overflow) => {
    const inspect = vi.fn<Inspect>((value) => {
      const index = value.stagingBatch?.batchIndex;
      return Promise.resolve(
        index === 24 && !overflow
          ? { status: "staged" }
          : {
              status: "staging",
              nextBatchIndex: index === null ? 0 : (index ?? 0) + 1,
              filePlanHash,
            },
      );
    });
    const result = stageOrdinaryMedia(input, inspect);
    if (overflow)
      await expect(result).rejects.toMatchObject({
        type: "OrdinaryMediaStagingProtocolError",
        nonRetryable: true,
      });
    else expect(await result).toEqual({ status: "staged" });
    expect(inspect).toHaveBeenCalledTimes(26);
    expect(inspect.mock.calls.at(-1)?.[0].stagingBatch?.batchIndex).toBe(24);
  },
);

test.each(["", "private-path", "b".repeat(64)])(
  "changed or invalid full-plan commitment %s cannot advance to publication",
  async (changed) => {
    const inspect = vi.fn<Inspect>((value) =>
      Promise.resolve({
        status: "staging",
        nextBatchIndex: value.stagingBatch?.batchIndex === null ? 0 : 1,
        filePlanHash:
          value.stagingBatch?.batchIndex === null ? filePlanHash : changed,
      }),
    );
    await expect(stageOrdinaryMedia(input, inspect)).rejects.toMatchObject({
      type: "OrdinaryMediaStagingProtocolError",
      nonRetryable: true,
    });
    expect(inspect).toHaveBeenCalledTimes(2);
  },
);
