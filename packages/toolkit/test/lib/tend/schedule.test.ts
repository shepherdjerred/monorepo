import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTendScheduleCommand,
  resolveScheduleGhConfigDir,
  TEND_LAUNCH_AGENT_LABEL,
  tendLaunchAgent,
  type TendScheduleDeps,
} from "#commands/tend/schedule.ts";
import { handleTendCommand } from "#commands/tend/tend.ts";
import { formatTendReport } from "#commands/tend/tend-format.ts";
import {
  HOMEBREW_JOB_PATH,
  parseLaunchAgentEnvironment,
  renderLaunchAgentPlist,
  type LaunchAgentSpec,
} from "#lib/launchd.ts";
import { resolveTendPaths } from "#lib/tend/paths.ts";
import type { TendRunReport } from "#lib/tend/types.ts";
import { captureLog } from "./real-git.ts";

const HOME = "/Users/tester";
const paths = resolveTendPaths({ homeDir: HOME, env: {} });
const PLIST = `${HOME}/Library/LaunchAgents/com.jerred.toolkit-tend.plist`;

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeDeps(
  installed = true,
  loaded = true,
): {
  readonly deps: TendScheduleDeps;
  readonly calls: [string, LaunchAgentSpec][];
} {
  const calls: [string, LaunchAgentSpec][] = [];
  const state = { installed, loaded };
  return {
    calls,
    deps: {
      paths,
      homeDir: HOME,
      // No GH_CONFIG_DIR in the installing shell and no agent login on disk.
      env: {},
      fileExists: () => Promise.resolve(false),
      // An installed job is one installed with these defaults.
      readPlist: () =>
        Promise.resolve(
          installed
            ? renderLaunchAgentPlist(tendLaunchAgent(paths, HOME))
            : null,
        ),
      assertSupported: (action) => {
        calls.push([`supported:${action}`, tendLaunchAgent(paths, HOME)]);
      },
      install: (spec) => {
        calls.push(["install", spec]);
        return Promise.resolve();
      },
      uninstall: (spec) => {
        calls.push(["uninstall", spec]);
        return Promise.resolve();
      },
      status: (spec) => {
        calls.push(["status", spec]);
        return Promise.resolve(state);
      },
    },
  };
}

describe("tend LaunchAgent", () => {
  it("runs the worktree reaper daily with hc and gh on PATH", () => {
    const spec = tendLaunchAgent(paths, HOME);
    expect(spec.label).toBe("com.jerred.toolkit-tend");
    expect(spec.plistPath).toBe(PLIST);
    expect(spec.keepAlive).toBe(false);
    expect(spec.programArguments.slice(-5)).toEqual([
      "tend",
      "run",
      "--apply",
      "--only",
      "worktrees,dedupe",
    ]);

    const plist = renderLaunchAgentPlist(spec);
    expect(plist).toContain("<string>com.jerred.toolkit-tend</string>");
    // A calendar time survives sleep; an interval firing would be missed.
    expect(spec.startCalendarInterval).toEqual({ hour: 4, minute: 30 });
    expect(spec.startIntervalSeconds).toBeUndefined();
    expect(plist).toContain(
      "<key>StartCalendarInterval</key>\n  <dict>\n    <key>Hour</key>\n    <integer>4</integer>\n    <key>Minute</key>\n    <integer>30</integer>\n  </dict>",
    );
    expect(plist).not.toContain("<key>StartInterval</key>");
    expect(plist).not.toContain("<key>KeepAlive</key>");
    // Loading the agent must not start a sweep.
    expect(spec.runAtLoad).toBe(false);
    expect(plist).toContain("<key>RunAtLoad</key>\n  <false/>");
    expect(plist).not.toContain("<true/>");
    expect(plist).toContain(
      `<key>PATH</key>\n    <string>${HOME}/.local/bin:${HOMEBREW_JOB_PATH}</string>`,
    );
    expect(plist).toContain(
      `<string>${HOME}/.toolkit/tend/logs/launchd.stdout.log</string>`,
    );
    expect(plist).toContain(
      "<string>--apply</string>\n    <string>--only</string>\n    <string>worktrees,dedupe</string>",
    );
  });

  it("keeps its logs and state under TOOLKIT_TEND_DIR when that is set", () => {
    const overridden = resolveTendPaths({
      homeDir: HOME,
      env: { TOOLKIT_TEND_DIR: "/tmp/tend-state" },
    });
    const spec = tendLaunchAgent(overridden, HOME);
    expect(spec.logsDir).toBe(path.join("/tmp/tend-state", "logs"));
    // launchd passes nothing on from the installing shell, so the job is
    // told where its lock, leases and events live.
    expect(spec.environment).toMatchObject({
      TOOLKIT_TEND_DIR: "/tmp/tend-state",
    });
    expect(renderLaunchAgentPlist(spec)).toContain(
      "<key>TOOLKIT_TEND_DIR</key>\n    <string>/tmp/tend-state</string>",
    );
    // The default location needs no override.
    expect(Object.keys(tendLaunchAgent(paths, HOME).environment ?? {})).toEqual(
      ["PATH"],
    );
  });
});

describe("the GitHub config the tend job carries", () => {
  const AGENT_LOGIN = `${HOME}/.config/gh-agent/hosts.yml`;
  const resolve = (env: Record<string, string>, present: readonly string[]) =>
    resolveScheduleGhConfigDir({
      homeDir: HOME,
      env,
      fileExists: (filePath) => Promise.resolve(present.includes(filePath)),
    });

  it("is the installing shell's GH_CONFIG_DIR when that is set", async () => {
    expect(await resolve({ GH_CONFIG_DIR: "/opt/gh-ci" }, [AGENT_LOGIN])).toBe(
      "/opt/gh-ci",
    );
  });

  it("falls back to the agents' config directory when it holds a login", async () => {
    expect(await resolve({}, [AGENT_LOGIN])).toBe(`${HOME}/.config/gh-agent`);
    expect(await resolve({ GH_CONFIG_DIR: "" }, [AGENT_LOGIN])).toBe(
      `${HOME}/.config/gh-agent`,
    );
  });

  it("is nothing when the shell names none and there is no agent login", async () => {
    // The directory alone is not a login.
    expect(
      await resolve({}, [`${HOME}/.config/gh-agent/config.yml`]),
    ).toBeUndefined();
    expect(Object.keys(tendLaunchAgent(paths, HOME).environment ?? {})).toEqual(
      ["PATH"],
    );
  });

  it("reaches the job as a path and nothing else", () => {
    const spec = tendLaunchAgent(paths, HOME, `${HOME}/.config/gh-agent`);
    const environment = parseLaunchAgentEnvironment(
      renderLaunchAgentPlist(spec),
    );
    expect(environment).toEqual({
      PATH: `${HOME}/.local/bin:${HOMEBREW_JOB_PATH}`,
      GH_CONFIG_DIR: `${HOME}/.config/gh-agent`,
    });
  });

  it("is never a token, whatever the installing shell exports", async () => {
    const output = captureLog();
    const { deps, calls } = fakeDeps();
    await handleTendScheduleCommand(["install"], {
      ...deps,
      env: {
        GH_CONFIG_DIR: "/opt/gh & co",
        GH_TOKEN: "not-carried",
        GH_ENTERPRISE_TOKEN: "not-carried",
      },
    });
    const installed = calls.find(([action]) => action === "install")?.[1];
    expect(installed?.environment).toEqual({
      PATH: `${HOME}/.local/bin:${HOMEBREW_JOB_PATH}`,
      GH_CONFIG_DIR: "/opt/gh & co",
    });
    const plist = renderLaunchAgentPlist(
      installed ?? tendLaunchAgent(paths, HOME),
    );
    expect(plist).not.toContain("not-carried");
    expect(parseLaunchAgentEnvironment(plist)["GH_CONFIG_DIR"]).toBe(
      "/opt/gh & co",
    );
    expect(output()).toContain("GitHub config: /opt/gh & co");
    expect(output()).not.toContain("not-carried");
  });
});

describe("toolkit tend schedule", () => {
  it("installs and uninstalls the agent it describes", async () => {
    const output = captureLog();
    const { deps, calls } = fakeDeps();
    await handleTendScheduleCommand(["install"], deps);
    await handleTendScheduleCommand(["uninstall"], deps);
    expect(calls.map(([action, spec]) => [action, spec.label])).toEqual([
      ["supported:toolkit tend schedule install", TEND_LAUNCH_AGENT_LABEL],
      ["install", TEND_LAUNCH_AGENT_LABEL],
      ["supported:toolkit tend schedule uninstall", TEND_LAUNCH_AGENT_LABEL],
      ["uninstall", TEND_LAUNCH_AGENT_LABEL],
    ]);
    expect(calls[1]?.[1]).toEqual(tendLaunchAgent(paths, HOME));
    expect(output()).toContain(`Tend LaunchAgent installed: ${PLIST}`);
    expect(output()).toContain(
      "Nothing runs now; the first sweep is the next 04:30, or the next wake after it.",
    );
    expect(output()).toContain(
      "`toolkit tend worktrees` (dry run), then `toolkit tend worktrees --apply`",
    );
    expect(output()).not.toContain("once now");
    expect(output()).toContain(
      "GitHub config: gh's default (no GH_CONFIG_DIR carried)",
    );
    expect(output()).toContain(`Tend LaunchAgent removed: ${PLIST}`);
  });

  it("installs with the agents' GitHub config when the shell names none", async () => {
    const output = captureLog();
    const { deps, calls } = fakeDeps();
    await handleTendScheduleCommand(["install"], {
      ...deps,
      fileExists: (filePath) =>
        Promise.resolve(filePath === `${HOME}/.config/gh-agent/hosts.yml`),
    });
    expect(calls[1]?.[1].environment).toMatchObject({
      GH_CONFIG_DIR: `${HOME}/.config/gh-agent`,
    });
    expect(output()).toContain(`GitHub config: ${HOME}/.config/gh-agent`);
  });

  it("reports the GitHub config the installed job carries, not this shell's", async () => {
    const installedPlist = renderLaunchAgentPlist(
      tendLaunchAgent(paths, HOME, `${HOME}/.config/gh-agent`),
    );
    const { deps } = fakeDeps(true, true);
    const fromOtherShell = {
      ...deps,
      env: { GH_CONFIG_DIR: "/somewhere/else" },
      readPlist: (plistPath: string) =>
        Promise.resolve(plistPath === PLIST ? installedPlist : null),
    };
    const text = captureLog();
    await handleTendScheduleCommand(["status"], fromOtherShell);
    expect(text()).toContain(`GitHub config: ${HOME}/.config/gh-agent`);
    vi.restoreAllMocks();

    const json = captureLog();
    await handleTendScheduleCommand(["status", "--json"], fromOtherShell);
    expect(JSON.parse(json())).toMatchObject({
      ghConfigDir: `${HOME}/.config/gh-agent`,
    });
    vi.restoreAllMocks();

    // A job installed before this existed carries none.
    const older = captureLog();
    await handleTendScheduleCommand(["status"], {
      ...fromOtherShell,
      readPlist: () =>
        Promise.resolve(renderLaunchAgentPlist(tendLaunchAgent(paths, HOME))),
    });
    expect(older()).toContain(
      "GitHub config: gh's default (no GH_CONFIG_DIR carried)",
    );
  });

  it("reports whether the plist exists and is loaded", async () => {
    const output = captureLog();
    await handleTendScheduleCommand(["status"], fakeDeps(true, false).deps);
    expect(output()).toContain(
      "Tend LaunchAgent com.jerred.toolkit-tend: installed (not loaded)",
    );
    expect(output()).toContain(`Plist: ${PLIST}`);
    expect(output()).toContain(
      "GitHub config: gh's default (no GH_CONFIG_DIR carried)",
    );
  });

  it("prints machine-readable status through the tend dispatcher", async () => {
    const output = captureLog();
    const { deps, calls } = fakeDeps(false, false);
    await handleTendCommand("schedule", ["status", "--json"], {
      schedule: deps,
    });
    expect(calls.map(([action]) => action)).toEqual(["status"]);
    expect(JSON.parse(output())).toMatchObject({
      label: "com.jerred.toolkit-tend",
      plistPath: PLIST,
      installed: false,
      loaded: false,
      dailyAt: "04:30",
      ghConfigDir: null,
      logs: { stdout: `${HOME}/.toolkit/tend/logs/launchd.stdout.log` },
    });
  });

  it("does not touch launchd when the platform is unsupported", async () => {
    const { deps, calls } = fakeDeps();
    await expect(
      handleTendScheduleCommand(["install"], {
        ...deps,
        assertSupported: (action) => {
          throw new Error(`${action} is not available on this platform.`);
        },
      }),
    ).rejects.toThrow(
      "toolkit tend schedule install is not available on this platform.",
    );
    expect(calls).toEqual([]);
  });

  it("rejects a missing, unknown, or over-specified action", async () => {
    const { deps, calls } = fakeDeps();
    await expect(handleTendScheduleCommand([], deps)).rejects.toThrow(
      "Usage: toolkit tend schedule install | uninstall | status",
    );
    await expect(handleTendScheduleCommand(["start"], deps)).rejects.toThrow(
      'Unknown tend schedule action "start"',
    );
    await expect(
      handleTendScheduleCommand(["install", "now"], deps),
    ).rejects.toThrow("Usage: toolkit tend schedule");
    expect(calls).toEqual([]);
  });
});

describe("formatTendReport keep reasons", () => {
  const report: TendRunReport = {
    timestamp: "2026-11-25T00:00:00.000Z",
    host: "macbook",
    mode: "dry-run",
    worktreeMinAgeMs: 3 * 86_400_000,
    disk: null,
    liveness: {
      hcAvailable: true,
      liveTerminalCount: 2,
      forumAvailable: true,
      activeHostNotices: [],
      holdSurfaces: {},
      warnings: [],
    },
    surfaces: [
      {
        surface: "worktrees",
        inspectedCount: 4,
        candidates: [],
        actions: [
          {
            status: "planned",
            candidate: {
              id: "worktree:/wt/idle",
              surface: "worktrees",
              kind: "detached-worktree",
              target: "/wt/idle",
              reason: "detached HEAD reachable from origin/main (idle 9d)",
            },
          },
        ],
        decisions: [
          {
            target: "/wt/idle",
            action: "remove",
            category: "idle",
            reason: "detached HEAD reachable from origin/main (idle 9d)",
          },
          {
            target: "/wt/a",
            action: "keep",
            category: "live Herdr terminal",
            reason: "live Herdr terminal: /wt/a",
          },
          {
            target: "/wt/b",
            action: "keep",
            category: "live Herdr terminal",
            reason: "live Herdr terminal: /wt/b/src",
          },
          {
            target: "/wt/c",
            action: "keep",
            category: "recent activity",
            reason: "last activity 1d ago (under 3d)",
          },
        ],
        warnings: [],
      },
    ],
    totals: { candidates: 1, removed: 0, failed: 0 },
    lastRun: null,
  };

  it("counts keeps per reason in every mode", () => {
    const summary = formatTendReport(report, { summaryOnly: true });
    expect(summary).toContain(
      "Kept (worktrees): 3\n  2    live Herdr terminal\n  1    recent activity",
    );
    expect(summary).not.toContain("Candidates:");
    expect(summary).not.toContain("[KEEP]");
    expect(formatTendReport(report)).toContain("Kept (worktrees): 3");
    expect(formatTendReport(report)).not.toContain("[KEEP]");
  });

  it("labels a removal that was called off as skipped", () => {
    const [surface] = report.surfaces;
    const [action] = surface?.actions ?? [];
    if (surface === undefined || action === undefined) {
      throw new Error("fixture has no action");
    }
    const skipped = formatTendReport({
      ...report,
      mode: "apply",
      surfaces: [
        {
          ...surface,
          actions: [
            {
              ...action,
              status: "skipped",
              detail: "live Herdr terminal appeared during the sweep: /wt/idle",
            },
          ],
        },
      ],
    });
    expect(skipped).toContain(
      "[SKIPPED] (worktrees/detached-worktree) /wt/idle — detached HEAD reachable from origin/main (idle 9d) — live Herdr terminal appeared during the sweep: /wt/idle",
    );
  });

  it("lists every kept worktree with its reason when verbose", () => {
    const verbose = formatTendReport(report, { verbose: true });
    expect(verbose).toContain("[WOULD REMOVE] (worktrees/detached-worktree)");
    expect(verbose).toContain(
      "Kept:\n  [KEEP] (worktrees) /wt/a — live Herdr terminal: /wt/a",
    );
    expect(verbose).toContain(
      "  [KEEP] (worktrees) /wt/c — last activity 1d ago (under 3d)",
    );
  });
});
