import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { MirrorIndex } from "#lib/brim/sync/mirror-index.ts";
import { writeClaudeFixture } from "./claude.ts";
import { writeCodexSessionUsageFixture } from "./codex.ts";

/**
 * A `brim sync` mirror of one remote machine ("studio") holding the same
 * Claude and Codex fixtures as the local sources. Returns the index path.
 */
export async function writeMirrorFixture(mirrorDir: string): Promise<string> {
  const machineRoot = path.join(mirrorDir, "studio");
  const claudeProjects = path.join(machineRoot, "claude/projects");
  const codexSessions = path.join(machineRoot, "codex/sessions");
  const claudeProject = path.join(claudeProjects, "-Users-me-repo");
  await mkdir(claudeProject, { recursive: true });
  await mkdir(codexSessions, { recursive: true });
  await writeClaudeFixture(claudeProject);
  await writeCodexSessionUsageFixture(codexSessions);
  await Bun.write(
    path.join(codexSessions, "2026/11/02/rollout-chat.jsonl"),
    [
      {
        timestamp: "2026-11-02T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "chat-thread",
          cwd: "/Users/me/repo",
          git: { branch: "mirror-plan" },
        },
      },
      {
        timestamp: "2026-11-02T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>x" }],
        },
      },
      {
        timestamp: "2026-11-02T10:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Plan the mirror rollout" }],
        },
      },
      {
        timestamp: "2026-11-02T10:00:02.500Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: '{"cmd":"ls mirror"}',
        },
      },
      {
        timestamp: "2026-11-02T10:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          output: "listed the mirror files",
        },
      },
      {
        timestamp: "2026-11-02T10:00:04.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Rollout planned" }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n")
      .concat("\n"),
  );
  const index: MirrorIndex = {
    schemaVersion: 1,
    generatedAt: "2026-11-02T00:00:00.000Z",
    machines: [
      {
        machineId: "studio",
        displayName: "Studio.local",
        platform: "darwin",
        manifestUpdatedAt: "2026-11-02T00:00:00.000Z",
        pulledAt: "2026-11-02T00:00:00.000Z",
        sinceDays: 30,
        rootDir: machineRoot,
        claudeProjectsDirs: [claudeProjects],
        codexSessionsDirs: [codexSessions],
        codexArchivedSessionsDirs: [],
        codexHistoryFiles: [],
      },
    ],
  };
  const indexPath = path.join(mirrorDir, "index.json");
  await Bun.write(indexPath, JSON.stringify(index));
  return indexPath;
}
