import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath =
  process.env.DATABASE_PATH || path.join(__dirname, "../../data/camping.db");

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

console.log("Running migrations...");
migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
console.log("Migrations complete!");

sqlite.close();
