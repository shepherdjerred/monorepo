import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "./test-support.ts";
import {
  SolverBudgetSchema,
  solverReservedMicrousd,
  updateSolverBudget,
} from "./store.ts";
import { solvePromotionChallenge } from "./solver.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function fixture() {
  const store = memoryPromotionStore();
  const request = vi
    .fn<(url: string, options: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(Response.json({ errorId: 0, taskId: 123 }))
    .mockResolvedValue(
      Response.json({
        errorId: 0,
        status: "ready",
        cost: 0.002,
        solution: { token: "fixture-answer" },
      }),
    );
  const apply = vi
    .fn<(token: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const input = {
    store,
    occurrenceId: "fixture-occurrence",
    challenge: {
      type: "TurnstileTaskProxyless" as const,
      websiteURL: "https://www.planetminecraft.com/",
      websiteKey: "fixture-site-key",
    },
    apiKey: "fixture-key",
    allowanceMicrousd: 10_000_000,
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
    apply,
    request,
  };
  return { store, request, apply, input };
}

describe("Anti-Captcha accounting", () => {
  it("reserves before creation, settles actual cost and keeps the solution inside apply", async () => {
    const test = fixture();
    const result = solvePromotionChallenge(test.input);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ taskId: 123, costMicrousd: 2000 });
    expect(test.apply).toHaveBeenCalledWith("fixture-answer");
    const budget = await test.store.read(
      "solver/2026-10.json",
      SolverBudgetSchema,
    );
    expect(
      solverReservedMicrousd(SolverBudgetSchema.parse(budget?.value)),
    ).toBe(2000);
  });
  it("refuses a reservation that would exceed the monthly allowance", async () => {
    const test = fixture();
    await updateSolverBudget(test.store, "2026-10", () => ({
      version: 1,
      charges: {
        earlier: {
          occurrenceId: "earlier",
          taskId: 1,
          reservedMicrousd: 9_995_000,
          chargedMicrousd: 9_995_000,
        },
      },
    }));
    await expect(solvePromotionChallenge(test.input)).rejects.toThrow(
      "allowance exhausted",
    );
    expect(test.request).not.toHaveBeenCalled();
  });
  it("retains ambiguous paid creations and permits at most two attempts", async () => {
    const test = fixture();
    test.request
      .mockReset()
      .mockRejectedValue(new Error("Connection lost after createTask"));
    await expect(solvePromotionChallenge(test.input)).rejects.toThrow(
      "Connection lost",
    );
    await expect(solvePromotionChallenge(test.input)).rejects.toThrow(
      "Connection lost",
    );
    await expect(solvePromotionChallenge(test.input)).rejects.toThrow(
      "Two CAPTCHA attempts",
    );
    expect(test.request).toHaveBeenCalledTimes(2);
    const budget = await test.store.read(
      "solver/2026-10.json",
      SolverBudgetSchema,
    );
    expect(
      solverReservedMicrousd(SolverBudgetSchema.parse(budget?.value)),
    ).toBe(20_000);
  });
});
