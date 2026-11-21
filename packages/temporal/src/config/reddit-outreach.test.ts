import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REDDIT_OUTREACH_SETTINGS,
  redditOutreachConfig,
} from "./reddit-outreach.ts";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { useMockedFlagSource } from "./flag-source.test-support.ts";

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: vi.fn(),
}));

const source = useMockedFlagSource();

describe("Reddit outreach configuration", () => {
  it("defaults on with bounded discovery and ten replies per day", async () => {
    expect(await redditOutreachConfig()).toEqual({
      enabled: true,
      available: true,
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      provenance: { enabled: "default", settings: "default" },
    });
    expect(source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetingKey: "the-storm-reddit-outreach-prod",
        attributes: { environment: "prod" },
        requireFreshSnapshot: true,
      }),
    );
  });

  it("preserves explicit false and zero reply limits", async () => {
    source.get.mockImplementation((names) =>
      Promise.resolve({
        value:
          names.flag === "the-storm-reddit-outreach-enabled"
            ? false
            : JSON.stringify({
                ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
                maxRepliesPerSweep: 0,
                maxRepliesPerDay: 0,
              }),
      }),
    );
    expect(await redditOutreachConfig()).toMatchObject({
      enabled: false,
      available: true,
      maxRepliesPerSweep: 0,
      maxRepliesPerDay: 0,
      provenance: { enabled: "flag", settings: "flag" },
    });
  });

  it.each([
    "invalid-json",
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxRepliesPerDay: -1,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxPostAgeHours: 25,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxRepliesPerDay: 11,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxRepliesPerSweep: 11,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxPostsPerSweep: 1501,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxListingPagesPerSweep: 0,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxThreadReadsPerSweep: 0,
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      maxRedditNavigationsPerSweep: 301,
    }),
    JSON.stringify({ ...DEFAULT_REDDIT_OUTREACH_SETTINGS, subreddits: [] }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      subreddits: ["../other"],
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      subreddits: ["MinecraftServer", "minecraftserver"],
    }),
    JSON.stringify({
      ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
      arbitrarySetting: true,
    }),
  ])("rejects invalid present settings: %s", async (value) => {
    source.get.mockImplementation((names) =>
      Promise.resolve(
        names.flag === "the-storm-reddit-outreach-settings"
          ? { value }
          : undefined,
      ),
    );
    await expect(redditOutreachConfig()).rejects.toThrow();
  });

  it("fails closed when the provider is unavailable", async () => {
    source.get.mockRejectedValue(new Error("provider unavailable"));
    expect(await redditOutreachConfig()).toMatchObject({
      enabled: false,
      available: false,
    });
  });

  it("adds bounded browser defaults to retained settings without the new fields", async () => {
    source.get.mockImplementation((names) =>
      Promise.resolve(
        names.flag === "the-storm-reddit-outreach-settings"
          ? {
              value: JSON.stringify({
                subreddits: DEFAULT_REDDIT_OUTREACH_SETTINGS.subreddits,
                maxPostAgeHours: 24,
                maxPostsPerSweep: 1500,
                maxRepliesPerSweep: 10,
                maxRepliesPerDay: 10,
              }),
            }
          : undefined,
      ),
    );
    expect(await redditOutreachConfig()).toMatchObject({
      maxListingPagesPerSweep: 12,
      maxThreadReadsPerSweep: 20,
      maxRedditNavigationsPerSweep: 60,
    });
  });

  it("fails closed on a stale true answer", async () => {
    source.get.mockImplementation((names) => {
      source.create.mock.calls[0]?.[0].onUnavailable?.(names.flag);
      return Promise.resolve(
        names.flag === "the-storm-reddit-outreach-enabled"
          ? { value: true }
          : undefined,
      );
    });
    expect(await redditOutreachConfig()).toMatchObject({
      enabled: false,
      available: false,
    });
  });

  it("re-evaluates changes on the next call", async () => {
    source.get
      .mockResolvedValueOnce({ value: false })
      .mockResolvedValueOnce(undefined);
    const before = await redditOutreachConfig();
    const after = await redditOutreachConfig();
    expect(before.enabled).toBe(false);
    expect(after.enabled).toBe(true);
  });

  it("aligns typed defaults with managed declarations", () => {
    expect(
      managedFlagInventory.flags.find(
        (flag) => flag.key === "the-storm-reddit-outreach-enabled",
      ),
    ).toMatchObject({ namespace: "temporal", type: "boolean", default: true });
    expect(
      managedFlagInventory.flags.find(
        (flag) => flag.key === "the-storm-reddit-outreach-settings",
      ),
    ).toMatchObject({
      namespace: "temporal",
      type: "variant",
      default: JSON.stringify(DEFAULT_REDDIT_OUTREACH_SETTINGS),
    });
  });
});
