import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  agentBinDirectory,
  formatLaunch,
  LaunchError,
  previewLaunch,
  PROVIDER_COMMANDS,
  providerCommand,
  resolveLaunch,
  spawnLaunch,
  type Which,
} from "#lib/brim/launch.ts";
import { PROVIDER_ORDER } from "#lib/brim/rank.ts";

const BIN = "/home/agent/.local/share/agent-bin";

function stubWhich(installed: readonly string[]): Which {
  return (command) =>
    installed.includes(command) ? `${BIN}/${command}` : null;
}

function resolveUnknown(): unknown {
  return resolveLaunch("opencode", [], stubWhich(["opencode"]));
}

function resolveMissing(): unknown {
  return resolveLaunch("kimi", [], stubWhich([]));
}

describe("PROVIDER_COMMANDS", () => {
  it("maps each Brim provider to its agent wrapper command", () => {
    expect(PROVIDER_COMMANDS).toEqual({
      "claude-code": "claude",
      codex: "codex",
      antigravity: "agy",
      cursor: "cursor-agent",
      grok: "grok",
      kimi: "kimi",
      muse: "muse",
    });
  });

  it("covers every provider Brim ranks", () => {
    for (const provider of PROVIDER_ORDER) {
      expect(providerCommand(provider)).toBe(PROVIDER_COMMANDS[provider]);
    }
  });
});

describe("resolveLaunch", () => {
  it("resolves the command to its absolute PATH location", () => {
    const launch = resolveLaunch("antigravity", [], stubWhich(["agy"]));
    expect(launch).toEqual({
      provider: "antigravity",
      command: "agy",
      path: `${BIN}/agy`,
      args: [],
    });
  });

  it("fails loudly for an unknown provider", () => {
    expect(resolveUnknown).toThrow(LaunchError);
    expect(resolveUnknown).toThrow(
      'No agent command is mapped for provider "opencode"',
    );
  });

  it("fails loudly when the agent wrapper is missing", () => {
    expect(resolveMissing).toThrow(LaunchError);
    expect(resolveMissing).toThrow('No agent wrapper "kimi" (for kimi)');
  });
});

describe("agentBinDirectory", () => {
  it("is the fixed wrapper directory under the home folder", () => {
    expect(agentBinDirectory("/Users/x")).toBe(
      "/Users/x/.local/share/agent-bin",
    );
  });

  it("resolves wrappers there by default, whatever PATH says", () => {
    const resolved = previewLaunch("codex");
    const expected = path.join(agentBinDirectory(os.homedir()), "codex");
    expect(
      resolved.kind === "ready"
        ? resolved.line === expected
        : resolved.message.includes(agentBinDirectory()),
    ).toBe(true);
  });
});

describe("spawnLaunch", () => {
  it("passes extra args verbatim, without shell quoting", async () => {
    const spawned: (readonly string[])[] = [];
    const args = ["--model", "x", "it's here", "$HOME", "a b", "--", "-c"];
    const launch = resolveLaunch("codex", args, stubWhich(["codex"]));
    const exitCode = await spawnLaunch(launch, async (argv) => {
      spawned.push(argv);
      return 3;
    });
    expect(spawned).toEqual([[`${BIN}/codex`, ...args]]);
    expect(exitCode).toBe(3);
  });

  it("does not alias the caller's args array", () => {
    const args = ["one"];
    const launch = resolveLaunch("grok", args, stubWhich(["grok"]));
    args.push("two");
    expect(launch.args).toEqual(["one"]);
  });
});

describe("formatLaunch", () => {
  it("prints the absolute path and display-quotes unsafe args", () => {
    const launch = resolveLaunch(
      "claude-code",
      ["--resume", "it's here", "plain/path.ts"],
      stubWhich(["claude"]),
    );
    expect(formatLaunch(launch)).toBe(
      String.raw`${BIN}/claude --resume 'it'\''s here' plain/path.ts`,
    );
  });
});

describe("previewLaunch", () => {
  it("previews the command line when the command is installed", () => {
    expect(previewLaunch("muse", stubWhich(["muse"]))).toEqual({
      kind: "ready",
      line: `${BIN}/muse`,
    });
  });

  it("explains why a provider cannot launch", () => {
    expect(previewLaunch("cursor", stubWhich([]))).toEqual({
      kind: "unavailable",
      message: expect.stringContaining(
        'No agent wrapper "cursor-agent" (for cursor)',
      ),
    });
  });
});
