import { describe, expect, test } from "bun:test";
import { z } from "zod";

// Note: Full integration tests for checkAbandonedGuilds would require:
// - Test database with GuildPermissionError records
// - Mock Discord client
// - Time manipulation for 7-day threshold
//
// These tests focus on the metrics and basic functionality

describe("Abandoned Guilds - Unit Tests", () => {
  test("should export the main function", async () => {
    const { checkAbandonedGuilds } = await import("./abandoned-guilds.js");
    expect(checkAbandonedGuilds).toBeDefined();
    expect(checkAbandonedGuilds).toBeFunction();
  });
});

describe("Abandoned Guild Metrics", () => {
  test("metrics should be exported and usable", async () => {
    // Import metrics
    const { abandonedGuildsDetectedTotal, guildsLeftTotal, abandonmentNotificationsTotal, guildDataCleanupTotal } =
      await import("../../../metrics/index.js");

    // Verify metrics exist and are counters
    expect(abandonedGuildsDetectedTotal).toBeDefined();
    expect(guildsLeftTotal).toBeDefined();
    expect(abandonmentNotificationsTotal).toBeDefined();
    expect(guildDataCleanupTotal).toBeDefined();

    // Verify they have inc() method (Counter behavior)
    const CounterSchema = z.object({ inc: z.function() }).loose();
    expect(CounterSchema.safeParse(abandonedGuildsDetectedTotal).success).toBe(true);
    expect(CounterSchema.safeParse(guildsLeftTotal).success).toBe(true);
    expect(CounterSchema.safeParse(abandonmentNotificationsTotal).success).toBe(true);
    expect(CounterSchema.safeParse(guildDataCleanupTotal).success).toBe(true);
  });

  test("metrics should increment without errors", async () => {
    // Import metrics
    const { abandonedGuildsDetectedTotal, guildsLeftTotal, abandonmentNotificationsTotal, guildDataCleanupTotal } =
      await import("../../../metrics/index.js");

    // Test incrementing each metric
    expect(() => abandonedGuildsDetectedTotal.inc(1)).not.toThrow();
    expect(() => guildsLeftTotal.inc({ reason: "abandoned" })).not.toThrow();
    expect(() => abandonmentNotificationsTotal.inc({ status: "success" })).not.toThrow();
    expect(() => guildDataCleanupTotal.inc({ data_type: "subscriptions", status: "success" })).not.toThrow();
  });
});
