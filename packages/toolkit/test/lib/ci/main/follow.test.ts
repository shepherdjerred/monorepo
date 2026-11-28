import { afterEach, expect, test, vi } from "vitest";
import { GitHubClient } from "#lib/ci/github.ts";
import { getFollowedMainSnapshot } from "#lib/ci/main.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import {
  MAIN_WOODPECKER_CONFIG,
  mainPipeline as pipeline,
} from "#test/lib/ci/fixtures.ts";

function mockFollowedApi(tipSha: string, pages: WoodpeckerPipeline[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/branches/main")) {
        return Promise.resolve(Response.json({ commit: { sha: tipSha } }));
      }
      if (url.pathname.includes("/compare/")) {
        return Promise.resolve(Response.json({ status: "ahead" }));
      }
      const num = /\/pipelines\/(\d+)$/u.exec(url.pathname)?.[1];
      return Promise.resolve(
        num === undefined
          ? Response.json(pages)
          : Response.json(pages.find((item) => item.number === Number(num))),
      );
    }),
  );
}

async function runFollowed(
  tipSha: string,
  startSha: string,
  pages: WoodpeckerPipeline[],
) {
  mockFollowedApi(tipSha, pages);
  return getFollowedMainSnapshot(
    new GitHubClient("test"),
    MAIN_WOODPECKER_CONFIG,
    startSha,
  );
}

afterEach(() => vi.unstubAllGlobals());

test("getFollowedMainSnapshot returns a passing recovery at or after startSha even while newer main tips are running", async () => {
  const startSha = "1".repeat(40);
  const recoverySha = "2".repeat(40);
  const newestTip = "3".repeat(40);
  const snap = await runFollowed(newestTip, startSha, [
    { ...pipeline(20, "push", "running"), commit: newestTip },
    { ...pipeline(19, "push", "success"), commit: recoverySha },
    { ...pipeline(18, "push", "failure"), commit: startSha },
  ]);
  expect(snap.sha).toBe(recoverySha);
  expect(snap.tipSha).toBe(newestTip);
  expect(snap.run?.number).toBe(19);
  expect(snap.run?.status).toBe("success");
});

test("getFollowedMainSnapshot keeps waiting when a newer main run after a passing recovery has failed", async () => {
  const startSha = "1".repeat(40);
  const recoverySha = "2".repeat(40);
  const failedTip = "3".repeat(40);
  const snap = await runFollowed(failedTip, startSha, [
    { ...pipeline(20, "push", "failure"), commit: failedTip },
    { ...pipeline(19, "push", "success"), commit: recoverySha },
    { ...pipeline(18, "push", "failure"), commit: startSha },
  ]);
  expect(snap.sha).toBe(failedTip);
  expect(snap.run?.number).toBe(20);
  expect(snap.run?.status).toBe("failure");
});

test("getFollowedMainSnapshot ignores passing commits older than startSha", async () => {
  const olderGreen = "0".repeat(40);
  const startSha = "1".repeat(40);
  const runningTip = "2".repeat(40);
  const snap = await runFollowed(runningTip, startSha, [
    { ...pipeline(20, "push", "running"), commit: runningTip },
    { ...pipeline(18, "push", "failure"), commit: startSha },
    { ...pipeline(17, "push", "success"), commit: olderGreen },
  ]);
  expect(snap.sha).toBe(runningTip);
  expect(snap.run?.number).toBe(20);
  expect(snap.run?.status).toBe("running");
});

test("getFollowedMainSnapshot preserves a failed commit verdict while its manual rerun is pending", async () => {
  const greenBase = "1".repeat(40);
  const failedCommit = "2".repeat(40);
  const unscheduledTip = "3".repeat(40);
  const pendingRuns = [
    { ...pipeline(21, "manual", "running"), commit: failedCommit },
    { ...pipeline(19, "push", "failure"), commit: failedCommit },
    { ...pipeline(18, "push", "success"), commit: greenBase },
  ];
  const pendingAtTip = await runFollowed(failedCommit, greenBase, pendingRuns);
  expect(pendingAtTip.sha).toBe(failedCommit);
  expect(pendingAtTip.run?.number).toBe(21);
  expect(pendingAtTip.run?.status).toBe("running");

  const pendingBehindTip = await runFollowed(
    unscheduledTip,
    greenBase,
    pendingRuns,
  );
  expect(pendingBehindTip.sha).toBe(failedCommit);
  expect(pendingBehindTip.run?.number).toBe(19);
  expect(pendingBehindTip.run?.status).toBe("failure");

  const recovered = await runFollowed(failedCommit, greenBase, [
    { ...pipeline(21, "manual", "success"), commit: failedCommit },
    { ...pipeline(19, "push", "failure"), commit: failedCommit },
    { ...pipeline(18, "push", "success"), commit: greenBase },
  ]);
  expect(recovered.sha).toBe(failedCommit);
  expect(recovered.run?.number).toBe(21);
  expect(recovered.run?.status).toBe("success");
});

test("getFollowedMainSnapshot skips superseded canceled pushes while a newer verifying push runs", async () => {
  const startSha = "1".repeat(40);
  const recoverySha = "2".repeat(40);
  const supersededSha = "3".repeat(40);
  const runningSha = "4".repeat(40);
  const unscheduledTip = "5".repeat(40);
  const snap = await runFollowed(unscheduledTip, startSha, [
    { ...pipeline(21, "push", "running"), commit: runningSha },
    { ...pipeline(20, "push", "canceled"), commit: supersededSha },
    { ...pipeline(19, "push", "success"), commit: recoverySha },
    { ...pipeline(18, "push", "failure"), commit: startSha },
  ]);
  expect(snap.sha).toBe(recoverySha);
  expect(snap.run?.number).toBe(19);
  expect(snap.run?.status).toBe("success");
});
