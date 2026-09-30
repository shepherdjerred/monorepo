import path from "node:path";
import { writeDatabase } from "./database.ts";

export async function writeOpencodeFixture(
  opencodeDir: string,
): Promise<string> {
  const opencodeDb = path.join(opencodeDir, "opencode.db");
  writeDatabase(
    opencodeDb,
    `
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, agent TEXT, model TEXT,
        time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    `,
    (database) => {
      database.run(
        "INSERT INTO session VALUES ('o1', 'OpenCode work', '/workspace', 'build', 'model', 1786406400000, 1786406400000)",
      );
      database.run(
        "INSERT INTO message VALUES ('om1', 'o1', '{\"role\":\"user\"}', 1786406400000, 1786406400000)",
      );
      database.run(
        'INSERT INTO message VALUES (\'om2\', \'o1\', \'{"role":"assistant","text":"Later direct message"}\', 1786406405000, 1786406405000)',
      );
      database.run(
        "INSERT INTO part VALUES ('op1', 'om1', 'o1', 1786406400000, 1786406400000, '{\"type\":\"text\",\"text\":\"Improve launchd ingestion\"}')",
      );
      database.run(
        "INSERT INTO part VALUES ('op2', 'om1', 'o1', 1786406400001, 1786406400001, '{\"type\":\"reasoning\",\"text\":\"omit-opencode-reasoning\"}')",
      );
      database.run(
        "INSERT INTO part VALUES ('op3', 'om1', 'o1', 1786406400002, 1786406400002, '{\"type\":\"tool\",\"command\":\"launchctl print fixture\"}')",
      );
    },
  );
  await Bun.write(
    path.join(opencodeDir, "auth.json"),
    JSON.stringify({ token: "must-not-be-indexed" }),
  );
  return opencodeDb;
}
