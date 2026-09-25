import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { serverLogs } from "./harness/server.ts";

describe("The Storm plugin", () => {
  test("enables on Paper 26.2 with every module switched off", async ({
    server,
  }) => {
    const logs = await serverLogs(server);
    expect(logs).toContain("[TheStorm] Enabling TheStorm");
    // The smoke config disables every module, so the list is empty.
    expect(logs).toContain("[TheStorm] Enabled modules: []");
    expect(logs).not.toContain("Error occurred while enabling TheStorm");
  });
});
