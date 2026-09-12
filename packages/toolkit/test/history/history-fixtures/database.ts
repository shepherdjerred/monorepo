import { Database } from "bun:sqlite";

export function writeDatabase(
  filePath: string,
  schema: string,
  seed: (database: Database) => void,
): void {
  const database = new Database(filePath);
  database.run(schema);
  seed(database);
  database.close();
}
