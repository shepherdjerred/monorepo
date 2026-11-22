import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { z } from "zod/v4";
import { describe, expect, test } from "vitest";
import { canAutoMerge } from "./scout-queue-windows-pr-body.ts";
import { nextWarningState } from "./scout-queue-windows.ts";
import { applyConfirmedEndedQueueCloses } from "./scout-queue-window-close-remediation.ts";
import { unverifiedWarnings } from "./scout-queue-window-liveness.ts";
import {
  queueWarningFinding,
  type QueueWindowsReport,
} from "./scout-queue-windows-report.ts";

const FINGERPRINT = "a".repeat(64);

describe("queue warning identity", () => {
  test("keeps observation counts and ages outside the identity", () => {
    const first = queueWarningFinding({
      kind: "window-too-young",
      queue: "urf",
      message: "Window is 1 day old with 100 matches",
      total: 100,
    });
    const next = queueWarningFinding({
      kind: "window-too-young",
      queue: "urf",
      message: "Window is 2 days old with 250 matches",
      total: 250,
    });
    expect(first.id).toBe(next.id);
    expect(first.summary).not.toBe(next.summary);
    expect(
      queueWarningFinding({
        kind: "window-too-young",
        queue: "arena",
        message: "Young",
      }).id,
    ).not.toBe(first.id);
    expect(
      queueWarningFinding({
        kind: "sparse-no-close",
        queue: "urf",
        message: "Sparse",
      }).id,
    ).not.toBe(first.id);
  });

  test("requires known warning identities and preserves unknown warning text", () => {
    expect(() =>
      queueWarningFinding({ kind: "no-volume-baseline", message: "Missing" }),
    ).toThrow("has no queue identity");
    expect(
      queueWarningFinding({ kind: "new-kind", message: "New failure" }),
    ).toEqual({
      summary: "new-kind: New failure",
    });
  });
});

describe("Scout queue warning state", () => {
  test("does not count an activity retry as another consecutive run", () => {
    const firstAttempt = nextWarningState(undefined, FINGERPRINT, "run-1");
    const retry = nextWarningState(firstAttempt, FINGERPRINT, "run-1");

    expect(retry).toEqual(firstAttempt);
  });

  test("increments the count for a later workflow run with the same warning", () => {
    const prior = nextWarningState(undefined, FINGERPRINT, "run-1");
    const nextRun = nextWarningState(prior, FINGERPRINT, "run-2");

    expect(nextRun.consecutiveRuns).toBe(2);
    expect(nextRun.lastWorkflowRunId).toBe("run-2");
  });

  test("resets the count when warnings clear or change", () => {
    const prior = nextWarningState(undefined, FINGERPRINT, "run-1");
    const cleared = nextWarningState(prior, undefined, "run-2");
    const changed = nextWarningState(cleared, "b".repeat(64), "run-3");

    expect(cleared).toMatchObject({ fingerprint: null, consecutiveRuns: 0 });
    expect(changed.consecutiveRuns).toBe(1);
  });

  test("increments legacy state once before recording its workflow run", () => {
    const migrated = nextWarningState(
      {
        schemaVersion: 1,
        fingerprint: FINGERPRINT,
        consecutiveRuns: 3,
      },
      FINGERPRINT,
      "run-4",
    );

    expect(migrated).toMatchObject({
      consecutiveRuns: 4,
      lastWorkflowRunId: "run-4",
    });
  });
});

describe("Scout queue liveness filtering", () => {
  const sparse = {
    kind: "sparse-no-close",
    queue: "classic",
    message: "no matches",
    total: 0,
  };
  const young = { kind: "window-too-young", queue: "urf", message: "young" };
  const unknownKind = { kind: "new-kind", message: "unidentified" };
  const check = (status: "live" | "ended" | "unknown") => ({
    findingId: queueWarningFinding(sparse).id ?? "",
    queue: "classic",
    status,
    rationale: "evidence",
    sources: [],
  });

  test("drops only warnings with an accepted live verdict", () => {
    expect(
      unverifiedWarnings([sparse, young, unknownKind], [check("live")]),
    ).toEqual([young, unknownKind]);
  });

  test("keeps ended and unknown warnings in the escalation state", () => {
    expect(unverifiedWarnings([sparse], [check("ended")])).toEqual([sparse]);
    expect(unverifiedWarnings([sparse], [check("unknown")])).toEqual([sparse]);
    expect(unverifiedWarnings([sparse], [])).toEqual([sparse]);
  });
});

const UpdatedQueueWindowsSchema = z.object({
  queues: z.record(
    z.string(),
    z.array(z.object({ start: z.string(), end: z.string().nullable() })),
  ),
});

async function writeTempQueueWindows(
  contents: unknown,
): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "queue-close-test-"));
  const file = `${dir}/queue-windows.json`;
  await Bun.write(file, JSON.stringify(contents, null, 2));
  return {
    file,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("applyConfirmedEndedQueueCloses", () => {
  test("sets end on open window and appends non-auto-merging close edit when endedOn and https source are valid", async () => {
    const temp = await writeTempQueueWindows({
      queues: {
        arurf: [{ start: "2026-08-01", end: null, source: "observed" }],
      },
    });
    const report: QueueWindowsReport = {
      edits: [],
      warnings: [],
      unknownQueueIds: [],
      patchNotes: { titles: [] },
    };

    try {
      const applied = await applyConfirmedEndedQueueCloses({
        queueWindowsFile: temp.file,
        report,
        today: "2026-09-01",
        isRemediationEnabled: () => Promise.resolve(true),
        verifyHttpsSourceReachable: (url) =>
          Promise.resolve(
            url === "https://www.leagueoflegends.com/en-us/news/patch-26-17/",
          ),
        livenessChecks: [
          {
            findingId: "f-1",
            queue: "arurf",
            status: "ended",
            endedOn: "2026-08-25",
            rationale: "Patch 26.17 rotated ARURF out.",
            sources: [
              "https://www.leagueoflegends.com/en-us/news/patch-26-17/",
            ],
          },
        ],
      });

      expect(applied).toHaveLength(1);
      expect(report.edits).toEqual([
        {
          queue: "arurf",
          kind: "close",
          date: "2026-08-25",
          message:
            "LLM web-search confirmed ended (Patch 26.17 rotated ARURF out.; sources: https://www.leagueoflegends.com/en-us/news/patch-26-17/)",
        },
      ]);
      expect(canAutoMerge(report.edits)).toBe(false);
      const updated = UpdatedQueueWindowsSchema.parse(
        await Bun.file(temp.file).json(),
      );
      expect(updated.queues["arurf"]?.[0]?.end).toBe("2026-08-25");
    } finally {
      await temp.cleanup();
    }
  });

  test("ignores ended verdicts with future dates, dates before start, unreachable URLs, errorClass, or disabled flag", async () => {
    const temp = await writeTempQueueWindows({
      queues: {
        arurf: [{ start: "2026-08-10", end: null, source: "observed" }],
      },
    });
    const report: QueueWindowsReport = {
      edits: [],
      warnings: [],
      unknownQueueIds: [],
      patchNotes: { titles: [] },
    };

    try {
      const unreachable = await applyConfirmedEndedQueueCloses({
        queueWindowsFile: temp.file,
        report,
        today: "2026-09-01",
        isRemediationEnabled: () => Promise.resolve(true),
        verifyHttpsSourceReachable: () => Promise.resolve(false),
        livenessChecks: [
          {
            findingId: "f-1",
            queue: "arurf",
            status: "ended",
            endedOn: "2026-08-20",
            rationale: "Ended",
            sources: ["https://www.leagueoflegends.com/dead"],
          },
        ],
      });
      expect(unreachable).toEqual([]);

      const outOfRange = await applyConfirmedEndedQueueCloses({
        queueWindowsFile: temp.file,
        report,
        today: "2026-09-01",
        isRemediationEnabled: () => Promise.resolve(true),
        verifyHttpsSourceReachable: () => Promise.resolve(true),
        livenessChecks: [
          {
            findingId: "f-2",
            queue: "arurf",
            status: "ended",
            endedOn: "2026-08-05",
            rationale: "Before start",
            sources: ["https://www.leagueoflegends.com/ok"],
          },
          {
            findingId: "f-3",
            queue: "arurf",
            status: "ended",
            endedOn: "2026-09-10",
            rationale: "After today",
            sources: ["https://www.leagueoflegends.com/ok"],
          },
          {
            findingId: "f-4",
            queue: "arurf",
            status: "ended",
            endedOn: "2026-08-20",
            errorClass: "TimeoutError",
            rationale: "Errored",
            sources: ["https://www.leagueoflegends.com/ok"],
          },
        ],
      });
      expect(outOfRange).toEqual([]);

      const flagOff = await applyConfirmedEndedQueueCloses({
        queueWindowsFile: temp.file,
        report,
        today: "2026-09-01",
        isRemediationEnabled: () => Promise.resolve(false),
        verifyHttpsSourceReachable: () => Promise.resolve(true),
        livenessChecks: [
          {
            findingId: "f-5",
            queue: "arurf",
            status: "ended",
            endedOn: "2026-08-20",
            rationale: "Valid",
            sources: ["https://www.leagueoflegends.com/ok"],
          },
        ],
      });
      expect(flagOff).toEqual([]);
      expect(report.edits).toEqual([]);
    } finally {
      await temp.cleanup();
    }
  });
});
