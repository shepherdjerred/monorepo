import { afterEach, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { testPuuid } from "#src/testing/test-ids.ts";

const puuid = testPuuid("normal-history-target");
const resolve = vi.fn(() =>
  Promise.resolve({ kind: "ok", puuid, gameName: "Target", tagLine: "NA1" }),
);
const finished = {
  requested: 100,
  found: 87,
  alreadyAvailable: 10,
  ingested: 76,
  skipped: 1,
};
const result = vi.fn((): Promise<typeof finished> => Promise.resolve(finished));
const start = vi.fn(() =>
  Promise.resolve({ workflowId: "normal-import", result }),
);
vi.doMock("#src/lib/riot/resolve-puuid.ts", () => ({
  resolveRiotIdToPuuid: resolve,
}));
vi.doMock("#src/temporal/runtime.ts", () => ({
  currentScoutTemporalSupervisor: () => ({ client: () => ({}) }),
}));
vi.doMock("#src/temporal/starts.ts", () => ({
  startScoutExploreHistory: start,
}));
const { createRiotHistoryExploreTools } =
  await import("./riot-history-tools.ts");
const tools = createRiotHistoryExploreTools({
  requesterId: DiscordAccountIdSchema.parse("160509172704739328"),
  guildIds: [DiscordGuildIdSchema.parse("1337623164146155593")],
  track: async (_name, work) => await work(),
});
const target = {
  kind: "riot_id",
  riotId: "Target#NA1",
  region: "AMERICA_NORTH",
} as const;
const options = { toolCallId: "acquire", messages: [], context: {} };
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("normal acquisition waits for completion and reports actual ready coverage", async () => {
  const output = await tools.acquire_match_history.execute?.(
    { target, matchType: "normal" },
    options,
  );
  expect(resolve).toHaveBeenCalledWith(
    { game_name: "Target", tag_line: "NA1" },
    "AMERICA_NORTH",
  );
  expect(start).toHaveBeenCalledWith(
    {},
    expect.objectContaining({
      puuid,
      region: "AMERICA_NORTH",
      matchType: "normal",
      requestedMatches: 100,
    }),
  );
  expect(output).toMatchObject({
    status: "ready",
    matchType: "normal",
    ...finished,
  });
  expect(output).toHaveProperty(
    "message",
    expect.stringContaining("86 of 87 recent normal games"),
  );
});

test("legacy ranked tool does not add new fields to durable workflow input", async () => {
  await tools.acquire_ranked_history.execute?.({ target }, options);
  expect(start).toHaveBeenCalledWith(
    {},
    expect.not.objectContaining({ matchType: expect.anything() }),
  );
});

test("a slow import reports pending without inventing completed counts", async () => {
  vi.useFakeTimers();
  result.mockImplementationOnce(
    () =>
      new Promise(() => {
        /* The durable import remains pending. */
      }),
  );
  const pending = tools.acquire_match_history.execute?.(
    { target, matchType: "normal" },
    options,
  );
  await vi.advanceTimersByTimeAsync(120_000);
  const output = await pending;
  expect(output).toMatchObject({
    status: "pending",
    workflowId: "normal-import",
    requested: 100,
    matchType: "normal",
  });
  expect(output).not.toHaveProperty("ingested");
  expect(output).not.toHaveProperty("found");
});
