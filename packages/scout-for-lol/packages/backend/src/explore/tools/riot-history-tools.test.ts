import { describe, expect, test } from "vitest";
import { waitForExploreHistory } from "./riot-history-tools.ts";

describe("bounded durable history wait", () => {
  test("returns completed coverage without waiting for the deadline", async () => {
    expect(
      await waitForExploreHistory(
        Promise.resolve({ found: 87 }),
        undefined,
        1000,
      ),
    ).toEqual({ status: "ready", result: { found: 87 } });
  });

  test("reports pending and leaves the underlying import running", async () => {
    let complete: ((value: number) => void) | undefined;
    const result = new Promise<number>((resolve) => {
      complete = resolve;
    });
    expect(await waitForExploreHistory(result, undefined, 1)).toEqual({
      status: "pending",
    });
    complete?.(87);
    expect(await result).toBe(87);
  });

  test("propagates import failure rather than reporting empty coverage", async () => {
    await expect(
      waitForExploreHistory(
        Promise.reject(new Error("Riot unavailable")),
        undefined,
      ),
    ).rejects.toThrow("Riot unavailable");
  });

  test("cancellation ends the turn's wait without cancelling the import", async () => {
    const controller = new AbortController();
    let complete: ((value: number) => void) | undefined;
    const result = new Promise<number>((resolve) => {
      complete = resolve;
    });
    const waited = waitForExploreHistory(result, controller.signal);
    controller.abort(new Error("turn stopped"));
    await expect(waited).rejects.toThrow("History wait aborted");
    complete?.(42);
    expect(await result).toBe(42);
  });
});
