#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";

// Get CSV filename from command line or use default
const csvFile =
  process.argv[2] ||
  "transactions-191354292262351396-191354292241042981-6c5d15e8-b516-4281-b1cb-b205c10d420e.csv";
const dbFile = process.argv[3] || "transactions.db";

console.log(`Converting ${csvFile} to ${dbFile}...`);

// Read and parse CSV with proper multiline handling
const csvContent = readFileSync(csvFile, "utf-8");

// Parse CSV with proper multiline record support (RFC 4180)
function parseCSV(content: string): string[][] {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // Field separator
      currentRecord.push(currentField);
      currentField = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      // Record separator
      if (currentField || currentRecord.length > 0) {
        currentRecord.push(currentField);
        if (currentRecord.some((f) => f.trim())) {
          records.push(currentRecord);
        }
        currentRecord = [];
        currentField = "";
      }
      // Skip \r\n
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRecord.length > 0) {
    currentRecord.push(currentField);
    if (currentRecord.some((f) => f.trim())) {
      records.push(currentRecord);
    }
  }

  return records;
}

const records = parseCSV(csvContent);
const headers = records[0];
const dataRows = records.slice(1);

// Create SQLite database
const db = new Database(dbFile);

// Create transactions table
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    merchant TEXT,
    category TEXT,
    account TEXT,
    original_statement TEXT,
    notes TEXT,
    amount REAL,
    tags TEXT,
    owner TEXT
  )
`);

// Prepare insert statement
const insert = db.prepare(`
  INSERT INTO transactions (date, merchant, category, account, original_statement, notes, amount, tags, owner)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Insert data
const insertMany = db.transaction((rows: string[][]) => {
  for (const row of rows) {
    if (row.length < 9) continue; // Skip malformed rows
    insert.run(
      row[0], // date
      row[1], // merchant
      row[2], // category
      row[3], // account
      row[4], // original_statement
      row[5], // notes
      row[6] ? parseFloat(row[6]) : null, // amount
      row[7], // tags
      row[8], // owner
    );
  }
});

// Insert all rows in a transaction for speed
insertMany(dataRows);

// Show summary
const count = db.query("SELECT COUNT(*) as count FROM transactions").get() as {
  count: number;
};
console.log(`✓ Imported ${count.count} transactions`);

// Show sample query
console.log("\nSample query - Top 5 transactions by amount:");
const topTransactions = db
  .query(
    `
  SELECT date, merchant, amount, category
  FROM transactions
  ORDER BY amount DESC
  LIMIT 5
`,
  )
  .all();

console.table(topTransactions);

db.close();
console.log(`\nDatabase saved to ${dbFile}`);
