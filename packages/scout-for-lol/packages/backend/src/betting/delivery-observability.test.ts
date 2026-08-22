import { describe, expect, test } from "bun:test";
import {
  observeBucksDelivery,
  recordBucksDeliverySkip,
} from "#src/betting/delivery-observability.ts";
import { ChannelSendError } from "#src/league/discord/channel.ts";
import { registry } from "#src/metrics/registry.ts";

/**
 * Counters are process-global and `bun test` runs files in parallel, so every
 * assertion here diffs before and after rather than reading an absolute value.
 */
async function countOf(labels: Record<string, string>): Promise<number> {
  const metric = registry.getSingleMetric("betting_message_operations_total");
  if (metric === undefined) {
    throw new Error("betting_message_operations_total is not registered");
  }
  const collected = await metric.get();
  const match = collected.values.find((value) =>
    Object.entries(labels).every(
      ([key, expected]) => value.labels[key] === expected,
    ),
  );
  return match?.value ?? 0;
}

describe("observeBucksDelivery", () => {
  test("counts a successful delivery", async () => {
    const labels = {
      surface: "prematch",
      operation: "edit",
      result: "success",
    };
    const before = await countOf(labels);

    await expect(
      observeBucksDelivery({ surface: "prematch", operation: "edit" }, () =>
        Promise.resolve("done"),
      ),
    ).resolves.toBe("done");

    expect(await countOf(labels)).toBe(before + 1);
  });

  // Rethrowing is load-bearing: every caller owns its own catch and Sentry
  // semantics, and announce.ts's per-channel isolation depends on seeing the
  // error. Swallowing here would silently change product behaviour.
  test("classifies a permission failure and rethrows it unchanged", async () => {
    const labels = {
      surface: "settlement",
      operation: "send",
      result: "permission_error",
    };
    const before = await countOf(labels);
    const thrown = new ChannelSendError("no perms", "channel-1", true);

    await expect(
      observeBucksDelivery({ surface: "settlement", operation: "send" }, () =>
        Promise.reject(thrown),
      ),
    ).rejects.toBe(thrown);

    expect(await countOf(labels)).toBe(before + 1);
  });

  test("classifies an unknown failure as an error and rethrows it", async () => {
    const labels = {
      surface: "parlay_market",
      operation: "edit",
      result: "error",
    };
    const before = await countOf(labels);
    const thrown = new Error("transient Discord failure");

    await expect(
      observeBucksDelivery(
        { surface: "parlay_market", operation: "edit" },
        () => Promise.reject(thrown),
      ),
    ).rejects.toBe(thrown);

    expect(await countOf(labels)).toBe(before + 1);
  });
});

describe("recordBucksDeliverySkip", () => {
  test("counts each skip reason under its own label", async () => {
    const labels = {
      surface: "prematch",
      operation: "edit",
      result: "skipped_no_refs",
    };
    const before = await countOf(labels);

    recordBucksDeliverySkip({
      surface: "prematch",
      operation: "edit",
      reason: "skipped_no_refs",
      matchId: "NA1_1",
      serverId: "1337623164146155593",
    });

    expect(await countOf(labels)).toBe(before + 1);
  });

  test("counts the expected-forever legacy skip too", async () => {
    const labels = {
      surface: "prematch",
      operation: "edit",
      result: "skipped_no_base",
    };
    const before = await countOf(labels);

    recordBucksDeliverySkip({
      surface: "prematch",
      operation: "edit",
      reason: "skipped_no_base",
      matchId: "NA1_1",
      serverId: "1337623164146155593",
    });

    expect(await countOf(labels)).toBe(before + 1);
  });
});

describe("betting metric naming", () => {
  test("every betting metric is snake_case with the right suffix", async () => {
    await import("#src/metrics/betting.ts");
    const metrics = await registry.getMetricsAsJSON();
    const betting = metrics.filter((metric) =>
      metric.name.startsWith("betting_"),
    );

    expect(betting.length).toBeGreaterThan(10);
    for (const metric of betting) {
      expect(metric.name).toMatch(/^betting_[a-z0-9_]+$/u);
      const type = String(metric.type);
      if (type === "counter") {
        expect(metric.name).toEndWith("_total");
      }
      if (type === "histogram") {
        expect(metric.name).toEndWith("_seconds");
      }
    }
  });

  test("no betting metric declares an identifier label", async () => {
    await import("#src/metrics/betting.ts");
    const metrics = await registry.getMetricsAsJSON();
    const forbidden = [
      "match_id",
      "server_id",
      "discord_id",
      "channel_id",
      "puuid",
    ];
    for (const metric of metrics.filter((entry) =>
      entry.name.startsWith("betting_"),
    )) {
      for (const value of metric.values) {
        for (const label of Object.keys(value.labels)) {
          expect(forbidden).not.toContain(label);
        }
      }
    }
  });
});
