import { describe, expect, it } from "vitest";
import { ConfigSchema } from "#src/config/schema.ts";
import { resolveDriverFeedConfig } from "./config.ts";

/** The defaults an operator inherits when config.toml has no [driver_feed]. */
function fileDefaults() {
  return ConfigSchema.shape.driver_feed.parse({});
}

describe("resolveDriverFeedConfig", () => {
  it("leaves the file config alone when nothing is set", () => {
    const resolved = resolveDriverFeedConfig(fileDefaults(), {});
    expect(resolved).toEqual(fileDefaults());
  });

  it("enables the feed without a vault edit", () => {
    const resolved = resolveDriverFeedConfig(fileDefaults(), {
      DRIVER_FEED_ENABLED: "true",
    });
    expect(resolved.enabled).toBe(true);
  });

  it("lets an operator force the feed off regardless of the file value", () => {
    // The incident case: the switch must work without knowing what config says.
    const enabledInFile = { ...fileDefaults(), enabled: true };
    const resolved = resolveDriverFeedConfig(enabledInFile, {
      DRIVER_FEED_ENABLED: "false",
    });
    expect(resolved.enabled).toBe(false);
  });

  it("rejects a misspelled boolean override", () => {
    expect(() =>
      resolveDriverFeedConfig(fileDefaults(), {
        DRIVER_FEED_ENABLED: "ture",
      }),
    ).toThrow(/DRIVER_FEED_ENABLED/);
  });

  it("dials bandwidth down at runtime", () => {
    const resolved = resolveDriverFeedConfig(fileDefaults(), {
      DRIVER_FEED_BITRATE_KBPS: "800",
      DRIVER_FEED_MAX_CLIENTS: "2",
    });
    expect(resolved.bitrate_kbps).toBe(800);
    expect(resolved.max_clients).toBe(2);
  });

  it("throws on an unparseable number instead of silently keeping the old value", () => {
    // Silently ignoring a typo'd bitrate would be discovered by watching the
    // uplink saturate — the exact thing the override exists to prevent.
    expect(() =>
      resolveDriverFeedConfig(fileDefaults(), {
        DRIVER_FEED_BITRATE_KBPS: "2.5mbps",
      }),
    ).toThrow(/DRIVER_FEED_BITRATE_KBPS/);
  });

  it("rejects an out-of-range client cap", () => {
    expect(() =>
      resolveDriverFeedConfig(fileDefaults(), { DRIVER_FEED_MAX_CLIENTS: "0" }),
    ).toThrow(/DRIVER_FEED_MAX_CLIENTS/);
  });

  it("does not treat other fields as overridable", () => {
    const resolved = resolveDriverFeedConfig(fileDefaults(), {
      DRIVER_FEED_ENABLED: "true",
    });
    expect(resolved.height).toBe(fileDefaults().height);
    expect(resolved.keyframe_interval_frames).toBe(
      fileDefaults().keyframe_interval_frames,
    );
  });
});
