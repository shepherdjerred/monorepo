import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { openDatabase } from "#lib/db/connection.ts";
import { initializeSchema } from "#lib/db/schema.ts";
import { SessionMetadataSchema } from "./schemas.ts";
import type { SessionMetadata } from "./schemas.ts";
import type { TimerState } from "#lib/timer/schemas.ts";
import type { SessionType } from "./schemas.ts";

export type Session = {
  metadata: SessionMetadata;
  db: Database;
  workspacePath: string;
}

export async function createSession(options: {
  dataDir: string;
  question: { id: string; title: string };
  difficulty: string;
  language: string;
  durationMinutes: number;
  voiceEnabled: boolean;
  type?: SessionType | undefined;
}): Promise<Session> {
  const id = randomUUID();
  const workspacePath = path.join(options.dataDir, "sessions", id);
  mkdirSync(workspacePath, { recursive: true });

  const dbPath = path.join(workspacePath, "session.db");
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
    type: options.type ?? "leetcode",
    questionId: options.question.id,
    questionTitle: options.question.title,
    difficulty: options.difficulty,
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
    editsGiven: 0,
    debugHelpsGiven: 0,
  };

  await Bun.write(
    path.join(workspacePath, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );

  return { metadata, db, workspacePath };
}

export async function saveSession(session: Session): Promise<void> {
  await Bun.write(
    path.join(session.workspacePath, "metadata.json"),
    JSON.stringify(session.metadata, null, 2),
  );
}

export async function loadSession(dataDir: string, sessionId: string): Promise<Session | null> {
  const workspacePath = path.join(dataDir, "sessions", sessionId);
  const metadataPath = path.join(workspacePath, "metadata.json");

  const file = Bun.file(metadataPath);
  if (!(await file.exists())) return null;

  const raw = await file.text();
  const parsed = JSON.parse(raw) as unknown;
  const result = SessionMetadataSchema.safeParse(parsed);
  if (!result.success) return null;

  const dbPath = path.join(workspacePath, "session.db");
  const db = openDatabase(dbPath);

  return { metadata: result.data, db, workspacePath };
}

export async function listSessions(dataDir: string): Promise<SessionMetadata[]> {
  const sessionsDir = path.join(dataDir, "sessions");

  let files: string[];
  try {
    const glob = new Bun.Glob("*/metadata.json");
    files = [...glob.scanSync(sessionsDir)];
  } catch {
    return [];
  }

  const sessions: SessionMetadata[] = [];

  for (const relPath of files) {
    const metadataPath = path.join(sessionsDir, relPath);
    try {
      const raw = await Bun.file(metadataPath).text();
      const parsed = JSON.parse(raw) as unknown;
      const result = SessionMetadataSchema.safeParse(parsed);
      if (result.success) {
        sessions.push(result.data);
      }
    } catch {
      // Skip invalid sessions
    }
  }

  return sessions.toSorted(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}
