import { expect, it, vi } from "vitest";
import { PromotionCaptchaSession } from "./captcha-session.ts";
import type { PromotionCaptchaSolution } from "#activities/promotion/solver.ts";

function fixture() {
  const solution: PromotionCaptchaSolution = {
    token: "private-fixture-token",
    userAgent: undefined,
    result: { taskId: 123, costMicrousd: 2000 },
  };
  const acquire = vi.fn(
    async (onSolved: (value: PromotionCaptchaSolution) => void) => {
      onSolved(solution);
      return solution.result;
    },
  );
  const apply = vi
    .fn<(token: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const input = {
    documentId: "document-one",
    challenge: {
      type: "RecaptchaV2TaskProxyless" as const,
      websiteURL: "https://example.invalid/login",
      websiteKey: "site",
    },
    acquire,
    apply,
  };
  return {
    session: new PromotionCaptchaSession(),
    input,
    acquire,
    apply,
    solution,
  };
}
it("deduplicates simultaneous and repeated solves without exposing the token", async () => {
  const f = fixture();
  const results = await Promise.all([
    f.session.solve(f.input),
    f.session.solve(f.input),
  ]);
  expect(f.acquire).toHaveBeenCalledTimes(1);
  expect(results).toEqual([
    expect.objectContaining({ reused: false }),
    expect.objectContaining({ reused: true }),
  ]);
  expect(await f.session.solve(f.input)).toMatchObject({
    taskId: 123,
    reused: true,
    responseStaged: true,
  });
  expect(JSON.stringify(results)).not.toContain(f.solution.token);
  expect(f.apply).not.toHaveBeenCalled();
});
it("reuses the paid solution after a browser application timeout", async () => {
  const f = fixture();
  f.acquire.mockImplementationOnce(async (onSolved) => {
    onSolved(f.solution);
    throw new Error("Browser application timed out");
  });
  await expect(f.session.solve(f.input)).rejects.toThrow(
    "application timed out",
  );
  expect(await f.session.solve(f.input)).toMatchObject({
    reused: true,
    taskId: 123,
  });
  expect(f.apply).toHaveBeenCalledExactlyOnceWith(f.solution.token);
  expect(f.acquire).toHaveBeenCalledTimes(1);
});
it("retains an ambiguous provider failure instead of buying another task", async () => {
  const f = fixture();
  f.acquire.mockRejectedValue(new Error("createTask connection lost"));
  await expect(f.session.solve(f.input)).rejects.toThrow("connection lost");
  await expect(f.session.solve(f.input)).rejects.toThrow("connection lost");
  expect(f.acquire).toHaveBeenCalledTimes(1);
  expect(f.apply).not.toHaveBeenCalled();
});
it("buys a new result for a new document or changed challenge parameters", async () => {
  const f = fixture();
  await f.session.solve(f.input);
  await f.session.solve({ ...f.input, documentId: "document-two" });
  await f.session.solve({
    ...f.input,
    challenge: { ...f.input.challenge, websiteKey: "replacement-widget" },
  });
  expect(f.acquire).toHaveBeenCalledTimes(3);
});
