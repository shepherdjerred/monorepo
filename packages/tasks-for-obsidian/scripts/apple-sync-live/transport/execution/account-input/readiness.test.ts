import { expect, test } from "vitest";
import {
  freshMacCredentialsStatus,
  prepareNormalMacAccount,
  waitMacCredentialsStatus,
} from "./readiness";

const runID = "8b589a5e-5ce4-44b1-8c69-6d86d416ee50";
const now = Date.parse("2026-10-28T21:00:00.000Z");
function status(overrides: Record<string, unknown> = {}) {
  return {
    runID: runID.toUpperCase(),
    capturedAt: new Date(now).toISOString(),
    accountStage: "credentials",
    accountBusy: false,
    profiles: [],
    ...overrides,
  };
}
function owner(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    runID,
    pid: 42,
    startSeconds: now / 1000,
    startMicroseconds: 1,
    launchDate: now / 1000 + 0.001,
    ...overrides,
  };
}

test.each([runID, runID.toUpperCase()])(
  "Swift UUID publication %s identifies the same run",
  (value) => {
    expect(
      freshMacCredentialsStatus(status({ runID: value }), runID, now, now),
    ).toBe(true);
  },
);

test.each([
  { runID: "00000000-0000-4000-8000-000000000000" },
  { runID: "malformed" },
  { runID: 42 },
  { accountStage: "verification" },
  { accountBusy: true },
  { profiles: [{ profileID: runID }] },
  { capturedAt: new Date(now - 1).toISOString() },
  { capturedAt: new Date(now + 1001).toISOString() },
])(
  "freshness preserves run, stage, empty-profile and launch guards: %j",
  (change) => {
    expect(freshMacCredentialsStatus(status(change), runID, now, now)).toBe(
      false,
    );
  },
);

test("publication older than five seconds is rejected", () => {
  expect(freshMacCredentialsStatus(status(), runID, now, now + 5001)).toBe(
    false,
  );
});

test("normal readiness launches once and brackets owner inspection with fresh publications", async () => {
  const events: string[] = [];
  const result = await prepareNormalMacAccount({
    runID,
    clock: () => now,
    launch: () => {
      events.push("normal-launch");
      return Promise.resolve();
    },
    readStatus: () => {
      events.push("publication");
      return Promise.resolve(status());
    },
    inspectOwner: () => {
      events.push("physical-owner");
      return Promise.resolve(owner());
    },
  });
  expect(result.pid).toBe(42);
  expect(events).toEqual([
    "normal-launch",
    "publication",
    "physical-owner",
    "publication",
  ]);
});

test.each([
  { ready: false },
  { runID: "00000000-0000-4000-8000-000000000000" },
  { launchDate: (now - 1) / 1000 },
  { pid: 0 },
])(
  "unowned or pre-existing process cannot complete normal preparation: %j",
  async (change) => {
    let launches = 0;
    await expect(
      prepareNormalMacAccount({
        runID,
        clock: () => now,
        launch: () => {
          launches += 1;
          return Promise.resolve();
        },
        readStatus: () => Promise.resolve(status()),
        inspectOwner: () => Promise.resolve(owner(change)),
      }),
    ).rejects.toThrow();
    expect(launches).toBe(1);
  },
);

test("launch failure cannot inspect an old process or return approval readiness", async () => {
  let inspections = 0;
  await expect(
    prepareNormalMacAccount({
      runID,
      clock: () => now,
      launch: () => Promise.reject(new Error("synthetic launch failure")),
      readStatus: () => Promise.resolve(status()),
      inspectOwner: () => {
        inspections += 1;
        return Promise.resolve(owner());
      },
    }),
  ).rejects.toThrow("synthetic launch failure");
  expect(inspections).toBe(0);
});

test("stale fixture publication exhausts the readiness bound without inspecting or relaunching", async () => {
  let clock = now,
    launches = 0,
    inspections = 0;
  await expect(
    prepareNormalMacAccount({
      runID,
      clock: () => clock,
      pause: () => {
        clock += 1000;
        return Promise.resolve();
      },
      launch: () => {
        launches += 1;
        return Promise.resolve();
      },
      readStatus: () =>
        Promise.resolve(status({ accountStage: "verification" })),
      inspectOwner: () => {
        inspections += 1;
        return Promise.resolve(owner());
      },
    }),
  ).rejects.toThrow("publication did not become ready");
  expect(launches).toBe(1);
  expect(inspections).toBe(0);
});

test("missing initial publication is retried, while real read failures reject", async () => {
  let reads = 0;
  const missing = Object.assign(new Error("synthetic missing publication"), {
    code: "ENOENT",
  });
  await waitMacCredentialsStatus(
    {
      runID,
      clock: () => now,
      pause: () => Promise.resolve(),
      readStatus: () =>
        ++reads === 1 ? Promise.reject(missing) : Promise.resolve(status()),
    },
    now,
  );
  expect(reads).toBe(2);
  await expect(
    waitMacCredentialsStatus(
      {
        runID,
        clock: () => now,
        readStatus: () =>
          Promise.reject(new Error("synthetic invalid ownership")),
      },
      now,
    ),
  ).rejects.toThrow("synthetic invalid ownership");
});
