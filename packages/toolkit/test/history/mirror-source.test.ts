import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex } from "#lib/history/index.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
  type HistoryPaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import type { HistorySource } from "#lib/history/types.ts";
import { writeMirrorFixture } from "./history-fixtures/mirror.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function mirrorHome(): Promise<{
  paths: HistoryPaths;
  home: string;
}> {
  const home = await mkdtemp(path.join(os.tmpdir(), "history-mirror-"));
  roots.push(home);
  const base = defaultHistoryPaths(home);
  const brimSyncMirrorIndex = await writeMirrorFixture(
    path.dirname(base.brimSyncMirrorIndex),
  );
  return { paths: { ...base, brimSyncMirrorIndex }, home };
}

function source(name: string): HistorySource {
  const found = createHistorySources().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no ${name} source`);
  return found;
}

describe("mirrored history sources", () => {
  test("label mirrored Claude sessions with their machine", async () => {
    const { paths } = await mirrorHome();
    const claudeMirror = source("claude-mirror");
    const result = await claudeMirror.scan(paths);
    expect(result.error).toBeNull();
    expect(result.available).toBe(true);
    const [document] = result.documents;
    expect(document?.source).toBe("claude-mirror");
    expect(document?.sourceId).toBe("studio/-Users-me-repo/session.jsonl");
    expect(document?.agent).toBe("Claude Code · Studio.local");
    expect(document?.machine).toBe("studio");
    expect(document?.messageCount).toBe(3);
    expect(document?.dialogueText).not.toContain("omit-claude-bookkeeping");
    expect(document?.workspace).toBe("/Users/me/repo");
    expect(document?.gitBranch).toBe("main");
    expect(document?.toolCalls).toEqual([
      { name: "shell", occurredAt: "2026-08-12T00:01:00.000Z" },
    ]);
    expect(document?.usageEvents.length).toBeGreaterThan(0);

    if (document === undefined) return;
    const read = await claudeMirror.read(paths, [
      {
        id: 1,
        source: "claude-mirror",
        sourceId: document.sourceId,
        title: document.title,
        path: document.path,
        workspace: document.workspace,
        agent: document.agent,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        excerpt: null,
      },
    ]);
    expect(read.error).toBeNull();
    expect(read.messages.get(document.sourceId)?.length).toBeGreaterThan(0);
  });

  test("index mirrored Codex sessions", async () => {
    const { paths } = await mirrorHome();
    const result = await source("codex-mirror").scan(paths);
    expect(result.error).toBeNull();
    expect(result.documents.length).toBeGreaterThan(0);
    for (const document of result.documents) {
      expect(document.sourceId.startsWith("studio/")).toBe(true);
      expect(document.agent).toContain("Studio.local");
    }
  });

  test("read mirrored Codex messages from the rollout itself", async () => {
    const { paths } = await mirrorHome();
    const result = await source("codex-mirror").scan(paths);
    const chat = result.documents.find(
      (document) =>
        document.sourceId === "studio/2026/11/02/rollout-chat.jsonl",
    );
    expect(chat?.title).toBe("Plan the mirror rollout");
    expect(chat?.workspace).toBe("/Users/me/repo");
    expect(chat?.runtimeId).toBe("chat-thread");
    expect(chat?.machine).toBe("studio");
    expect(chat?.gitBranch).toBe("mirror-plan");
    expect(chat?.toolCalls.map((call) => call.name)).toEqual(["exec_command"]);
    expect(chat?.dialogueText).toContain("Rollout planned");
    expect(chat?.dialogueText).not.toContain("environment_context");
    expect(chat?.toolOutputText).toContain("listed the mirror files");
  });

  test("are unavailable without a mirror index", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "history-mirror-"));
    roots.push(home);
    const result = await source("claude-mirror").scan(
      defaultHistoryPaths(home),
    );
    expect(result.available).toBe(false);
    expect(result.error).toBeNull();
  });

  test("never feed the usage export ledger", async () => {
    const { paths, home } = await mirrorHome();
    const result = await source("claude-mirror").scan(paths);
    const index = await HistoryIndex.open(defaultHistoryRuntimePaths(home));
    await index.ingest([result]);
    expect(index.usage({ since: null, source: null }).total.inputTokens).toBe(
      result.documents[0]?.usageEvents.reduce(
        (total, event) => total + event.inputTokens,
        0,
      ),
    );
    expect(index.usageFingerprints()).toEqual([]);
    index.close();
  });
});
