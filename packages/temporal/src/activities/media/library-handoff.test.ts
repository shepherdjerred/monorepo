import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import {
  createLibraryHandoffFileActivities,
  createLibraryHandoffNetworkActivities,
} from "./library-handoff.ts";

afterEach(() => vi.restoreAllMocks());
const input = {
  schemaVersion: 3 as const,
  operationId: "00000000-0000-4000-8000-000000000001",
  planId: "00000000-0000-4000-8000-000000000002",
  assetId: "00000000-0000-4000-8000-000000000003",
};
const reference = {
  id: "00000000-0000-4000-8000-000000000004",
  evidenceHash: "a".repeat(64),
};
const edit = { ...input, filesObservation: reference };
function environment(at: number, startToCloseTimeoutMs: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: startToCloseTimeoutMs * 2,
    startToCloseTimeoutMs,
    heartbeatTimeoutMs: 30_000,
  });
}

test("network label edits retain the entry clock across lazy initialization, including historical ACKs", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const dispatch = vi.fn((_input: unknown, execution: PlexBindingExecution) => {
    expect(execution.observed.wall).toBe(at);
    expect(execution.expiresAtMs).toBe(at + 60_000);
    execution.assertActive();
    return Promise.resolve(reference);
  });
  const activities = createLibraryHandoffNetworkActivities(() => {
    clock.mockReturnValue(at + 61_000);
    return Promise.resolve({
      libraryHandoff: {
        edit: dispatch,
        plannedEdits: () => Promise.resolve({ assetIds: [] }),
        protect: () => Promise.resolve(),
      },
    });
  });
  expect(
    await environment(at, 120_000).run(activities.editLibraryPlexEdition, edit),
  ).toEqual(reference);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(edit, expect.any(Object));
});

test("file hashing retains its original twelve-hour SDK deadline without resetting the observation clock", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const dispatch = vi.fn((_input: unknown, execution: PlexBindingExecution) => {
    expect(execution.observed.wall).toBe(at);
    expect(execution.expiresAtMs).toBe(at + 43_200_000);
    execution.assertActive();
    return Promise.resolve(reference);
  });
  const activities = createLibraryHandoffFileActivities(() => {
    clock.mockReturnValue(at + 90_000);
    return Promise.resolve({ libraryHandoff: { prepareEditFile: dispatch } });
  });
  expect(
    await environment(at, 43_200_000).run(
      activities.prepareLibraryPlexEditFile,
      input,
    ),
  ).toEqual(reference);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(input, expect.any(Object));
});

test.each(["network", "files"] as const)(
  "%s SDK expiry during initialization prevents dispatch",
  async (role) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const dispatch = vi.fn(() => Promise.resolve(reference));
    const network = createLibraryHandoffNetworkActivities(() => {
      clock.mockReturnValue(at + 120_000);
      return Promise.resolve({
        libraryHandoff: {
          edit: dispatch,
          plannedEdits: () => Promise.resolve({ assetIds: [] }),
          protect: () => Promise.resolve(),
        },
      });
    });
    const files = createLibraryHandoffFileActivities(() => {
      clock.mockReturnValue(at + 120_000);
      return Promise.resolve({ libraryHandoff: { prepareEditFile: dispatch } });
    });
    const env = environment(at, 120_000);
    if (role === "network")
      await expect(
        env.run(network.editLibraryPlexEdition, edit),
      ).rejects.toThrow("Activity failed");
    else
      await expect(
        env.run(files.prepareLibraryPlexEditFile, input),
      ).rejects.toThrow("Activity failed");
    expect(dispatch).not.toHaveBeenCalled();
  },
);
