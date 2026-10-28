import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "./movie-editions.ts";
import { assertPrivateHistory } from "./testing/history.ts";
import { createMovieWatchWorkerActivitiesV4 } from "./movie-watch.ts";

afterEach(() => vi.restoreAllMocks());
function history(encoding: string, value: unknown) {
  return JSON.stringify({
    events: [
      {
        input: {
          payloads: [
            {
              metadata: {
                encoding: Buffer.from(encoding).toString("base64"),
              },
              data: Buffer.from(JSON.stringify(value)).toString("base64"),
            },
          ],
        },
      },
    ],
  });
}
test("history privacy inspects encoded payload bytes and refuses unexpected binary inputs", () => {
  expect(() =>
    assertPrivateHistory(history("json/plain", { sourceId: "synthetic-id" }), [
      "magnet:",
    ]),
  ).not.toThrow();
  expect(() =>
    assertPrivateHistory(
      history("json/plain", { privateSource: "magnet:synthetic" }),
      ["magnet:"],
    ),
  ).toThrow("private input");
  expect(() =>
    assertPrivateHistory(history("binary/plain", "synthetic bytes"), [
      "magnet:",
    ]),
  ).toThrow("unexpected binary");
});
const input = {
  schemaVersion: 4 as const,
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  decisionId: "00000000-0000-4000-8000-000000000006",
  mediaId: "00000000-0000-4000-8000-000000000003",
  generation: 1,
  assetId: "00000000-0000-4000-8000-000000000004",
  subtitleId: "00000000-0000-4000-8000-000000000005",
  language: "en",
  recoveryEpoch: 0,
  targetAuthority: "a".repeat(64),
  stage: "quarantined" as const,
  scope: {
    mediaId: "00000000-0000-4000-8000-000000000003",
    rootMediaId: "00000000-0000-4000-8000-000000000003",
    edition: "extended_cut" as const,
  },
};
const networkMethods = [
  "completeMovieRemovalV4",
  "finalizeMovieRestorationV4",
  "publishRestoredMovieToPlexV4",
  "evaluateMovieRetentionV4",
  "findMovieSubtitlesV4",
  "reconcileMovieIntentV4",
  "submitMovieTorrentV4",
  "observeMovieAcquisitionV4",
  "publishMovieToPlexV4",
  "finalizeMovieAcquisitionV4",
] as const;
const fileMethods = [
  "restoreMovieFilesV4",
  "purgeMovieFilesV4",
  "quarantineMovieFilesV4",
  "inspectAndStageMovieV4",
  "promoteMovieFilesV4",
  "installMovieSubtitlesV4",
] as const;
function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 180_000,
    heartbeatTimeoutMs: 30_000,
  });
}

test("scoped Plex hints retain original SDK expiry and cancellation across lazy loading", async () => {
  const hint = {
    schemaVersion: 4 as const,
    kind: "observe_movie_plex_hint_v4" as const,
    operationId: input.operationId,
    recoveryEpoch: 0,
    mediaId: input.mediaId,
    scope: input.scope,
    generation: 1,
    serverMachineId: "synthetic",
    sectionId: "1",
    ratingKey: "2",
  };
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const effect = vi.fn();
  const activities = createMovieWatchWorkerActivitiesV4(() => {
    clock.mockReturnValue(at + 120_001);
    return Promise.resolve({
      movieWatch: {
        observeMoviePlexHintV4: (_input, execution) => {
          expect(execution.observed.wall).toBe(at);
          execution.assertActive();
          effect();
          return Promise.resolve({
            status: "observed" as const,
            complete: true,
          });
        },
      },
    });
  });
  await expect(
    environment(at).run(activities.observeMoviePlexHintV4, hint),
  ).rejects.toMatchObject({ type: "WatchObservationFailure" });
  expect(effect).not.toHaveBeenCalled();
  clock.mockReturnValue(at);
  const cancelled = environment(at);
  cancelled.cancel();
  await expect(
    cancelled.run(activities.observeMoviePlexHintV4, hint),
  ).rejects.toThrow("cancelled");
});

function networkRuntime(check: (execution: PlexBindingExecution) => void) {
  return {
    movie: {
      completeMovieRemovalV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "completed" as const, reason: null });
      },
      finalizeMovieRestorationV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve();
      },
      publishRestoredMovieToPlexV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "available" as const, reason: null });
      },
      evaluateMovieRetentionV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({
          status: "protected" as const,
          decisionId: null,
          wakeAt: null,
          reason: "synthetic",
        });
      },
      findMovieSubtitlesV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({
          status: "waiting" as const,
          subtitleId: null,
          reason: null,
        });
      },
      reconcileMovieIntentV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({
          status: "waiting" as const,
          attemptId: null,
          reason: null,
        });
      },
      submitMovieTorrentV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "submitted" as const, reason: null });
      },
      observeMovieAcquisitionV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({
          status: "downloading" as const,
          reason: null,
        });
      },
      publishMovieToPlexV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "available" as const, reason: null });
      },
      finalizeMovieAcquisitionV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve();
      },
    },
  };
}
function fileRuntime(check: (execution: PlexBindingExecution) => void) {
  return {
    movie: {
      restoreMovieFilesV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "restored" as const });
      },
      purgeMovieFilesV4: (_input: unknown, execution: PlexBindingExecution) => {
        check(execution);
        return Promise.resolve({ status: "purged" as const });
      },
      quarantineMovieFilesV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "quarantined" as const });
      },
      installMovieSubtitlesV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "installed" as const });
      },
      inspectAndStageMovieV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "staged" as const });
      },
      promoteMovieFilesV4: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "published" as const });
      },
    },
  };
}

test.each(["quarantined", "protected"] as const)(
  "quarantine preserves its exact scoped decision and %s result through the SDK adapter",
  async (status) => {
    const decision = {
      schemaVersion: input.schemaVersion,
      operationId: input.operationId,
      decisionId: input.decisionId,
      scope: input.scope,
    };
    const runtime = fileRuntime(vi.fn());
    const outcome = { status, reason: "synthetic-quarantine-result" };
    const dispatch = vi.fn(
      (received: unknown, execution: PlexBindingExecution) => {
        expect(received).toBe(decision);
        execution.assertActive();
        return Promise.resolve(outcome);
      },
    );
    const activities = createMovieFileWorkerActivitiesV4(() =>
      Promise.resolve({
        movie: { ...runtime.movie, quarantineMovieFilesV4: dispatch },
      }),
    );
    expect(
      await environment().run(activities.quarantineMovieFilesV4, decision),
    ).toEqual(outcome);
    expect(dispatch).toHaveBeenCalledTimes(1);
  },
);

test.each(fileMethods)(
  "%s refuses queued expiry and cancellation before lazy initialization",
  async (method) => {
    const load = vi.fn(() =>
      Promise.reject(new Error("Runtime must not initialize")),
    );
    const activities = createMovieFileWorkerActivitiesV4(load);
    await expect(
      environment(Date.now() - 120_001).run(() => activities[method](input)),
    ).rejects.toThrow("Compensation Activity failed");
    const cancelled = environment();
    cancelled.cancel();
    await expect(
      cancelled.run(() => activities[method](input)),
    ).rejects.toThrow("cancelled");
    expect(load).not.toHaveBeenCalled();
  },
);

test.each(fileMethods)(
  "%s refuses cancellation during runtime loading before any file effect",
  async (method) => {
    const activity = environment();
    const effect = vi.fn();
    const activities = createMovieFileWorkerActivitiesV4(() => {
      activity.cancel();
      return Promise.resolve(fileRuntime(effect));
    });
    await expect(activity.run(() => activities[method](input))).rejects.toThrow(
      "cancelled",
    );
    expect(effect).not.toHaveBeenCalled();
  },
);

test.each(networkMethods)(
  "%s refuses queued expiry and cancellation before lazy initialization",
  async (method) => {
    const load = vi.fn(() =>
      Promise.reject(new Error("Runtime must not initialize")),
    );
    const activities = createMovieNetworkWorkerActivitiesV4(load);
    await expect(
      environment(Date.now() - 120_001).run(() => activities[method](input)),
    ).rejects.toThrow("Plex binding Activity failed");
    const cancelled = environment();
    cancelled.cancel();
    await expect(
      cancelled.run(() => activities[method](input)),
    ).rejects.toThrow("cancelled");
    expect(load).not.toHaveBeenCalled();
  },
);

test.each(networkMethods)(
  "%s retains its original proof clock through a cold runtime load",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const check = vi.fn((execution: PlexBindingExecution) => {
      expect(execution.observed.wall).toBe(at);
      expect(execution.expiresAtMs).toBe(at + 60_000);
      execution.assertActive();
    });
    const activities = createMovieNetworkWorkerActivitiesV4(() => {
      clock.mockReturnValue(at + 61_000);
      return Promise.resolve(networkRuntime(check));
    });
    await environment(at).run(() => activities[method](input));
    expect(check).toHaveBeenCalledTimes(1);
  },
);

test.each(fileMethods)(
  "%s captures the original Files invocation before runtime loading",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const check = vi.fn((execution: PlexBindingExecution) => {
      expect(execution.observed.wall).toBe(at);
      expect(execution.expiresAtMs).toBe(at + 120_000);
      execution.assertActive();
    });
    const activities = createMovieFileWorkerActivitiesV4(() => {
      clock.mockReturnValue(at + 61_000);
      return Promise.resolve(fileRuntime(check));
    });
    await environment(at).run(() => activities[method](input));
    expect(check).toHaveBeenCalledTimes(1);
  },
);

test.each(fileMethods)(
  "%s rejects SDK expiry during runtime loading before any file effect",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const check = vi.fn();
    const activities = createMovieFileWorkerActivitiesV4(() => {
      clock.mockReturnValue(at + 120_001);
      return Promise.resolve(fileRuntime(check));
    });
    await expect(
      environment(at).run(() => activities[method](input)),
    ).rejects.toThrow("Compensation Activity failed");
    expect(check).not.toHaveBeenCalled();
  },
);

test("movie Network SDK expiry after lazy load never dispatches an acquisition producer", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const check = vi.fn();
  const activities = createMovieNetworkWorkerActivitiesV4(() => {
    clock.mockReturnValue(at + 120_001);
    return Promise.resolve(networkRuntime(check));
  });
  await expect(
    environment(at).run(() => activities.submitMovieTorrentV4(input)),
  ).rejects.toThrow("Plex binding Activity failed");
  expect(check).not.toHaveBeenCalled();
});
