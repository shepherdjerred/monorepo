import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { serverLogs } from "./harness/server.ts";

describe("The Storm plugin", () => {
  test("enables on Paper 26.2 after LuckPerms with the test modules on", async ({
    server,
  }) => {
    const logs = await serverLogs(server);
    const luckPerms = logs.indexOf("[LuckPerms] Enabling LuckPerms");
    const storm = logs.indexOf("[TheStorm] Enabling TheStorm");
    expect(luckPerms).toBeGreaterThanOrEqual(0);
    // paper-plugin.yml requires LuckPerms to load first.
    expect(storm).toBeGreaterThan(luckPerms);
    // The test config enables exactly the modules the specs need. The log line
    // prints a set, so the order is meaningless; compare as sorted lists.
    const enabled = /\[TheStorm\] Enabled modules: \[(.*?)\]/u.exec(logs);
    expect(enabled?.[1]?.split(", ").toSorted()).toEqual([
      "agent",
      "chat",
      "tickets",
    ]);
    expect(logs).not.toContain("Error occurred while enabling TheStorm");
  });
});
