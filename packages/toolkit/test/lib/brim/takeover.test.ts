import { mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COCOA_EPOCH_OFFSET_SECONDS } from "#lib/brim/cache.ts";
import type { Which } from "#lib/brim/launch.ts";
import { excludeProviders, rankSnapshots } from "#lib/brim/rank.ts";
import { TakeoverError } from "#lib/brim/takeover/errors.ts";
import {
  buildTakeoverPrompt,
  prepareTakeover,
  renderHandoffMarkdown,
} from "#lib/brim/takeover/handoff.ts";
import {
  locateHerdrTerminal,
  replaceHerdrTerminal,
  resolveTakeoverLaunch,
  spawnTakeoverLaunch,
} from "#lib/brim/takeover/launch.ts";
import {
  BRIM_PROVIDER_IDS,
  historySourceForProvider,
  providerForHistorySource,
  requireBrimProvider,
  resolveBrimProvider,
  takeoverDisplayName,
} from "#lib/brim/takeover/providers.ts";
import { resolveTakeoverSession } from "#lib/brim/takeover/resolve.ts";
import {
  inspectTerminal,
  parseHcTerminalJson,
} from "#lib/brim/takeover/terminal.ts";
import { HistoryIndex } from "#lib/history/index.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
} from "#lib/history/paths.ts";
import {
  makeHistoryDocument,
  openingPromptHash,
} from "#lib/history/query/messages.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistorySource,
  HistorySourceName,
} from "#lib/history/types.ts";

const BIN = "/home/agent/.local/share/agent-bin";
const NOW_MS = Date.UTC(2026, 10, 15, 21, 50, 0);
const NOW_COCOA = NOW_MS / 1000 - COCOA_EPOCH_OFFSET_SECONDS;

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brim-takeover-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function stubWhich(
  installed: readonly string[] = [
    "claude",
    "codex",
    "agy",
    "cursor-agent",
    "grok",
    "kimi",
    "muse",
  ],
): Which {
  return (cmd) => (installed.includes(cmd) ? `${BIN}/${cmd}` : null);
}

function makeFakeSource(
  name: HistorySourceName,
  docs: readonly {
    readonly doc: HistoryDocument;
    readonly messages: readonly HistoryMessage[];
  }[],
  counter?: { scans: number },
): HistorySource {
  const byId = new Map(docs.map((item) => [item.doc.sourceId, item.messages]));
  return {
    name,
    label: name,
    scan: () => {
      if (counter !== undefined) {
        counter.scans += 1;
      }
      return Promise.resolve({
        source: name,
        available: true,
        documents: docs.map((item) => item.doc),
        fingerprint: "fp",
        error: null,
        complete: true,
        sourceIds: docs.map((item) => item.doc.sourceId),
      });
    },
    read: (_paths, records) => {
      const messages = new Map<string, readonly HistoryMessage[]>();
      const missing: string[] = [];
      for (const record of records) {
        const found = byId.get(record.sourceId);
        if (found === undefined) {
          missing.push(record.sourceId);
        } else {
          messages.set(record.sourceId, found);
        }
      }
      return Promise.resolve({
        source: name,
        messages,
        missingSourceIds: missing,
        error: null,
      });
    },
  };
}

function buildDoc(options: {
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly title: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly path: string;
  readonly gitBranch?: string | null;
  readonly messages: readonly HistoryMessage[];
}): {
  readonly doc: HistoryDocument;
  readonly messages: readonly HistoryMessage[];
} {
  return {
    doc: makeHistoryDocument(
      {
        source: options.source,
        sourceId: options.sourceId,
        title: options.title,
        path: options.path,
        workspace: options.workspace,
        gitBranch: options.gitBranch ?? "feat/takeover",
        agent: options.source,
        createdAt: options.createdAt,
        updatedAt: options.updatedAt,
        runtimeId: null,
        usageEvents: [],
      },
      options.messages,
    ),
    messages: options.messages,
  };
}

describe("providers & excludeProviders", () => {
  it("maps every Brim provider ID, history source, mirror source, and CLI alias", () => {
    expect(BRIM_PROVIDER_IDS).toEqual([
      "claude-code",
      "codex",
      "antigravity",
      "cursor",
      "grok",
      "kimi",
      "muse",
    ]);
    expect(historySourceForProvider("claude-code")).toBe("claude");
    expect(takeoverDisplayName("claude-code")).toBe("Claude Code");
    expect(takeoverDisplayName("antigravity")).toBe("Antigravity");
    expect(takeoverDisplayName("kimi")).toBe("Kimi");
    expect(takeoverDisplayName("muse")).toBe("Muse");

    expect(providerForHistorySource("claude")).toBe("claude-code");
    expect(providerForHistorySource("claude-mirror")).toBe("claude-code");
    expect(providerForHistorySource("antigravity-mirror")).toBe("antigravity");
    expect(providerForHistorySource("conductor")).toBeNull();

    const aliases: readonly [string, string][] = [
      ["claude", "claude-code"],
      ["Claude-Code", "claude-code"],
      ["codex", "codex"],
      ["agy", "antigravity"],
      ["gemini", "antigravity"],
      ["antigravity", "antigravity"],
      ["cursor", "cursor"],
      ["cursor-agent", "cursor"],
      ["agent", "cursor"],
      ["grok", "grok"],
      ["grok-build", "grok"],
      ["kimi", "kimi"],
      ["muse", "muse"],
    ];
    for (const [alias, expected] of aliases) {
      expect(resolveBrimProvider(alias)).toBe(expected);
    }
    expect(resolveBrimProvider("fish")).toBeNull();
    expect(() => requireBrimProvider("unknown")).toThrow(TakeoverError);
  });

  it("moves excluded providers from ranked and other into unavailable", () => {
    const base = rankSnapshots(
      [
        {
          provider: "claude-code",
          accountLabel: null,
          windows: [
            {
              id: "Weekly",
              label: "Weekly",
              kind: { weekly: {} },
              usedPercent: 15,
              resetAt: NOW_COCOA + 86_400,
              sourceTimestamp: NOW_COCOA,
            },
          ],
          resets: [],
          resetErrorMessage: null,
          notes: [],
          sourceTimestamp: NOW_COCOA,
          freshness: { current: {} },
        },
        {
          provider: "codex",
          accountLabel: null,
          windows: [
            {
              id: "Weekly",
              label: "Weekly",
              kind: { weekly: {} },
              usedPercent: 30,
              resetAt: NOW_COCOA + 86_400,
              sourceTimestamp: NOW_COCOA,
            },
          ],
          resets: [],
          resetErrorMessage: null,
          notes: [],
          sourceTimestamp: NOW_COCOA,
          freshness: { current: {} },
        },
        {
          provider: "kimi",
          accountLabel: null,
          windows: [
            {
              id: "Shared",
              label: "Shared usage",
              kind: { providerDefined: {} },
              usedPercent: 20,
              resetAt: NOW_COCOA + 86_400,
              sourceTimestamp: NOW_COCOA,
            },
          ],
          resets: [],
          resetErrorMessage: null,
          notes: [],
          sourceTimestamp: NOW_COCOA,
          freshness: { current: {} },
        },
      ],
      { nowMs: NOW_MS },
    );

    const filtered = excludeProviders(base, ["claude", "kimi"]);
    expect(filtered.ranked.map((entry) => entry.provider)).toEqual(["codex"]);
    expect(filtered.other).toEqual([]);
    expect(
      filtered.unavailable.map((entry) => [entry.provider, entry.reason]),
    ).toEqual([
      ["claude-code", "excluded"],
      ["kimi", "excluded"],
    ]);
  });
});

describe("terminal inspection (hc get --json)", () => {
  it("extracts status.app, foreground cwd, labels, and initial prompt after --", () => {
    const parsed = parseHcTerminalJson(
      JSON.stringify({
        address: "t42",
        cwd: "/Users/test/old",
        created_ms: 1_794_110_517_895,
        argv: ["/opt/homebrew/bin/fish", "-l"],
        foreground: {
          cwd: "/Users/test/repo",
          argv: [
            "/Users/test/.local/share/agent-bin/claude",
            "--name",
            "auth",
            "--",
            "Fix the login token bug",
          ],
          name: "claude",
          pid: 1234,
        },
        labels: {
          "herdr.space": "sp1",
          "herdr.tab": "tb2",
          where: "repo / 1",
        },
        status: { app: "claude-code", state: "idle" },
      }),
    );
    expect(parsed).toEqual({
      address: "t42",
      cwd: "/Users/test/repo",
      createdMs: 1_794_110_517_895,
      space: "sp1",
      tab: "tb2",
      where: "repo / 1",
      statusState: "idle",
      sourceProvider: "claude-code",
      initialPrompt: "Fix the login token bug",
      promptHash: openingPromptHash("Fix the login token bug"),
    });
  });

  it("falls back to brim --provider and wrapper basenames and parses -i prompts", async () => {
    const fromBrim = parseHcTerminalJson(
      JSON.stringify({
        address: "t7",
        cwd: "/Users/test/repo",
        created_ms: 1000,
        argv: ["brim", "--provider", "codex", "--", "--", "Refactor parser"],
        foreground: null,
        labels: {},
        status: null,
      }),
    );
    expect(fromBrim.sourceProvider).toBe("codex");
    expect(fromBrim.initialPrompt).toBe("Refactor parser");

    const fromAgy = await inspectTerminal("t8", () =>
      Promise.resolve({
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          address: "t8",
          cwd: "/Users/test/repo",
          created_ms: 2000,
          argv: [
            "/Users/test/.local/share/agent-bin/agy",
            "-i",
            "Ship feature",
          ],
          status: { app: "fish", state: "working" },
        }),
      }),
    );
    expect(fromAgy.sourceProvider).toBe("antigravity");
    expect(fromAgy.initialPrompt).toBe("Ship feature");
    expect(fromAgy.promptHash).toBe(openingPromptHash("Ship feature"));

    const fromFishWrapper = parseHcTerminalJson(
      JSON.stringify({
        address: "t6s",
        cwd: "/Users/test/repo",
        created_ms: 3000,
        argv: [
          "/opt/homebrew/bin/fish",
          "-lic",
          "command $argv[2..]; exec $argv[1] -li",
          "/opt/homebrew/bin/fish",
          "brim",
          "--provider",
          "antigravity",
          "--",
          "-i",
          "Add takeover feature",
        ],
        foreground: {
          argv: ["/opt/homebrew/bin/fish", "-li"],
          cwd: "/Users/test/repo",
          name: "fish",
          pid: 9999,
        },
        labels: {},
        status: null,
      }),
    );
    expect(fromFishWrapper.sourceProvider).toBe("antigravity");
    expect(fromFishWrapper.initialPrompt).toBe("Add takeover feature");
    expect(fromFishWrapper.promptHash).toBe(
      openingPromptHash("Add takeover feature"),
    );
  });
});

describe("session resolution", () => {
  it("resolves by exact history ID (including *-mirror) and rejects non-Brim sources", async () => {
    const root = await makeTempDir();
    const historyPaths = defaultHistoryPaths(root);
    const runtimePaths = defaultHistoryRuntimePaths(root);

    const mirrorItem = buildDoc({
      source: "claude-mirror",
      sourceId: "remote-1",
      title: "Mirrored Claude work",
      workspace: path.join(root, "ws"),
      createdAt: "2026-11-15T20:00:00.000Z",
      updatedAt: "2026-11-15T20:10:00.000Z",
      path: path.join(root, "mirror.jsonl"),
      gitBranch: "main",
      messages: [
        {
          role: "user",
          text: "Hello from remote",
          createdAt: "2026-11-15T20:00:00.000Z",
        },
      ],
    });
    const conductorItem = buildDoc({
      source: "conductor",
      sourceId: "cond-1",
      title: "Conductor session",
      workspace: path.join(root, "ws"),
      createdAt: "2026-11-15T20:00:00.000Z",
      updatedAt: "2026-11-15T20:05:00.000Z",
      path: path.join(root, "conductor.db"),
      messages: [{ role: "user", text: "Conductor prompt", createdAt: null }],
    });

    const sources = [
      makeFakeSource("claude-mirror", [mirrorItem]),
      makeFakeSource("conductor", [conductorItem]),
    ];
    const index = await HistoryIndex.open(runtimePaths);
    await index.ingest(
      await Promise.all(
        sources.map((s) => s.scan(historyPaths, { force: true })),
      ),
      true,
    );
    const sessions = index.sessions({
      since: null,
      source: null,
      machine: null,
      workspace: null,
      limit: 10,
      offset: 0,
    }).sessions;
    index.close();

    const mirrorRow = sessions.find((s) => s.source === "claude-mirror");
    const conductorRow = sessions.find((s) => s.source === "conductor");
    expect(mirrorRow).toBeDefined();
    expect(conductorRow).toBeDefined();

    const resolved = await resolveTakeoverSession({
      historyId: mirrorRow?.id ?? 0,
      historyPaths,
      runtimePaths,
      sources,
    });
    expect(resolved.sourceProvider).toBe("claude-code");
    expect(resolved.historySource).toBe("claude-mirror");
    expect(resolved.gitBranch).toBe("main");
    expect(resolved.messages).toHaveLength(1);

    await expect(
      resolveTakeoverSession({
        historyId: conductorRow?.id ?? 0,
        historyPaths,
        runtimePaths,
        sources,
      }),
    ).rejects.toThrow(/not a Brim subscription provider/u);
  });

  it("ranks workspace sessions by openingPromptHash, then createdMs proximity, and resolves symlinks + fresh unindexed sessions", async () => {
    const root = await makeTempDir();
    const realWs = path.join(root, "real-workspace");
    const linkWs = path.join(root, "link-workspace");
    await mkdir(realWs, { recursive: true });
    await symlink(realWs, linkWs);

    const historyPaths = defaultHistoryPaths(root);
    const runtimePaths = defaultHistoryRuntimePaths(root);

    const olderPromptMatch = buildDoc({
      source: "claude",
      sourceId: "s-prompt",
      title: "Prompt-matched session",
      workspace: realWs,
      createdAt: "2026-11-15T20:00:00.000Z",
      updatedAt: "2026-11-15T20:05:00.000Z",
      path: path.join(root, "s-prompt.jsonl"),
      messages: [
        {
          role: "user",
          text: "Target opening prompt",
          createdAt: "2026-11-15T20:00:00.000Z",
        },
      ],
    });
    const newerOtherSession = buildDoc({
      source: "claude",
      sourceId: "s-newer",
      title: "Newer unrelated session",
      workspace: realWs,
      createdAt: "2026-11-15T21:00:00.000Z",
      updatedAt: "2026-11-15T21:30:00.000Z",
      path: path.join(root, "s-newer.jsonl"),
      messages: [
        {
          role: "user",
          text: "Different prompt",
          createdAt: "2026-11-15T21:00:00.000Z",
        },
      ],
    });

    const claudeScans = { scans: 0 };
    const codexScans = { scans: 0 };
    const indexedSource = makeFakeSource(
      "claude",
      [olderPromptMatch, newerOtherSession],
      claudeScans,
    );
    const index = await HistoryIndex.open(runtimePaths);
    await index.ingest(
      [await indexedSource.scan(historyPaths, { force: true })],
      true,
    );
    index.close();
    claudeScans.scans = 0;

    // 1. Symlinked cwd + openingPromptHash wins over newer updatedAt without rescanning
    const byHash = await resolveTakeoverSession({
      cwd: linkWs,
      fromProvider: "claude-code",
      terminal: {
        address: "t1",
        cwd: linkWs,
        createdMs: Date.parse("2026-11-15T20:00:02.000Z"),
        space: null,
        tab: null,
        where: null,
        statusState: "idle",
        sourceProvider: "claude-code",
        initialPrompt: "Target opening prompt",
        promptHash: openingPromptHash("Target opening prompt"),
      },
      historyPaths,
      runtimePaths,
      sources: [indexedSource],
    });
    expect(byHash.sourceId).toBe("s-prompt");
    expect(claudeScans.scans).toBe(0);

    // 2. Fresh session started AFTER last daemon scan triggers single-source fallback scan
    const freshUnindexed = buildDoc({
      source: "claude",
      sourceId: "s-fresh",
      title: "Brand new unindexed session",
      workspace: linkWs,
      createdAt: "2026-11-15T21:55:02.000Z",
      updatedAt: "2026-11-15T21:55:10.000Z",
      path: path.join(root, "s-fresh.jsonl"),
      messages: [
        {
          role: "user",
          text: "Brand new task",
          createdAt: "2026-11-15T21:55:02.000Z",
        },
      ],
    });
    const liveClaudeSource = makeFakeSource(
      "claude",
      [olderPromptMatch, newerOtherSession, freshUnindexed],
      claudeScans,
    );
    const liveCodexSource = makeFakeSource("codex", [], codexScans);

    const byFreshScan = await resolveTakeoverSession({
      cwd: realWs,
      terminal: {
        address: "t2",
        cwd: realWs,
        createdMs: Date.parse("2026-11-15T21:55:00.000Z"),
        space: null,
        tab: null,
        where: null,
        statusState: "working",
        sourceProvider: "claude-code",
        initialPrompt: null,
        promptHash: null,
      },
      historyPaths,
      runtimePaths,
      sources: [liveClaudeSource, liveCodexSource],
    });
    expect(byFreshScan.sourceId).toBe("s-fresh");
    expect(byFreshScan.historyId).toBeNull();
    expect(claudeScans.scans).toBe(1);
    expect(codexScans.scans).toBe(0);
  });
});

describe("handoff Markdown & prompt generation", () => {
  it("collapses consecutive tool calls, bounds middle turns, includes --note, and sets 0600 permissions", async () => {
    const outDir = path.join(await makeTempDir(), "takeovers");
    const messages: HistoryMessage[] = [
      {
        role: "user",
        text: "Opening instructions: implement brim takeover",
        createdAt: "2026-11-15T21:00:00Z",
      },
      { role: "tool", toolName: "Bash", text: "git status", createdAt: null },
      { role: "tool", text: "huge bash stdout ".repeat(200), createdAt: null },
      { role: "tool", toolName: "Read", text: "a.ts", createdAt: null },
      { role: "tool", text: "file a", createdAt: null },
      { role: "tool", toolName: "Read", text: "b.ts", createdAt: null },
      { role: "tool", toolName: "Read", text: "c.ts", createdAt: null },
      { role: "tool", toolName: "Edit", text: "a.ts", createdAt: null },
      {
        role: "assistant",
        text: `Middle turn details ${"x".repeat(600)}`,
        createdAt: "2026-11-15T21:05:00Z",
      },
      {
        role: "user",
        text: `Follow-up middle ${"y".repeat(600)}`,
        createdAt: "2026-11-15T21:10:00Z",
      },
      {
        role: "assistant",
        text: "Final recent state: tests ready to run.",
        createdAt: "2026-11-15T21:15:00Z",
      },
    ];

    const session = {
      sourceProvider: "claude-code" as const,
      sourceDisplayName: "Claude Code",
      historySource: "claude" as const,
      historyId: 77,
      sourceId: "proj/abc.jsonl",
      title: "Implement Brim Takeover",
      cwd: "/Users/test/repo",
      gitBranch: "cross-provider-takeover",
      createdAt: "2026-11-15T21:00:00Z",
      updatedAt: "2026-11-15T21:15:00Z",
      rawTranscriptPath: "/Users/test/.claude/projects/proj/abc.jsonl",
      messages,
    };

    const fullMd = renderHandoffMarkdown(session, {
      note: "Finish test suite",
    });
    expect(fullMd).toContain("_Tools used: Bash, Read (x3), Edit_");
    expect(fullMd).not.toContain("huge bash stdout");
    expect(fullMd).toContain("## User Handoff Note\n\nFinish test suite");

    const bounded = await prepareTakeover(session, {
      outputDir: outDir,
      note: "Finish test suite",
      now: new Date("2026-11-15T21:51:57Z"),
      maxDialogueChars: 500,
    });
    expect(path.basename(bounded.handoffPath)).toBe(
      "20261115T215157Z-claude-implement-brim-takeover.md",
    );
    const written = await Bun.file(bounded.handoffPath).text();
    expect(written).toContain("Opening instructions: implement brim takeover");
    expect(written).toContain(
      "middle messages omitted for length; see raw transcript at /Users/test/.claude/projects/proj/abc.jsonl if needed",
    );
    expect(written).toContain("Final recent state: tests ready to run.");

    const fileStat = await stat(bounded.handoffPath);
    const dirStat = await stat(outDir);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);

    const prompt = buildTakeoverPrompt({
      sourceDisplayName: "Claude Code",
      title: "Implement Brim Takeover",
      handoffPath: bounded.handoffPath,
      rawTranscriptPath: session.rawTranscriptPath,
      note: "Finish test suite",
    });
    expect(prompt).toContain(
      'You are taking over an interrupted Claude Code session ("Implement Brim Takeover") after a usage limit.',
    );
    expect(prompt).toContain("User note for this handoff:\nFinish test suite");
  });
});

describe("target launch & Herdr replacement", () => {
  const preparedSample = {
    title: "Fix flaky payment webhook",
    cwd: "/Users/test/repo",
    prompt: "Take over this session.",
  };

  it("constructs per-provider wrapper arguments and handles Kimi clipboard mode", async () => {
    const claude = resolveTakeoverLaunch(
      "claude-code",
      preparedSample,
      ["--model", "sonnet"],
      stubWhich(),
    );
    expect(claude.args).toEqual([
      "--model",
      "sonnet",
      "--name",
      "Fix flaky payment webhook",
      "--",
      "Take over this session.",
    ]);
    expect(claude.promptDelivery).toBe("arg");

    const claudeCustomName = resolveTakeoverLaunch(
      "claude-code",
      preparedSample,
      ["--name", "Custom"],
      stubWhich(),
    );
    expect(claudeCustomName.args).toEqual([
      "--name",
      "Custom",
      "--",
      "Take over this session.",
    ]);

    for (const provider of ["codex", "cursor", "grok", "muse"] as const) {
      const resolved = resolveTakeoverLaunch(
        provider,
        preparedSample,
        ["--flag"],
        stubWhich(),
      );
      expect(resolved.args).toEqual([
        "--flag",
        "--",
        "Take over this session.",
      ]);
      expect(resolved.promptDelivery).toBe("arg");
    }

    const agy = resolveTakeoverLaunch(
      "antigravity",
      preparedSample,
      [],
      stubWhich(),
    );
    expect(agy.args).toEqual(["-i", "Take over this session."]);

    const kimi = resolveTakeoverLaunch(
      "kimi",
      preparedSample,
      ["--yolo"],
      stubWhich(),
    );
    expect(kimi.args).toEqual(["--yolo"]);
    expect(kimi.promptDelivery).toBe("clipboard");

    const clipboardText: string[] = [];
    const stderrLines: string[] = [];
    const spawned: [readonly string[], string][] = [];
    const code = await spawnTakeoverLaunch(kimi, {
      handoffPath: "/tmp/handoff.md",
      copyToClipboard: (text) => {
        clipboardText.push(text);
        return Promise.resolve(true);
      },
      stderr: (line) => {
        stderrLines.push(line);
      },
      spawn: (argv, cwd) => {
        spawned.push([argv, cwd]);
        return Promise.resolve(0);
      },
    });
    expect(code).toBe(0);
    expect(clipboardText).toEqual(["Take over this session."]);
    expect(stderrLines[0]).toContain(
      "copied the takeover prompt to the clipboard",
    );
    expect(spawned).toEqual([[[`${BIN}/kimi`, "--yolo"], "/Users/test/repo"]]);
  });
});

describe("Herdr tab & split-pane replacement", () => {
  const preparedSample = {
    title: "Fix flaky payment webhook",
    cwd: "/Users/test/repo",
    prompt: "Take over this session.",
  };

  it("creates the new Herdr tab or split pane BEFORE closing the old one and delivers Kimi via hc send", async () => {
    const singleTabLs = JSON.stringify({
      spaces: [
        {
          id: "sp1",
          name: "monorepo",
          tabs: [
            {
              id: "tb-first",
              name: "1",
              terminals: [{ terminal: "t1", pane: "p1" }],
            },
            {
              id: "tb-target",
              name: "Takeover feature",
              terminals: [{ terminal: "t2", pane: "p2" }],
            },
          ],
        },
      ],
    });
    expect(locateHerdrTerminal(singleTabLs, "t2")).toEqual({
      terminal: "t2",
      space: "sp1",
      tab: "tb-target",
      pane: "p2",
      tabIndex: 2,
      tabName: "Takeover feature",
      tabNamed: true,
      paneCount: 1,
    });

    const events: string[] = [];
    let kimiReadyPolls = 0;
    const kimiLaunch = resolveTakeoverLaunch(
      "kimi",
      preparedSample,
      [],
      stubWhich(),
    );
    const tabRes = await replaceHerdrTerminal({
      terminalAddress: "t2",
      launch: kimiLaunch,
      prepared: preparedSample,
      currentTerminalId: "t2",
      sleep: () => Promise.resolve(),
      runHerdrApp: (args) => {
        events.push(`herdr:${args.join(" ")}`);
        if (args[0] === "ls") {
          return Promise.resolve({
            stdout: singleTabLs,
            stderr: "",
            exitCode: 0,
          });
        }
        if (args[1] === "tab.new") {
          return Promise.resolve({
            stdout: JSON.stringify({ tab: "tb-new", terminal: "t99" }),
            stderr: "",
            exitCode: 0,
          });
        }
        return Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 });
      },
      detachHerdrApp: (args) => {
        events.push(`detach:${args.join(" ")}`);
        return Promise.resolve();
      },
      runHc: (args) => {
        events.push(`hc:${args.join(" ")}`);
        if (args[0] === "get") {
          kimiReadyPolls += 1;
          const state = kimiReadyPolls >= 2 ? "idle" : null;
          return Promise.resolve({
            stdout: JSON.stringify({
              address: "t99",
              status: state === null ? null : { app: "kimi", state },
            }),
            stderr: "",
            exitCode: 0,
          });
        }
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });

    expect(tabRes.mode).toBe("tab");
    expect(tabRes.detachedClose).toBe(true);
    expect(events).toEqual([
      "herdr:ls",
      `herdr:do tab.new ${JSON.stringify({ space: "sp1", folder: "/Users/test/repo", name: "Takeover feature", argv: [`${BIN}/kimi`] })}`,
      `herdr:do tab.move ${JSON.stringify({ id: "tb-new", index: 2 })}`,
      "hc:get t99 --json",
      "hc:get t99 --json",
      "hc:send t99 Take over this session.",
      `detach:do tab.close ${JSON.stringify({ id: "tb-target", confirmed: true })}`,
    ]);

    // Split-pane tab: pane.split BEFORE pane.close
    const splitEvents: string[] = [];
    const splitLs = JSON.stringify({
      spaces: [
        {
          id: "sp1",
          name: "monorepo",
          tabs: [
            {
              id: "tb-split",
              name: "1",
              terminals: [
                { terminal: "t10", pane: "p10" },
                { terminal: "t11", pane: "p11" },
              ],
            },
          ],
        },
      ],
    });
    const codexLaunch = resolveTakeoverLaunch(
      "codex",
      preparedSample,
      [],
      stubWhich(),
    );
    await replaceHerdrTerminal({
      terminalAddress: "t10",
      launch: codexLaunch,
      prepared: preparedSample,
      currentTerminalId: "t999",
      runHerdrApp: (args) => {
        splitEvents.push(args.join(" "));
        if (args[0] === "ls") {
          return Promise.resolve({ stdout: splitLs, stderr: "", exitCode: 0 });
        }
        return Promise.resolve({
          stdout: JSON.stringify({ pane: "p-new", terminal: "t12" }),
          stderr: "",
          exitCode: 0,
        });
      },
    });
    expect(splitEvents).toEqual([
      "ls",
      `do pane.split ${JSON.stringify({ direction: "right", pane: "p10", argv: [`${BIN}/codex`, "--", "Take over this session."] })}`,
      `do pane.close ${JSON.stringify({ pane: "p10" })}`,
    ]);
  });
});
