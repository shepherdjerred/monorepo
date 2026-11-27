import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ciScorecardCommand } from "#commands/ci-scorecard.ts";

const mocks = vi.hoisted(() => ({
  scorecard:
    vi.fn<(config: unknown, since: number, until: number) => unknown>(),
  config: vi.fn(),
}));
vi.mock("#lib/ci/scorecard/scorecard.ts", () => ({
  ciScorecard: mocks.scorecard,
  formatScorecard: () => "formatted private-token report",
}));
vi.mock("#lib/woodpecker/ci.ts", () => ({
  loadWoodpeckerConfig: mocks.config,
}));

let logged: string[] = [];
let originalExit: typeof process.exitCode;
beforeEach(() => {
  originalExit = process.exitCode;
  logged = [];
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation((text: string) => {
    logged.push(text);
  });
  mocks.config.mockResolvedValue({
    baseUrl: "https://woodpecker.sjer.red",
    token: "private-token",
    repoId: 1,
  });
  mocks.scorecard.mockResolvedValue({
    schemaVersion: 1,
    note: "private-token",
  });
});
afterEach(() => {
  process.exitCode = originalExit;
  vi.restoreAllMocks();
});

test("forwards the --since window to the scorecard after authenticating", async () => {
  const order: string[] = [];
  mocks.config.mockImplementation(() => {
    order.push("config");
    return Promise.resolve({ baseUrl: "u", token: "private-token", repoId: 1 });
  });
  await ciScorecardCommand(["--since", "2h"], () => {
    order.push("authenticate");
    return Promise.resolve();
  });
  expect(order).toEqual(["authenticate", "config"]);
  const [, since = 0, until = 0] = mocks.scorecard.mock.calls[0] ?? [];
  expect(until - since).toBeCloseTo(7200, 0);
});

test("defaults to 24 hours and redacts the token from text and JSON output", async () => {
  await ciScorecardCommand([], () => Promise.resolve());
  const [, since = 0, until = 0] = mocks.scorecard.mock.calls[0] ?? [];
  expect(until - since).toBeCloseTo(86_400, 0);
  await ciScorecardCommand(["--json"], () => Promise.resolve());
  expect(logged).toHaveLength(2);
  for (const text of logged) expect(text).not.toContain("private-token");
  expect(logged[1]).toContain('"schemaVersion": 1');
});

test("help and invalid arguments never authenticate", async () => {
  const authenticate = vi.fn(() => Promise.resolve());
  await ciScorecardCommand(["--help"], authenticate);
  expect(logged[0]).toContain("toolkit ci scorecard");
  await expect(ciScorecardCommand(["--bogus"], authenticate)).rejects.toThrow();
  await expect(
    ciScorecardCommand(["--since", "0h"], authenticate),
  ).rejects.toThrow();
  expect(authenticate).not.toHaveBeenCalled();
  expect(mocks.scorecard).not.toHaveBeenCalled();
});
