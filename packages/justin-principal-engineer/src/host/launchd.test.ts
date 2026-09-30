import { describe, expect, test } from "vitest";

import { renderLaunchAgent } from "#src/host/launchd.ts";

describe("renderLaunchAgent", () => {
  test("runs one reconcile every minute without KeepAlive", () => {
    const plist = renderLaunchAgent({
      bun: "/opt/homebrew/bin/bun",
      cli: "/Users/test/repo/packages/justin-principal-engineer/src/cli.ts",
      checkout: "/Users/test/repo",
      path: "/opt/homebrew/bin:/usr/bin",
      linearApiKeyReference: "op://Automation/Linear/credential",
      woodpeckerTokenReference: "op://Automation/Woodpecker/credential",
      pinchtabConfigPath:
        "/Users/test/Library/Application Support/pinchtab/config.json",
      stdout: "/tmp/stdout.log",
      stderr: "/tmp/stderr.log",
    });
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>60</integer>");
    expect(plist).not.toContain("KeepAlive");
    expect(plist).toContain("LINEAR_API_KEY=op://Automation/Linear/credential");
    expect(plist).toContain("<string>op</string>");
    expect(plist).toContain(
      "WOODPECKER_TOKEN=op://Automation/Woodpecker/credential",
    );
    expect(plist).toContain(
      "PINCHTAB_CONFIG=/Users/test/Library/Application Support/pinchtab/config.json",
    );
  });
});
