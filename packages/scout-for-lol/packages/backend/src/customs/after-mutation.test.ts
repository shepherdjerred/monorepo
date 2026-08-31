import { describe, expect, test, vi } from "vitest";
import { completeCommittedCustomMutation } from "#src/customs/after-mutation.ts";

describe("committed Customs mutation completion", () => {
  test("publishes and returns committed state when Discord recruitment fails", async () => {
    const publishSnapshot = vi.fn(() => Promise.resolve());
    const readSnapshot = vi.fn(() => Promise.resolve("revision-2"));
    const reportRecruitmentFailure = vi.fn();

    await expect(
      completeCommittedCustomMutation({
        syncRecruitment: () => Promise.reject(new Error("Discord unavailable")),
        publishSnapshot,
        readSnapshot,
        reportRecruitmentFailure,
      }),
    ).resolves.toBe("revision-2");

    expect(reportRecruitmentFailure).toHaveBeenCalledOnce();
    expect(publishSnapshot).toHaveBeenCalledOnce();
    expect(readSnapshot).toHaveBeenCalledOnce();
  });
});
