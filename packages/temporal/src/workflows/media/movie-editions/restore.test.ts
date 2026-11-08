import { expect, test } from "vitest";
import { runRestoreScenario } from "./restore.test-support.ts";

test.each(["available", "waiting_then_available"] as const)(
  "scoped restore %s preserves strict IDs, finalizes only verified serving and replays",
  async (mode) => {
    const actual = await runRestoreScenario(mode);
    expect(actual.result).toEqual({ status: "completed" });
    expect(actual.state).toMatchObject({
      files: 1,
      plex: mode === "available" ? 1 : 2,
      finalized: 1,
    });
    expect(actual.finishes).toMatchObject([
      { status: "completed", reason: null },
    ]);
  },
  60_000,
);

test.each([
  "files_protected",
  "plex_blocked",
  "plex_obsolete",
  "plex_exhausted",
] as const)(
  "scoped restore %s preserves protective operation status and replays",
  async (mode) => {
    const actual = await runRestoreScenario(mode);
    expect(actual.result).toEqual({
      status: mode === "plex_obsolete" ? "obsolete" : "blocked",
      reason:
        mode === "files_protected"
          ? "selected_file_protected"
          : mode === "plex_exhausted"
            ? "movie_plex_restore_unconfirmed"
            : "selected_restore_protected",
    });
    expect(actual.state.files).toBe(1);
    expect(actual.state.finalized).toBe(0);
    expect(actual.state.plex).toBe(
      mode === "files_protected" ? 0 : mode === "plex_exhausted" ? 30 : 1,
    );
    expect(actual.finishes).toMatchObject([
      { status: mode === "plex_obsolete" ? "completed" : "reconciling" },
    ]);
  },
  60_000,
);

test.each(["cancel_files", "cancel_plex"] as const)(
  "scoped restore %s waits for Activity cancellation settlement and replays",
  async (mode) => {
    const actual = await runRestoreScenario(mode);
    expect(actual.result).toEqual({ cancelled: true });
    expect(actual.state.settled).toBe(true);
    expect(actual.state.finalized).toBe(0);
    expect(actual.finishes).toMatchObject([
      { status: "reconciling", reason: "movie_operation_cancelled" },
    ]);
  },
  60_000,
);

test("a failed actual finalization cannot complete the scoped restore operation and replays", async () => {
  const actual = await runRestoreScenario("finalizer_failed");
  expect(actual.result).toEqual({ failed: true });
  expect(actual.state).toMatchObject({ files: 1, plex: 1, finalized: 1 });
  expect(actual.finishes).toMatchObject([
    { status: "reconciling", reason: "movie_operation_failed" },
  ]);
}, 60_000);
