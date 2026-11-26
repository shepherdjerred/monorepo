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

  test("a job that does not say otherwise runs at load, byte for byte as before", () => {
    const spec = {
      label: "com.example.job",
      plistPath: "/tmp/job.plist",
      programArguments: ["/bin/tool", "sync & run"],
      logsDir: "/tmp/logs",
      keepAlive: false,
      startIntervalSeconds: 300,
      environment: { PATH: "/usr/bin" },
    };
    const expected = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.job</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/tool</string>
    <string>sync &amp; run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin</string>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/tmp/logs/launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/logs/launchd.stderr.log</string>
</dict>
</plist>
`;
    expect(renderLaunchAgentPlist(spec)).toBe(expected);
    expect(renderLaunchAgentPlist({ ...spec, runAtLoad: true })).toBe(expected);
    expect(renderLaunchAgentPlist({ ...spec, runAtLoad: false })).toBe(
      expected.replace(
        "<key>RunAtLoad</key>\n  <true/>",
        "<key>RunAtLoad</key>\n  <false/>",
      ),
    );
    expect(
      renderLaunchAgentPlist(
        syncLaunchAgent(defaultBrimSyncPaths("/Users/tester"), []),
      ),
    ).toContain("<key>RunAtLoad</key>\n  <true/>");
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
