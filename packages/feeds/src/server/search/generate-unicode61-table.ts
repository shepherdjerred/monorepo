// Rewrites unicode61-table.json from the SQLite build Bun ships.
// Run with `bun run generate:unicode61`; search-tokens.test.ts fails when the
// committed table and SQLite disagree.
import path from "node:path";
import { readUnicode61Table } from "./unicode61-table-source.ts";

const target = path.join(import.meta.dir, "unicode61-table.json");
await Bun.write(target, `${JSON.stringify(readUnicode61Table(), null, 2)}\n`);
console.warn(`wrote ${target}`);
