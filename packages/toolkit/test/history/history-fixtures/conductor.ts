import type { Database } from "bun:sqlite";
import path from "node:path";
import { writeDatabase } from "./database.ts";

function seedLongConductorSession(database: Database): void {
  database.run(
    "INSERT INTO sessions VALUES ('s-long', 'Long session', '2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z', 'model', 'agent', 'workspace')",
  );
  const insertMessage = database.prepare(
    "INSERT INTO session_messages VALUES (?, 's-long', 'assistant', ?, NULL, ?)",
  );
  const insertMessages = database.transaction(() => {
    for (let index = 0; index < 1100; index += 1) {
      insertMessage.run(
        `long-${String(index).padStart(4, "0")}`,
        index === 400
          ? "middle-search-marker substantive dialogue"
          : `routine dialogue ${String(index)}`,
        new Date(Date.UTC(2026, 7, 10, 0, 0, index)).toISOString(),
      );
    }
  });
  insertMessages();
}

export function writeConductorFixture(conductorDir: string): string {
  const conductorDb = path.join(conductorDir, "conductor.db");
  writeDatabase(
    conductorDb,
    `
      CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT,
        model TEXT, agent_type TEXT, workspace_id TEXT);
      CREATE TABLE session_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
        full_message TEXT, created_at TEXT);
    `,
    (database) => {
      database.run(
        "INSERT INTO sessions VALUES ('s1', 'Ingress repair', '2026-08-10T00:00:00Z', '2026-08-11T00:00:00Z', 'model', 'agent', 'workspace')",
      );
      database.run(
        "INSERT INTO sessions VALUES ('s-empty', 'Empty session', '2026-08-09T00:00:00Z', '2026-08-09T00:00:00Z', 'model', 'agent', 'workspace')",
      );
      database.run(
        "INSERT INTO session_messages VALUES ('m1', 's1', 'user', 'Fix kubernetes ingress', NULL, '2026-08-10T00:00:00Z')",
      );
      database.run(
        `INSERT INTO session_messages VALUES ('m2', 's1', 'assistant', '${JSON.stringify(
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "Substantive ingress dialogue" },
                { type: "thinking", thinking: "omit-conductor-reasoning" },
                {
                  type: "tool_use",
                  name: "shell",
                  input: { command: "kubectl get ingress" },
                },
              ],
            },
          },
        ).replaceAll("'", "''")}', NULL, '2026-08-10T00:01:00Z')`,
      );
      database.run(
        `INSERT INTO session_messages VALUES ('m3', 's1', 'assistant', '${JSON.stringify({ type: "user", message: { role: "user", content: "<system_instruction>omit-conductor-system</system_instruction>" } }).replaceAll("'", "''")}', NULL, '2026-08-10T00:02:00Z')`,
      );
      database.run(
        `INSERT INTO session_messages VALUES ('m4', 's1', 'assistant', '${JSON.stringify(
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "x".repeat(40_000) },
                { type: "text", text: "later-content-block-marker" },
              ],
            },
          },
        ).replaceAll("'", "''")}', NULL, '2026-08-10T00:03:00Z')`,
      );
      seedLongConductorSession(database);
    },
  );
  return conductorDb;
}
