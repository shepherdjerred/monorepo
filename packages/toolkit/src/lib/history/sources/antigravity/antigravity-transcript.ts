import type { Database } from "bun:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  pathExists,
  readImmutableDatabase,
  rows,
} from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import type { HistoryMessage } from "@shepherdjerred/toolkit/lib/history/types.ts";

/**
 * Antigravity's brain transcript for one conversation, written next to the
 * conversation database's root as
 * `brain/<conversationId>/.system_generated/logs/transcript_full.jsonl`.
 * Token fields on its lines are deliberately ignored: usage comes from the
 * protobuf path, which also carries cache writes.
 */
const TranscriptLineSchema = z.object({
  step_index: z.number().int().optional(),
  type: z.string(),
  created_at: z.string().nullish(),
  content: z.string().nullish(),
  tool_calls: z.array(z.looseObject({ name: z.string().min(1) })).nullish(),
});

const SummaryRowSchema = z.object({
  title: z.string().nullable(),
  workspace_uris: z.string().nullable(),
});

/** The root a conversation database belongs to (`<root>/conversations/<id>.db`). */
export function antigravityRootOfDatabase(databasePath: string): string {
  const dir = path.dirname(databasePath);
  return path.basename(dir) === "conversations" ? path.dirname(dir) : dir;
}

export function antigravityTranscriptPath(
  root: string,
  conversationId: string,
): string {
  return path.join(
    root,
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl",
  );
}

export function antigravitySummariesPath(root: string): string {
  return path.join(root, "conversation_summaries.db");
}

function lineTime(
  raw: string | null | undefined,
  where: string,
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new TypeError(
      `Antigravity transcript has an invalid created_at: ${where}`,
    );
  }
  return new Date(parsed).toISOString();
}

type TranscriptEntry = z.infer<typeof TranscriptLineSchema>;

function transcriptEntryMessages(
  entry: TranscriptEntry,
  createdAt: string | null,
): HistoryMessage[] {
  const content = entry.content ?? "";
  switch (entry.type) {
    case "USER_INPUT":
      return content.length > 0
        ? [{ role: "user", text: content, createdAt }]
        : [];
    case "PLANNER_RESPONSE":
      return [
        ...(content.length > 0
          ? [{ role: "assistant" as const, text: content, createdAt }]
          : []),
        ...(entry.tool_calls ?? []).map((call) => ({
          role: "tool" as const,
          text: call.name,
          createdAt,
          toolName: call.name,
        })),
      ];
    case "GENERIC":
      return content.length > 0
        ? [{ role: "tool", text: content, createdAt }]
        : [];
    default:
      // SYSTEM_MESSAGE, CHECKPOINT and any other internal step type.
      return [];
  }
}

/**
 * A line that is not valid JSON, or does not match the expected envelope,
 * fails the scan (reporting only file and line, never content): a
 * partially-written or drifted transcript must not quietly shrink the
 * indexed conversation. Tool-call arguments are never indexed, since they
 * can embed credentials in arbitrary forms.
 */
export function parseAntigravityTranscript(
  raw: string,
  filePath: string,
): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    const where = `line ${String(index + 1)} in ${filePath}`;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`Malformed Antigravity transcript ${where}`, {
        cause: error,
      });
    }
    const parsed = TranscriptLineSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Unexpected Antigravity transcript shape at ${where}`);
    }
    messages.push(
      ...transcriptEntryMessages(
        parsed.data,
        lineTime(parsed.data.created_at, where),
      ),
    );
  }
  return messages;
}

/** The transcript's messages, or null when this conversation has none (normal for older ones). */
export async function readAntigravityTranscript(
  root: string,
  conversationId: string,
): Promise<HistoryMessage[] | null> {
  const filePath = antigravityTranscriptPath(root, conversationId);
  return (await pathExists(filePath))
    ? parseAntigravityTranscript(await Bun.file(filePath).text(), filePath)
    : null;
}

export type AntigravitySummary = {
  readonly title: string | null;
  readonly workspace: string | null;
};

function workspaceFromUris(
  raw: string | null,
  conversationId: string,
): string | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  let uris: unknown;
  try {
    uris = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `Antigravity summary has malformed workspace_uris for ${conversationId}`,
      { cause: error },
    );
  }
  const parsed = z.array(z.string()).safeParse(uris);
  if (!parsed.success) {
    throw new Error(
      `Antigravity summary has non-array workspace_uris for ${conversationId}`,
    );
  }
  const first = parsed.data[0];
  if (first === undefined || first.length === 0) {
    return null;
  }
  return first.startsWith("file://") ? fileURLToPath(first) : first;
}

/** Title and first workspace per conversation id; empty when the root has no summaries db. */
export async function readAntigravitySummaries(
  root: string,
): Promise<ReadonlyMap<string, AntigravitySummary>> {
  const filePath = antigravitySummariesPath(root);
  const summaries = new Map<string, AntigravitySummary>();
  if (!(await pathExists(filePath))) {
    return summaries;
  }
  const database: Database = await readImmutableDatabase(
    filePath,
    "Antigravity summaries",
  );
  try {
    for (const row of rows(
      database,
      "SELECT conversation_id, title, workspace_uris FROM conversation_summaries WHERE conversation_id IS NOT NULL",
      SummaryRowSchema.extend({ conversation_id: z.string() }),
    )) {
      summaries.set(row.conversation_id, {
        title: row.title === null || row.title.length === 0 ? null : row.title,
        workspace: workspaceFromUris(row.workspace_uris, row.conversation_id),
      });
    }
  } finally {
    database.close();
  }
  return summaries;
}
