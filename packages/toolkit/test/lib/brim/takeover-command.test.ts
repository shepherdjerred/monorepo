import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { handleTakeoverCommand } from "#commands/brim/takeover.ts";
import { COCOA_EPOCH_OFFSET_SECONDS } from "#lib/brim/cache.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
} from "#lib/history/paths.ts";
import { makeHistoryDocument } from "#lib/history/query/messages.ts";
import type {
  HistoryMessage,
  HistorySource,
  HistorySourceName,
} from "#lib/history/types.ts";

const PreparedTakeoverSchema = z.strictObject({
  sourceProvider: z.string(),
  sourceDisplayName: z.string(),
  historySource: z.string(),
  historyId: z.number().nullable(),
  sourceId: z.string(),
  title: z.string(),
  cwd: z.string(),
  gitBranch: z.string().nullable(),
  rawTranscriptPath: z.string(),
  handoffPath: z.string(),
  messageCount: z.number(),
  prompt: z.string(),
  terminal: z
    .strictObject({
      address: z.string(),
      space: z.string().nullable(),
      tab: z.string().nullable(),
    })
    .nullable(),
});

const BIN = "/home/agent/.local/share/agent-bin";
const NOW_MS = Date.UTC(2026, 10, 15, 21, 51, 57);
const NOW_COCOA = NOW_MS / 1000 - COCOA_EPOCH_OFFSET_SECONDS;

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brim-takeover-cli-"));
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

function singleDocSource(options: {
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly title: string;
  readonly filePath: string;
  readonly workspace: string;
  readonly gitBranch: string | null;
  readonly messages: readonly HistoryMessage[];
}): HistorySource {
  const doc = makeHistoryDocument(
    {
      source: options.source,
      sourceId: options.sourceId,
      title: options.title,
      path: options.filePath,
      workspace: options.workspace,
      gitBranch: options.gitBranch,
      agent: options.source,
      createdAt: "2026-11-15T21:40:00.000Z",
      updatedAt: "2026-11-15T21:50:00.000Z",
      runtimeId: null,
      usageEvents: [],
    },
    options.messages,
  );
  return {
    name: options.source,
    label: options.source,
    scan: () =>
      Promise.resolve({
        source: options.source,
        available: true,
        documents: [doc],
        fingerprint: "fp",
        error: null,
        complete: true,
        sourceIds: [doc.sourceId],
      }),
    read: () =>
      Promise.resolve({
        source: options.source,
        messages: new Map([[doc.sourceId, options.messages]]),
        missingSourceIds: [],
        error: null,
      }),
  };
}

describe("handleTakeoverCommand --prepare --json", () => {
  it("emits the exact PreparedTakeover JSON contract", async () => {
    const root = await makeTempDir();
    const ws = path.join(root, "repo");
    const outDir = path.join(root, "takeovers");
    const rawPath = path.join(root, "agy.pb");
    const agySource = singleDocSource({
      source: "antigravity",
      sourceId: "conv-123",
      title: "Cross-provider takeover",
      filePath: rawPath,
      workspace: ws,
      gitBranch: "cross-provider-takeover",
      messages: [
        {
          role: "user",
          text: "Build takeover feature",
          createdAt: "2026-11-15T21:40:00.000Z",
        },
        {
          role: "assistant",
          text: "Started implementation",
          createdAt: "2026-11-15T21:50:00.000Z",
        },
      ],
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await handleTakeoverCommand(
      [
        "--prepare",
        "--json",
        "--terminal",
        "t55",
        "--note",
        "Continue from toolkit tests",
        "--output-dir",
        outDir,
      ],
      [],
      {
        env: {},
        isTTY: false,
        now: () => new Date(NOW_MS),
        historyPaths: defaultHistoryPaths(root),
        runtimePaths: defaultHistoryRuntimePaths(root),
        sources: [agySource],
        loadSnapshots: () => Promise.resolve([]),
        runHc: () =>
          Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              address: "t55",
              cwd: ws,
              created_ms: Date.parse("2026-11-15T21:39:58.000Z"),
              labels: { "herdr.space": "sp9", "herdr.tab": "tb4" },
              status: { app: "antigravity", state: "idle" },
            }),
          }),
        pickProvider: () => Promise.resolve(null),
        stdout: (line) => {
          stdout.push(line);
        },
        stderr: (line) => {
          stderr.push(line);
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    const parsed = PreparedTakeoverSchema.parse(JSON.parse(stdout[0] ?? "{}"));
    expect(parsed).toEqual({
      sourceProvider: "antigravity",
      sourceDisplayName: "Antigravity",
      historySource: "antigravity",
      historyId: null,
      sourceId: "conv-123",
      title: "Cross-provider takeover",
      cwd: ws,
      gitBranch: "cross-provider-takeover",
      rawTranscriptPath: rawPath,
      handoffPath: path.join(
        outDir,
        "20261115T215157Z-antigravity-cross-provider-takeover.md",
      ),
      messageCount: 2,
      prompt: expect.stringContaining(
        'You are taking over an interrupted Antigravity session ("Cross-provider takeover") after a usage limit.',
      ),
      terminal: {
        address: "t55",
        space: "sp9",
        tab: "tb4",
      },
    });
  });
});

describe("handleTakeoverCommand target selection & forwarding", () => {
  it("excludes the source provider automatically and forwards extra args after --", async () => {
    const root = await makeTempDir();
    const ws = path.join(root, "repo");
    const outDir = path.join(root, "takeovers");
    const claudeSource = singleDocSource({
      source: "claude",
      sourceId: "c-1",
      title: "Claude work",
      filePath: path.join(root, "c-1.jsonl"),
      workspace: ws,
      gitBranch: null,
      messages: [
        {
          role: "user",
          text: "Do work",
          createdAt: "2026-11-15T21:00:00.000Z",
        },
      ],
    });

    const spawned: [readonly string[], string][] = [];
    const exitCode = await handleTakeoverCommand(
      [
        "--cwd",
        ws,
        "--from",
        "claude",
        "--no-interactive",
        "--output-dir",
        outDir,
        "--",
        "--model",
        "gpt-5",
      ],
      [],
      {
        env: {},
        isTTY: false,
        now: () => new Date(NOW_MS),
        historyPaths: defaultHistoryPaths(root),
        runtimePaths: defaultHistoryRuntimePaths(root),
        sources: [claudeSource],
        which: (cmd) => `${BIN}/${cmd}`,
        loadSnapshots: () =>
          Promise.resolve([
            {
              provider: "claude-code",
              accountLabel: null,
              windows: [
                {
                  id: "Weekly",
                  label: "Weekly",
                  kind: { weekly: {} },
                  usedPercent: 1,
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
                  usedPercent: 25,
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
          ]),
        spawn: (argv, cwd) => {
          spawned.push([argv, cwd]);
          return Promise.resolve(0);
        },
        pickProvider: () => Promise.resolve(null),
        stdout: () => {
          // noop
        },
        stderr: () => {
          // noop
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[0].slice(0, 4)).toEqual([
      `${BIN}/codex`,
      "--model",
      "gpt-5",
      "--",
    ]);
    expect(spawned[0]?.[1]).toBe(ws);
  });
});
