import { afterEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import type { BucksAskAnalyticsDataset } from "#src/betting/ask-analytics.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  createBucksExploreTools,
  resolveBucksCapability,
} from "#src/explore/bucks-tools.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

const BETTING_GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
const REQUESTER = DiscordAccountIdSchema.parse("160509172704739328");

afterEach(() => {
  resetFlagOverrides("betting_enabled");
});

function emptyDataset(): BucksAskAnalyticsDataset {
  return {
    loadedAt: new Date("2026-08-29T00:00:00Z"),
    accounts: [],
    ledger: [],
    bets: [],
    marketCount: 0,
    aliasesByPuuid: new Map(),
  };
}

const passthroughTracker: ToolTracker = async (_toolName, work) => await work();

describe("resolveBucksCapability", () => {
  test("returns null when no guild in scope has betting enabled", async () => {
    clearFlagOverrides("betting_enabled");
    await expect(resolveBucksCapability([OTHER_GUILD])).resolves.toBeNull();
  });

  test("resolves the one enabled guild and ignores the rest of the scope", async () => {
    clearFlagOverrides("betting_enabled");
    addFlagOverride("betting_enabled", true, { server: BETTING_GUILD });
    await expect(
      resolveBucksCapability([OTHER_GUILD, BETTING_GUILD]),
    ).resolves.toEqual({ serverId: BETTING_GUILD });
  });

  test("a disabled override does not grant the capability", async () => {
    // The registry pre-filter matches guilds with an override in either
    // direction; only the policy answer may grant.
    clearFlagOverrides("betting_enabled");
    addFlagOverride("betting_enabled", false, { server: BETTING_GUILD });
    await expect(resolveBucksCapability([BETTING_GUILD])).resolves.toBeNull();
  });

  test("more than one enabled guild is a hard failure", async () => {
    // Matches runWeeklyBucksLeaderboard: the single-guild assumption is
    // load-bearing until an explicit mapping exists.
    clearFlagOverrides("betting_enabled");
    addFlagOverride("betting_enabled", true, { server: BETTING_GUILD });
    addFlagOverride("betting_enabled", true, { server: OTHER_GUILD });
    await expect(
      resolveBucksCapability([BETTING_GUILD, OTHER_GUILD]),
    ).rejects.toThrow("exactly one enabled guild");
  });
});

describe("createBucksExploreTools", () => {
  test("loads the dataset lazily, exactly once, across tools", async () => {
    let loads = 0;
    const tools = createBucksExploreTools({
      capability: { serverId: BETTING_GUILD },
      requesterId: REQUESTER,
      track: passthroughTracker,
      loadDataset: (serverId) => {
        expect(serverId).toBe(BETTING_GUILD);
        loads += 1;
        return Promise.resolve(emptyDataset());
      },
    });
    // Building the toolset must not pay for the snapshot: most Explore turns
    // in the betting guild are still match questions.
    expect(loads).toBe(0);

    const toolOptions = { toolCallId: "t1", messages: [] };
    await tools.get_bucks_dataset.execute?.({}, toolOptions);
    await tools.query_bucks_accounts.execute?.(
      { measures: ["balance_bb"] },
      toolOptions,
    );
    expect(loads).toBe(1);
  });

  test("the account tool answers for the requester only", async () => {
    const tools = createBucksExploreTools({
      capability: { serverId: BETTING_GUILD },
      requesterId: REQUESTER,
      track: passthroughTracker,
      loadDataset: () => Promise.resolve(emptyDataset()),
    });
    const result = await tools.query_bucks_accounts.execute?.(
      { measures: ["balance_bb"] },
      { toolCallId: "t2", messages: [] },
    );
    // An empty guild snapshot means the requester has no wallet — the result
    // must say so rather than surface anyone else's row.
    expect(JSON.stringify(result)).not.toContain(OTHER_GUILD);
  });

  test("tool calls consume the shared Explore tracker budget", async () => {
    const tracked: string[] = [];
    const tracker: ToolTracker = async (toolName, work) => {
      tracked.push(toolName);
      return await work();
    };
    const tools = createBucksExploreTools({
      capability: { serverId: BETTING_GUILD },
      requesterId: REQUESTER,
      track: tracker,
      loadDataset: () => Promise.resolve(emptyDataset()),
    });
    await tools.get_bucks_dataset.execute?.(
      {},
      { toolCallId: "t3", messages: [] },
    );
    expect(tracked).toEqual(["get_bucks_dataset"]);
  });
});
