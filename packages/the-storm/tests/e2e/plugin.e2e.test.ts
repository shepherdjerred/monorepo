import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";

describe("The Storm plugin", () => {
  test("enables on Paper 26.3 after LuckPerms with E2E modules on", async ({
    server,
  }) => {
    const logs = await serverLogs(server);
    const luckPerms = logs.indexOf("[LuckPerms] Enabling LuckPerms");
    const storm = logs.indexOf("[TheStorm] Enabling TheStorm");
    expect(luckPerms).toBeGreaterThanOrEqual(0);
    // paper-plugin.yml requires LuckPerms to load first.
    expect(storm).toBeGreaterThan(luckPerms);
    // These modules power the mechanics, AI staff and Search and Destroy suites.
    const enabled = /\[TheStorm\] Enabled modules: \[(.*?)\]/u.exec(logs);
    expect(enabled?.[1]?.split(", ").toSorted()).toEqual([
      "agent",
      "chat",
      "economy",
      "essentials",
      "mail",
      "mobs",
      "qol",
      "reset",
      "rwf",
      "safety",
      "tickets",
      "towns",
      "tracks",
      "world",
    ]);
    expect(logs).toContain(
      "Prepared synthetic fixtures for Storm modules [world, towns, essentials, rwf]",
    );
    expect(logs).toContain(
      "[TheStormMechanicsE2E] Enabled real-Paper mechanics E2E harness",
    );
    expect(logs).not.toContain("Error occurred while enabling TheStorm");
  });
});
