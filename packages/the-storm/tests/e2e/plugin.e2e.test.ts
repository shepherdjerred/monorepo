import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { serverLogs } from "./harness/server.ts";

describe("The Storm plugin", () => {
  test("enables on Paper 26.2 after LuckPerms with every module switched off", async ({
    server,
  }) => {
    const logs = await serverLogs(server);
    const luckPerms = logs.indexOf("[LuckPerms] Enabling LuckPerms");
    const storm = logs.indexOf("[TheStorm] Enabling TheStorm");
    expect(luckPerms).toBeGreaterThanOrEqual(0);
    // paper-plugin.yml requires LuckPerms to load first.
    expect(storm).toBeGreaterThan(luckPerms);
    // The smoke config disables every module, so the list is empty.
    expect(logs).toContain("[TheStorm] Enabled modules: []");
    expect(logs).not.toContain("Error occurred while enabling TheStorm");
  });
});
