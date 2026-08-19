import { Database } from "bun:sqlite";
import { z } from "zod";

const ColumnRowsSchema = z.array(z.object({ name: z.string() }));

export function inspectAgentRunDatabase(
  databasePath: string,
  messageId: string,
): { columns: string[]; serializedRows: string } {
  const database = new Database(databasePath, {
    readonly: true,
    strict: true,
  });
  try {
    const columns = ColumnRowsSchema.parse(
      database
        .query<{ name: string }, []>("PRAGMA table_info('AgentRun')")
        .all(),
    ).map(({ name }) => name);
    const rows: unknown = database
      .query("SELECT * FROM AgentRun WHERE discordMessageId = ?")
      .all(messageId);
    return { columns, serializedRows: JSON.stringify(rows) };
  } finally {
    database.close();
  }
}
