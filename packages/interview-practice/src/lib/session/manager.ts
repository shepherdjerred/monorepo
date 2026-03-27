import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { openDatabase } from "#lib/db/connection.ts";
import { initializeSchema } from "#lib/db/schema.ts";
import { SessionMetadataSchema } from "./schemas.ts";
import type { SessionMetadata } from "./schemas.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import type { TimerState } from "#lib/timer/schemas.ts";

export type Session = {
  metadata: SessionMetadata;
  db: Database;
  workspacePath: string;
}

export function createSession(options: {
  dataDir: string;
  question: LeetcodeQuestion;
  language: string;
  durationMinutes: number;
  voiceEnabled: boolean;
}): Session {
  const id = randomUUID();
  const workspacePath = join(options.dataDir, "sessions", id);
  mkdirSync(workspacePath, { recursive: true });

  const dbPath = join(workspacePath, "session.db");
  const db = openDatabase(dbPath);
  initializeSchema(db);

  const now = new Date().toISOString();
  const timerState: TimerState = {
    durationMs: options.durationMinutes * 60 * 1000,
    elapsedMs: 0,
    warningsEmitted: [],
    lastCheckpointMs: Date.now(),
  };

  const metadata: SessionMetadata = {
    id,
    type: "leetcode",
    questionId: options.question.id,
    questionTitle: options.question.title,
    status: "in-progress",
    startedAt: now,
    currentPart: 1,
    language: options.language,
    workspacePath,
    voiceEnabled: options.voiceEnabled,
    mode: "text_ai",
    timer: timerState,
    hintsGiven: 0,
    testsRun: 0,
  };

  writeFileSync(
    join(workspacePath, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );

  return { metadata, db, workspacePath };
}

export function saveSession(session: Session): void {
  writeFileSync(
    join(session.workspacePath, "metadata.json"),
    JSON.stringify(session.metadata, null, 2),
  );
}

export function loadSession(dataDir: string, sessionId: string): Session | null {
  const workspacePath = join(dataDir, "sessions", sessionId);
  const metadataPath = join(workspacePath, "metadata.json");

  if (!existsSync(metadataPath)) return null;

  const raw = readFileSync(metadataPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const result = SessionMetadataSchema.safeParse(parsed);
  if (!result.success) return null;

  const dbPath = join(workspacePath, "session.db");
  const db = openDatabase(dbPath);

  return { metadata: result.data, db, workspacePath };
}

export function listSessions(dataDir: string): SessionMetadata[] {
  const sessionsDir = join(dataDir, "sessions");
  if (!existsSync(sessionsDir)) return [];

  const sessions: SessionMetadata[] = [];
  const dirs = readdirSync(sessionsDir, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const metadataPath = join(sessionsDir, dir.name, "metadata.json");
    if (!existsSync(metadataPath)) continue;

    try {
      const raw = readFileSync(metadataPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const result = SessionMetadataSchema.safeParse(parsed);
      if (result.success) {
        sessions.push(result.data);
      }
    } catch {
      // Skip invalid sessions
    }
  }

  return sessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}
