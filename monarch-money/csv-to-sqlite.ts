#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";

// Get CSV filename from command line or use default
const csvFile = process.argv[2] || "transactions-191354292262351396-191354292241042981-6c5d15e8-b516-4281-b1cb-b205c10d420e.csv";
const dbFile = process.argv[3] || "transactions.db";

console.log(`Converting ${csvFile} to ${dbFile}...`);

// Read and parse CSV
const csvContent = readFileSync(csvFile, "utf-8");
const lines = csvContent.trim().split("\n");
const headers = lines[0].split(",");

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

// Parse CSV rows (handle quoted fields with commas)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

// Insert data
const insertMany = db.transaction((rows: string[][]) => {
  for (const row of rows) {
    insert.run(
      row[0], // date
      row[1], // merchant
      row[2], // category
      row[3], // account
      row[4], // original_statement
      row[5], // notes
      row[6] ? parseFloat(row[6]) : null, // amount
      row[7], // tags
      row[8]  // owner
    );
  }
});

// Parse all rows (skip header)
const rows = lines.slice(1).map(line => parseCSVLine(line));

// Insert all rows in a transaction for speed
insertMany(rows);

// Show summary
const count = db.query("SELECT COUNT(*) as count FROM transactions").get() as { count: number };
console.log(`✓ Imported ${count.count} transactions`);

// Show sample query
console.log("\nSample query - Top 5 transactions by amount:");
const topTransactions = db.query(`
  SELECT date, merchant, amount, category
  FROM transactions
  ORDER BY amount DESC
  LIMIT 5
`).all();

console.table(topTransactions);

db.close();
console.log(`\nDatabase saved to ${dbFile}`);
