import { describe, expect, test } from "vitest";
import { syncLaunchAgent } from "#commands/brim/sync.ts";
import { defaultBrimSyncPaths } from "#lib/brim/sync/paths.ts";
import { HOMEBREW_JOB_PATH, renderLaunchAgentPlist } from "#lib/launchd.ts";

describe("LaunchAgent plists", () => {
  test("the brim sync agent runs every five minutes with Homebrew on PATH", () => {
    const plist = renderLaunchAgentPlist(
      syncLaunchAgent(defaultBrimSyncPaths("/Users/tester"), []),
    );
    expect(plist).toContain("<string>com.jerred.brim-sync</string>");
    expect(plist).toContain(
      "<key>StartInterval</key>\n  <integer>300</integer>",
    );
    expect(plist).not.toContain("<key>KeepAlive</key>");
    expect(plist).toContain(
      `<key>EnvironmentVariables</key>\n  <dict>\n    <key>PATH</key>\n    <string>${HOMEBREW_JOB_PATH}</string>`,
    );
    expect(HOMEBREW_JOB_PATH.split(":")).toContain("/opt/homebrew/bin");
    expect(plist).toContain("/Users/tester/.toolkit/brim-sync/logs");
  });

  test("a job without an environment renders no EnvironmentVariables", () => {
    const plist = renderLaunchAgentPlist({
      label: "com.example.job",
      plistPath: "/tmp/job.plist",
      programArguments: ["/bin/true"],
      logsDir: "/tmp/logs",
      keepAlive: true,
    });
    expect(plist).not.toContain("EnvironmentVariables");
    expect(plist).toContain("<key>KeepAlive</key>");
  });
});
