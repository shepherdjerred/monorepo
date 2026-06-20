// Persistent memory for goal mode, scoped to ONE save (one Discord guild). Two
// surfaces, both living under the per-guild memory directory (driver points it
// at saves/<guildId>/goal-memory, so it persists on the same PVC as the flash
// save and goal-state.json):
//
//   MEMORY.md          — a single curated doc fed into EVERY goal prompt. The
//                        agent rewrites it at the end of a session (curated, not
//                        appended) so it stays small and high-signal.
//   sessions/<id>.md   — one immutable log per goal session. The agent writes a
//                        reflection ("what I did / what was hard / what I
//                        learned") before it finishes. Browsable via list/search
//                        /read so a later session can mine its predecessors.
//
// File I/O only — no goal lifecycle state. Callers stamp session metadata via
// buildSessionLogMeta (goal text, ids, timestamps) and pass the actual
// writes/reads through here.

import path from "node:path";
import { readdir } from "node:fs/promises";
import type { GoalState } from "./goal-types.ts";

const MEMORY_FILE = "MEMORY.md";
const SESSIONS_DIR = "sessions";

// Curated MEMORY.md is injected verbatim into the goal prompt, so cap it to keep
// the prompt budget bounded (~16k chars ≈ ~4k tokens). Session logs are never
// injected, but cap them too so a runaway reflection can't bloat the PVC.
const MEMORY_MAX_CHARS = 16_000;
const SESSION_LOG_MAX_CHARS = 16_000;

// list/search defaults + ceilings. SEARCH_SCAN_LIMIT bounds how many of the
// newest logs a single search reads off disk so it stays cheap even with a long
// history.
export const SESSION_LIST_DEFAULT = 5;
export const SESSION_LIST_MAX = 25;
const SEARCH_SCAN_LIMIT = 100;
const SNIPPET_MAX_CHARS = 200;

// Session-log ids are agent-supplied on read, so guard against path traversal:
// a single path segment of filename-safe characters only.
const SAFE_ID = /^[a-z0-9][\w.-]*$/i;

export type SessionLogMeta = {
  // Filename stem (sortable + unique). Built from startedAt + goalId.
  id: string;
  goalId: string;
  goal: string;
  startedAt: string;
};

/**
 * Derive a session log's metadata from the active goal. The id is the start
 * time (filesystem-safe — colons/dots become dashes, the trailing Z drops) plus
 * a short goal-id suffix: it sorts chronologically by name and is stable per
 * goal, so re-writing the same session refines one file instead of duplicating.
 */
export function buildSessionLogMeta(state: GoalState): SessionLogMeta {
  const stamp = state.startedAt.replaceAll(/[:.]/g, "-").replace("Z", "");
  return {
    id: `${stamp}-${state.id.slice(0, 8)}`,
    goalId: state.id,
    goal: state.goal,
    startedAt: state.startedAt,
  };
}

export type SessionLogSummary = {
  id: string;
  goal: string;
  startedAt?: string;
  written?: string;
};

export type SessionLogSearchHit = SessionLogSummary & {
  snippet: string;
};

export type MemoryWriteResult = {
  path: string;
  chars: number;
};

export type SessionLogWriteResult = {
  path: string;
  id: string;
};

export class GoalMemory {
  constructor(
    private readonly directory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private memoryPath(): string {
    return path.join(this.directory, MEMORY_FILE);
  }

  private sessionsDirectory(): string {
    return path.join(this.directory, SESSIONS_DIR);
  }

  private sessionLogPath(id: string): string {
    return path.join(this.sessionsDirectory(), `${id}.md`);
  }

  /** Curated MEMORY.md content, or "" when nothing has been written yet. */
  async readMemory(): Promise<string> {
    const file = Bun.file(this.memoryPath());
    if (!(await file.exists())) return "";
    const text = await file.text();
    return text.trim();
  }

  /**
   * Replace MEMORY.md with a curated version. Rejects empty content (so a stray
   * call can't wipe accumulated lessons) and over-long content (so the prompt
   * budget stays bounded) — the agent is told to keep it concise and retry.
   */
  async writeMemory(content: string): Promise<MemoryWriteResult> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error("memory content cannot be empty");
    }
    if (trimmed.length > MEMORY_MAX_CHARS) {
      throw new Error(
        `memory content too long (${String(trimmed.length)} chars; keep it under ${String(MEMORY_MAX_CHARS)})`,
      );
    }
    const target = this.memoryPath();
    await Bun.write(target, `${trimmed}\n`, { createPath: true });
    return { path: target, chars: trimmed.length };
  }

  /**
   * Write (or overwrite) this session's reflective log. Idempotent on
   * meta.id — re-writing the same session refines its single file rather than
   * spawning duplicates.
   */
  async writeSessionLog(
    meta: SessionLogMeta,
    content: string,
  ): Promise<SessionLogWriteResult> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error("session log content cannot be empty");
    }
    if (trimmed.length > SESSION_LOG_MAX_CHARS) {
      throw new Error(
        `session log too long (${String(trimmed.length)} chars; keep it under ${String(SESSION_LOG_MAX_CHARS)})`,
      );
    }
    assertSafeId(meta.id);
    const target = this.sessionLogPath(meta.id);
    const body = renderSessionLog(meta, trimmed, this.now().toISOString());
    await Bun.write(target, body, { createPath: true });
    return { path: target, id: meta.id };
  }

  /** Newest-first summaries of past session logs (filename sorts chronologically). */
  async listSessionLogs(limit: number): Promise<SessionLogSummary[]> {
    const names = await this.sessionFilenames();
    const summaries: SessionLogSummary[] = [];
    for (const name of names.slice(0, limit)) {
      const text = await this.readSessionFile(name);
      summaries.push(summaryFromFile(name, text));
    }
    return summaries;
  }

  /** Case-insensitive full-text search across the newest session logs. */
  async searchSessionLogs(
    query: string,
    limit: number,
  ): Promise<SessionLogSearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const allNames = await this.sessionFilenames();
    const names = allNames.slice(0, SEARCH_SCAN_LIMIT);
    const hits: SessionLogSearchHit[] = [];
    for (const name of names) {
      if (hits.length >= limit) break;
      const text = await this.readSessionFile(name);
      if (!text.toLowerCase().includes(needle)) continue;
      hits.push({
        ...summaryFromFile(name, text),
        snippet: makeSnippet(text, needle),
      });
    }
    return hits;
  }

  /** Full text of a single past session log. Throws on unknown/unsafe id. */
  async readSessionLog(id: string): Promise<string> {
    assertSafeId(id);
    const file = Bun.file(this.sessionLogPath(id));
    if (!(await file.exists())) {
      throw new Error(`session log not found: ${id}`);
    }
    const text = await file.text();
    return text.trim();
  }

  private async readSessionFile(name: string): Promise<string> {
    return Bun.file(path.join(this.sessionsDirectory(), name)).text();
  }

  /** Session log filenames (`*.md`), newest first; [] when the dir is absent. */
  private async sessionFilenames(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.sessionsDirectory());
    } catch {
      // Directory does not exist yet (no logs written) — an empty history.
      return [];
    }
    // Newest first: ids start with the start timestamp, so descending name order
    // is reverse-chronological.
    return names
      .filter((name) => name.endsWith(".md"))
      .toSorted((a, b) => b.localeCompare(a));
  }
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id) || id.includes("..") || path.basename(id) !== id) {
    throw new Error(`invalid session log id: ${id}`);
  }
}

function renderSessionLog(
  meta: SessionLogMeta,
  content: string,
  written: string,
): string {
  // JSON.stringify each value → a safe double-quoted YAML scalar even when the
  // goal text contains colons, quotes, or newlines.
  const frontmatter = [
    "---",
    `id: ${JSON.stringify(meta.id)}`,
    `goalId: ${JSON.stringify(meta.goalId)}`,
    `goal: ${JSON.stringify(meta.goal)}`,
    `startedAt: ${JSON.stringify(meta.startedAt)}`,
    `written: ${JSON.stringify(written)}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${content}\n`;
}

function summaryFromFile(name: string, text: string): SessionLogSummary {
  const frontmatter = parseFrontmatter(text);
  const startedAt = frontmatter.get("startedAt");
  const written = frontmatter.get("written");
  return {
    id: name.slice(0, -3),
    goal: frontmatter.get("goal") ?? "(unknown goal)",
    ...(startedAt !== undefined && { startedAt }),
    ...(written !== undefined && { written }),
  };
}

function parseFrontmatter(text: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!text.startsWith("---")) return out;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return out;
  const block = text.slice(3, end);
  for (const line of block.split("\n")) {
    // `:` is a fixed delimiter and \w+ never includes it, so the two groups
    // can't exchange characters — no catastrophic-backtracking risk.
    const match = /^(\w+):(.*)$/.exec(line.trim());
    if (match === null) continue;
    out.set(match[1], unquote(match[2].trim()));
  }
  return out;
}

function unquote(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
}

function makeSnippet(text: string, needle: string): string {
  for (const line of text.split("\n")) {
    if (line.toLowerCase().includes(needle)) {
      const flattened = line.replaceAll(/\s+/g, " ").trim();
      return flattened.length <= SNIPPET_MAX_CHARS
        ? flattened
        : `${flattened.slice(0, SNIPPET_MAX_CHARS)}…`;
    }
  }
  return "";
}
